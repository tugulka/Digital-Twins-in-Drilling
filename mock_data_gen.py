"""
Synthetic rig data generator: maintains a continuous physical state machine.
This simulator models drilling mechanics (ROP, Depth, BHA friction) and fluid mechanics (Yield Point, Density, Flow Rate).
Key behaviors:
1. It reads optional targets from the `sim_config` SQLite table (written remotely by the React dashboard).
2. It mathematically transitions core properties towards those targets (using gradient-based steps) OR applies a random walk for realism.
3. It inserts one unified sensor row into the SQLite `sensor_data` table on each tick. The frontend consumes this.
"""
import sqlite3
import random
from datetime import datetime
import time

DB_NAME = "sensor_data.db"

def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sensor_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            Timestamp TEXT,
            ROP_m_h REAL,
            Mud_Level_pct REAL,
            Flow_Rate_lpm REAL,
            Pump_Press_psi REAL,
            Standpipe_Press_psi REAL,
            Mud_Temp_C REAL,
            Yield_Point REAL,
            Plastic_Viscosity REAL,
            Flow_Behavior_Index REAL,
            Mud_Density_SG REAL
        )
    ''')
    try:
        cursor.execute("ALTER TABLE sensor_data ADD COLUMN Mud_Density_SG REAL")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE sensor_data ADD COLUMN Current_Depth_m REAL")
    except Exception:
        pass
    conn.commit()
    return conn

import json

class SimState:
    def __init__(self):
        # Slowly drifting “surface” and mud properties (random walk or toward API targets).
        self.rop = 15.0
        self.mud_level = 80.0
        self.flow_rate = 2000.0
        self.mud_temp = 45.0
        
        # Rheology (semi-independent)
        self.pv = 20.0
        self.yp = 12.0
        self.n_flow = 0.700
        self.density = 1.20

        # Depth tracking
        self.current_depth = None
        self.last_time = time.time()

    def get_next(self, conn):
        """
        Advances the simulation state by one semantic step.
        It pulls configuration rules, evaluates real-time gradients, calculates BHA friction,
        and finally packages the data dictionary corresponding to the DB schema.
        """
        config = None
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM sim_config WHERE id=1")
            row = cursor.fetchone()
            if row:
                config = dict(zip([col[0] for col in cursor.description], row))
        except Exception:
            pass

        # Helper routine: Smoothly transitions a fluid variable towards an overriding target (if specified in config).
        # Otherwise, applies a noisy random walk to imitate raw physical sensor fluctuations.
        def update_val(current, target, min_v, max_v, step_size, rand_range, extra=0):
            if target is not None and target > 0:
                diff = target - current
                if abs(diff) > step_size:
                    current += step_size if diff > 0 else -step_size # Gradient seek
                else:
                    current = target # Lock onto target
            else:
                current += random.uniform(-rand_range, rand_range) + extra # Jitter
            return max(min_v, min(max_v, current))

        self.rop += random.uniform(-1.0, 1.0)
        self.rop = max(5.0, min(25.0, self.rop))

        # --- Real-Time Depth Derivation ---
        # Instead of static strings, Depth continuously increases based on ROP (Rate of Penetration). 
        # ROP is in active length unit / hour.
        now = time.time()
        dt = now - self.last_time
        self.last_time = now

        if self.current_depth is None:
            # Initialization logic: if restarting the script, start the depth from the end of the predefined casing scope. 
            casing_depth = 0
            try:
                if config and config.get('casings'):
                    cases = json.loads(config['casings'])
                    if cases:
                        casing_depth = max([float(c.get('end', 0)) for c in cases])
            except Exception: pass
            self.current_depth = casing_depth if casing_depth > 0 else 0

        # rop is in unit/h. so dt is converted to hours
        self.current_depth += self.rop * (dt / 3600.0)

        self.mud_level += random.uniform(-0.1, 0.1)
        self.mud_level = max(50.0, min(100.0, self.mud_level))
        
        target_flow = config.get("target_flow_rate") if config else None
        self.flow_rate = update_val(self.flow_rate, target_flow, 1000.0, 3500.0, 25.0, 20.0)

        self.mud_temp += random.uniform(-0.5, 0.5)
        self.mud_temp = max(40.0, min(60.0, self.mud_temp))

        # 2. Update Rheological properties
        temp_effect = (self.mud_temp - 45.0) * -0.05
        self.pv = update_val(self.pv, None, 10.0, 35.0, 0, 0.5, extra=temp_effect)
        
        target_yp = config.get("target_yp") if config else None
        self.yp = update_val(self.yp, target_yp, 5.0, 30.0, 0.2, 0.3)
        
        self.n_flow += random.uniform(-0.01, 0.01)
        self.n_flow = max(0.5, min(1.0, self.n_flow))
        
        target_den = config.get("target_density") if config else None
        self.density = update_val(self.density, target_den, 1.0, 2.7, 0.01, 0.02)

        # 3. Drilling Hydraulics Calculation Foundation ---
        # Simple generalized base-pressure scaling:
        pump_press = 2500 + (self.flow_rate - 2000)*1.2 + (self.pv - 20.0)*20.0 + random.uniform(-5, 5)
        
        # If Bottom Hole Assembly (BHA) data exists, compute physical pressure drops.
        if config:
            n_size = float(config.get("bit_nozzle_size", 12))
            n_qty = int(config.get("bit_nozzle_qty", 3))
            nozzles = [n_size] * n_qty
            # Total Flow Area (TFA) for the Drill Bit Nozzles. Uses standard industry geometry.
            tfa = sum([3.14159 * ((n/32.0)**2) / 4 for n in nozzles]) if nozzles else 0.5
            if tfa <= 0: tfa = 0.5

            # Flow scaling modifiers
            q_gpm = self.flow_rate * 0.264172  # Convert L/min to GPM
            mw_ppg = self.density * 8.345      # Convert SG to Pounds Per Gallon
            
            # Formulated Bit Pressure Drop using industry standard classic approximation equation.
            bit_pd = (mw_ppg * (q_gpm**2)) / (10858 * (tfa**2))

            # Pipe Frictional Pressure Drop Logic:
            # We enforce length conversions to imperial feet as standard drilling frictional formulas expect ft/in.
            unit_mult = 3.28084 if config.get("length_unit") == "m" else 1.0
            
            def calc_pd(length, inner_d):
                length_ft = length * unit_mult
                if length_ft > 0 and inner_d > 0:
                    # Newtonian-approximation viscous friction model inside structural pipe.
                    return (length_ft * (self.pv + 5) * q_gpm) / (1500 * (inner_d**2.5))
                return 0
            
            dc1_l = float(config.get("dc1_length", 200))
            dc2_l = float(config.get("dc2_length", 0))
            
            # Drill Pipe (DP1) Length is entirely governed by dynamic depth (auto-length mapping)
            # This ensures that as we drill deeper, pipe extends, and frictional pressure linearly increases!
            bha_length = dc1_l + dc2_l
            dyn_dp1_l = max(0.0, self.current_depth - bha_length)

            pipe_pd += calc_pd(dyn_dp1_l, config.get("dp1_id", 3.826))
            pipe_pd += calc_pd(dc1_l, config.get("dc1_id", 2.50))
            pipe_pd += calc_pd(dc2_l, config.get("dc2_id", 0))

            pump_press = bit_pd + pipe_pd + random.uniform(-5, 5)

        pump_press = max(100.0, min(8000.0, pump_press))
        
        # Standpipe is slightly lower than Pump press due to friction in surface lines
        standpipe_press = pump_press * 0.95 + random.uniform(-2, 2)

        return {
            "Timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "ROP_m_h": round(self.rop, 2),
            "Mud_Level_pct": round(self.mud_level, 2),
            "Flow_Rate_lpm": round(self.flow_rate, 1),
            "Pump_Press_psi": round(pump_press, 1),
            "Standpipe_Press_psi": round(standpipe_press, 1),
            "Mud_Temp_C": round(self.mud_temp, 1),
            "Yield_Point": round(self.yp, 1),
            "Plastic_Viscosity": round(self.pv, 1),
            "Flow_Behavior_Index": round(self.n_flow, 3),
            "Mud_Density_SG": round(self.density, 2),
            "Current_Depth_m": round(self.current_depth, 2)
        }

def save_to_db(conn, data):
    """Persist one timestep; schema must match `init_db` / server expectations."""
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO sensor_data (
            Timestamp, ROP_m_h, Mud_Level_pct, Flow_Rate_lpm, 
            Pump_Press_psi, Standpipe_Press_psi, Mud_Temp_C, 
            Yield_Point, Plastic_Viscosity, Flow_Behavior_Index, Mud_Density_SG, Current_Depth_m
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        data["Timestamp"], data["ROP_m_h"], data["Mud_Level_pct"], data["Flow_Rate_lpm"],
        data["Pump_Press_psi"], data["Standpipe_Press_psi"], data["Mud_Temp_C"],
        data["Yield_Point"], data["Plastic_Viscosity"], data["Flow_Behavior_Index"],
        data["Mud_Density_SG"], data.get("Current_Depth_m", 0)
    ))
    conn.commit()

if __name__ == "__main__":
    print(f"Connecting to database {DB_NAME}...")
    conn = init_db()
    sim = SimState()
    print("Correlated Data generation starting... (Press Ctrl+C to stop)")
    try:
        while True:
            current_data = sim.get_next(conn)
            save_to_db(conn, current_data)
            print(f"[{current_data['Timestamp']}] Saved to DB: Flow={current_data['Flow_Rate_lpm']} => Pump Press={current_data['Pump_Press_psi']}")
            time.sleep(2)
    except KeyboardInterrupt:
        print("\nData generation stopped.")
    finally:
        conn.close()