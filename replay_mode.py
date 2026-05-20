"""
Replay Mode: Telemetry playback system.
Reads actual drilling telemetry from `real_rig_data.csv`, computes 
theoretical Herschel-Bulkley pressure drops, and streams them into 
`sensor_data.db` for real-time validation on the React dashboard.
"""
import os
import csv
import time
import sqlite3
import math
import json
from datetime import datetime

# Import mathematical helpers directly from our physics core
from mock_data_gen import (
    calculate_ypl_parameters, 
    hb_pressure_drop_pipe_si, 
    _annulus_pressure_si, 
    _depth_m_to_native
)

DB_NAME = "sensor_data.db"
CSV_FILE = "real_rig_data.csv"

def init_replay_schema():
    """Ensure DB has actual pressure logging columns for relative error comparisons."""
    from mock_data_gen import init_db
    init_db()
    
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Check if actual columns exist, add if missing
    for col in ["Actual_Pump_Press_psi", "Actual_Standpipe_Press_psi"]:
        try:
            cursor.execute(f"ALTER TABLE sensor_data ADD COLUMN {col} REAL")
        except Exception:
            pass  # Already exists
            
    conn.commit()
    return conn

def get_active_config(conn):
    """Retrieve dynamic casing and BHA parameters from sim_config table."""
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM sim_config WHERE id=1")
        row = cursor.fetchone()
        if row:
            return dict(zip([col[0] for col in cursor.description], row))
    except sqlite3.OperationalError:
        pass
    
    # Safe fallback if not configured in UI
    return {
        "casings": '[{"start": 0, "end": 50, "id": 18.936}, {"start": 0, "end": 250, "id": 12.615}]',
        "length_unit": "m",
        "dp1_id": 2.602, "dp1_od": 3.5, "dp1_length": 1500.0,
        "hwdp_id": 3.0, "hwdp_od": 5.0, "hwdp_length": 18.78,
        "dc1_id": 2.813, "dc1_od": 8.0, "dc1_length": 72.0,
        "dc2_id": 2.813, "dc2_od": 5.0, "dc2_length": 36.0,
        "bit_diameter": 12.25, "bit_nozzle_size": 12.0, "bit_nozzle_qty": 3
    }

def calculate_theoretical_pressures(flow_rate, density, t600, t300, t3, depth_m, config):
    """Calculates SPP using the same non-Newtonian physics engine as mock_data_gen."""
    q_lpm = flow_rate
    rho_kgm3 = density * 1000.0
    
    # Solve Yield Power Law parameters
    n_ypl, tau_0_si, K_si = calculate_ypl_parameters(t600, t300, t3)
    
    # 1. Nozzle Jet Pressure Drop
    n_size = float(config.get("bit_nozzle_size") or 12)
    n_qty = int(config.get("bit_nozzle_qty") or 3)
    nozzles = [n_size] * n_qty
    tfa = sum([3.14159 * ((n/32.0)**2) / 4 for n in nozzles]) if nozzles else 0.5
    if tfa <= 0: tfa = 0.5

    q_gpm = q_lpm * 0.264172
    mw_ppg = density * 8.345
    bit_pd_psi = (mw_ppg * (q_gpm**2)) / (10858 * (tfa**2))
    bit_pd_pa = bit_pd_psi / 0.000145038

    # 2. Drill String Internal Pressure Drops
    unit_to_m = 0.3048 if config.get("length_unit") == "ft" else 1.0
    
    def calc_pd_pipe_si(length_native, inner_d_in):
        L_m = length_native * unit_to_m
        d_m = inner_d_in * 0.0254
        if L_m > 0 and d_m > 0:
            A_m2 = math.pi * (d_m/2)**2
            v = (q_lpm / 60000.0) / max(1e-6, A_m2)
            return hb_pressure_drop_pipe_si(v, d_m, L_m, n_ypl, tau_0_si, K_si, rho_kgm3)
        return 0.0

    dc1_l = float(config.get("dc1_length") or 200)
    dc2_l = float(config.get("dc2_length") or 0)
    hwdp_l = float(config.get("hwdp_length") or 0)
    bha_length = dc1_l + dc2_l + hwdp_l
    
    depth_native = depth_m * (1.0 if config.get("length_unit") == "m" else 3.28084)
    dyn_dp1_l = max(0.0, depth_native - bha_length)

    pipe_pd_pa = 0.0
    pipe_pd_pa += calc_pd_pipe_si(dyn_dp1_l, float(config.get("dp1_id") or 3.826))
    pipe_pd_pa += calc_pd_pipe_si(hwdp_l, float(config.get("hwdp_id") or 0))
    pipe_pd_pa += calc_pd_pipe_si(dc1_l, float(config.get("dc1_id") or 2.50))
    pipe_pd_pa += calc_pd_pipe_si(dc2_l, float(config.get("dc2_id") or 0))

    # 3. Annular Pressure Drop
    bit_d = float(config.get("bit_diameter", 8.5))
    annulus_pd_pa = _annulus_pressure_si(config, depth_m, q_lpm, n_ypl, tau_0_si, K_si, rho_kgm3, bit_d)

    # 4. Standpipe Surface Losses (Class 1-2 Standpipe manifold factor E=12)
    dP_surface = 12.0 * density * ((q_lpm / 1000.0)**1.86)
    
    # Combine losses to PSI
    total_psi = dP_surface + (pipe_pd_pa + bit_pd_pa + annulus_pd_pa) * 0.000145038
    
    pump_press = total_psi
    standpipe_press = total_psi * 0.98
    
    return round(pump_press, 1), round(standpipe_press, 1)

def save_replay_row(conn, data):
    """Inserts a single replayed row directly into SQLite to update telemetry."""
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO sensor_data (
            Timestamp, Current_Depth_m, ROP_m_h, Mud_Level_pct, Flow_Rate_lpm, 
            Mud_Temp_C, theta_600, theta_300, theta_200, theta_100, theta_6, theta_3, 
            Mud_Density_SG, Plastic_Viscosity, Yield_Point, Flow_Behavior_Index,
            Pump_Press_psi, Standpipe_Press_psi, Actual_Pump_Press_psi, Actual_Standpipe_Press_psi
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        data["Timestamp"], data["Current_Depth_m"], data["ROP_m_h"], data["Mud_Level_pct"], data["Flow_Rate_lpm"],
        data["Mud_Temp_C"], data["theta_600"], data["theta_300"], data["theta_200"], data["theta_100"], data["theta_6"], data["theta_3"],
        data["Mud_Density_SG"], data["Plastic_Viscosity"], data["Yield_Point"], data["Flow_Behavior_Index"],
        data["Pump_Press_psi"], data["Standpipe_Press_psi"], data["Actual_Pump_Press_psi"], data["Actual_Standpipe_Press_psi"]
    ))
    conn.commit()

def run_replay(speed_delay=2.0):
    """Reads telemetry, calculates, and publishes rows sequentially to simulate playback."""
    if not os.path.exists(CSV_FILE):
        print(f"Error: {CSV_FILE} not found. Please create it first.")
        return
        
    print(f"Connecting to database {DB_NAME}...")
    conn = init_replay_schema()
    
    print(f"Reading real drilling data from {CSV_FILE}...")
    with open(CSV_FILE, mode='r') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        
    print(f"Starting Replay Mode... Streaming {len(rows)} records at {speed_delay}s intervals.")
    print("=" * 90)
    print(f"{'Timestamp':<20} | {'Depth (m)':<10} | {'Flow (LPM)':<10} | {'Actual SPP':<12} | {'Model SPP':<12} | {'Rel Error (%)':<10}")
    print("=" * 90)
    
    try:
        for row in rows:
            config = get_active_config(conn)
            
            # Parse parameters from CSV row
            timestamp = row["Timestamp"]
            depth = float(row["Current_Depth_m"])
            rop = float(row["ROP_m_h"])
            mud_level = float(row["Mud_Level_pct"])
            flow = float(row["Flow_Rate_lpm"])
            temp = float(row["Mud_Temp_C"])
            t600 = float(row["theta_600"])
            t300 = float(row["theta_300"])
            t200 = float(row["theta_200"])
            t100 = float(row["theta_100"])
            t6 = float(row["theta_6"])
            t3 = float(row["theta_3"])
            density = float(row["Mud_Density_SG"])
            actual_pump = float(row["Actual_Pump_Press_psi"])
            actual_spp = float(row["Actual_Standpipe_Press_psi"])
            
            # Compute theoretical model pressures using standard BHA
            model_pump, model_spp = calculate_theoretical_pressures(
                flow, density, t600, t300, t3, depth, config
            )
            
            # Derived rheology metrics
            pv = max(0.5, t300 - t3)
            yp = max(0.5, t3)
            num = max(0.1, t600 - t3)
            den = max(0.1, t300 - t3)
            n_flow = round(3.321928 * math.log10(num / den), 3)
            n_flow = max(0.1, min(0.99, n_flow))
            
            # Calculate validation error
            rel_error = abs(actual_spp - model_spp) / max(1.0, actual_spp) * 100.0
            
            # Package and save
            payload = {
                "Timestamp": timestamp,
                "Current_Depth_m": depth,
                "ROP_m_h": rop,
                "Mud_Level_pct": mud_level,
                "Flow_Rate_lpm": flow,
                "Mud_Temp_C": temp,
                "theta_600": t600, "theta_300": t300, "theta_200": t200, "theta_100": t100, "theta_6": t6, "theta_3": t3,
                "Mud_Density_SG": density,
                "Plastic_Viscosity": pv,
                "Yield_Point": yp,
                "Flow_Behavior_Index": n_flow,
                "Pump_Press_psi": model_pump,
                "Standpipe_Press_psi": model_spp,
                "Actual_Pump_Press_psi": actual_pump,
                "Actual_Standpipe_Press_psi": actual_spp
            }
            
            save_replay_row(conn, payload)
            
            # Output status log
            print(f"{timestamp:<20} | {depth:<10.2f} | {flow:<10.1f} | {actual_spp:<12.1f} | {model_spp:<12.1f} | {rel_error:<9.2f}%")
            
            time.sleep(speed_delay)
            
    except KeyboardInterrupt:
        print("\nReplay mode stopped by user.")
    finally:
        conn.close()
        print("Database connection closed.")

if __name__ == "__main__":
    # Runs the replay streaming telemetry. Delay is set to 2 seconds to match dashboard charts.
    run_replay(speed_delay=2.0)
