"""
Synthetic rig data generator: maintains a continuous physical state machine.
This simulator models drilling mechanics (ROP, Depth, BHA friction) and fluid mechanics (Yield Point, Density, Flow Rate).
Key behaviors:
1. It reads optional targets from the `sim_config` SQLite table (written remotely by the React dashboard).
2. It mathematically transitions core properties towards those targets (using gradient-based steps) OR applies a random walk for realism.
3. It inserts one unified sensor row into the SQLite `sensor_data` table on each tick. The frontend consumes this.
"""
import sqlite3      # For local database operations (sensor telemetry storage)
import random       # For simulating sensor noise and random physical walk
from datetime import datetime # For timestamping telemetry data
import time         # For calculating elapsed time (dt) between simulation ticks
import math         # For complex mathematical calculations (log, pi, power)

DB_NAME = "sensor_data.db"

def init_db():
    """Create `sensor_data` if missing; best-effort ALTER for columns added after first deploy."""
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
            Mud_Density_SG REAL,
            Current_Depth_m REAL,
            theta_600 REAL,
            theta_300 REAL,
            theta_200 REAL,
            theta_100 REAL,
            theta_6 REAL,
            theta_3 REAL
        )
    ''')
    # Check and add new columns dynamically without breaking existing schemas
    try:
        cursor.execute("ALTER TABLE sensor_data ADD COLUMN Mud_Density_SG REAL")
    except Exception: pass
    try:
        cursor.execute("ALTER TABLE sensor_data ADD COLUMN Current_Depth_m REAL")
    except Exception: pass
    for col in ['theta_600', 'theta_300', 'theta_200', 'theta_100', 'theta_6', 'theta_3']:
        try:
            cursor.execute(f"ALTER TABLE sensor_data ADD COLUMN {col} REAL")
        except Exception: pass
        
    conn.commit() # Save changes to DB
    return conn

import json # For parsing complex config arrays like casing specifications

# --- Shared constant with dashboard/src/hydraulics.js (YP enters annulus/pipe friction proxy). ---
K_YP_IN_PIPE_TERM = 0.22


def _visc_twin(pv, yp):
    """Empirical viscous term for pipe/annulus segments (must match JS `viscTwin`)."""
    return float(pv) + 5.0 + K_YP_IN_PIPE_TERM * float(yp)


def calculate_ypl_parameters(theta_600, theta_300, theta_3):
    """
    Computes Herschel-Bulkley (Yield Power Law) rheological parameters (n, K, tau_0) 
    from standard Fann 35 viscometer dial readings.
    """
    try:
        num = max(0.1, theta_600 - theta_3) # Prevent log(0)
        den = max(0.1, theta_300 - theta_3) # Prevent division by zero
        n = 3.321928 * math.log10(num / den) # Flow behavior index formula (API RP 13D)
    except ValueError:
        n = 0.5 # Fallback to generic index if log fails
        
    n = max(0.1, min(0.99, n)) # Clamp 'n' between 0.1 and 0.99 to avoid extreme singularities
    tau_0_field = theta_3 # Yield stress (tau_0) approximation in field units (lbf/100ft^2)
    tau_0_si = tau_0_field * 0.4788 # Convert tau_0 from field units to Pascals (SI)
    
    # Consistency index (K) approximation in field units
    K_field = (theta_300 - tau_0_field) / (511**n) 
    # Convert K to Pascals * second^n (SI)
    K_si = K_field * 0.4788 * (1.703**n) 
    
    return n, tau_0_si, K_si

def calculate_re_c(n):
    return (6464 * n) / (((1 + 3*n)**2) * ((2 + n)**((2+n)/(1+n))))

def hb_pressure_drop_pipe_si(v, d, L, n, tau_0_si, K_si, rho):
    if v <= 0 or d <= 0 or L <= 0: return 0.0
    term1 = (3*n + 1) / (4*n)
    if K_si <= 0: K_si = 1e-6
    Re_g = (rho * (d**n) * (v**(2-n))) / (K_si * (8**(n-1)) * (term1**n))
    Re_c = calculate_re_c(n)
    
    if Re_g <= Re_c:
        dP = (4 * L / d) * (tau_0_si + K_si * (term1**n) * ((8*v / d)**n))
    else:
        a = (1.1025 * (n**0.18)) / 100.0
        b = 0.263 * (n**0.033)
        f = a / max(1e-6, (Re_g**b))
        dP = (2 * f * rho * (v**2) * L) / d
    return dP

def hb_pressure_drop_annulus_si(v, d_o, d_i, L, n, tau_0_si, K_si, rho):
    """
    Calculates pressure drop in an annular section using Herschel-Bulkley fluid equations.
    """
    d_eq = d_o - d_i # Equivalent diameter for annulus
    if v <= 0 or d_eq <= 0 or L <= 0: return 0.0 # Guard clause for invalid dimensions
    
    term1 = (2*n + 1) / (3*n) # Annulus geometric constant for generalized Reynolds
    if K_si <= 0: K_si = 1e-6 # Guard against divide by zero
    
    # Generalized Reynolds number for annulus (API RP 13D)
    Re_g = (rho * (d_eq**n) * (v**(2-n))) / (K_si * (12**(n-1)) * (term1**n))
    Re_c = calculate_re_c(n) # Critical reynolds transition
    
    if Re_g <= Re_c:
        # Laminar flow pressure loss
        dP = (4 * L / d_eq) * (tau_0_si + K_si * (term1**n) * ((12*v / d_eq)**n))
    else:
        # Turbulent flow friction factor and pressure loss (Dodge-Metzner correlation)
        a = (1.1025 * (n**0.18)) / 100.0
        b = 0.263 * (n**0.033)
        f = a / max(1e-6, (Re_g**b))
        dP = (2 * f * rho * (v**2) * L) / d_eq
        
    return dP



def _depth_m_to_native(depth_m, length_unit):
    """API depth is always meters; config intervals may be in meters or feet."""
    if depth_m is None:
        return 0.0
    d = float(depth_m)
    if d < 0:
        return 0.0
    return d * 3.28084 if length_unit == "ft" else d


def _parse_casings(config):
    """Return list of {start,end,id} casing intervals from JSON string in sim_config."""
    try:
        c = json.loads(config.get("casings") or "[]")
        return c if isinstance(c, list) else []
    except Exception:
        return []


def _hole_id_at_md(md_native, casings, bit_diameter_in):
    """Open-hole or cased-hole inner diameter (in) at measured depth for annulus gap."""
    cand = []
    for row in casings:
        try:
            s = float(row.get("start", 0))
            e = float(row.get("end", 0))
            cid = float(row.get("id", 0))
        except (TypeError, ValueError):
            continue
        lo, hi = min(s, e), max(s, e)
        if md_native >= lo and md_native < hi:
            cand.append(cid)
    if not cand:
        return float(bit_diameter_in or 0)
    return min(cand)


def _pipe_geometry_at_md(md_native, depth_native, cfg):
    """Return (OD, ID) in inches for drill string component present at md_native."""
    dc1_l = float(cfg.get("dc1_length", 0) or 0)
    dc2_l = float(cfg.get("dc2_length", 0) or 0)
    dp_od = float(cfg.get("dp1_od", 0) or 0)
    dc1_od = float(cfg.get("dc1_od", 0) or 0)
    dc2_od = float(cfg.get("dc2_od", 0) or 0)
    dp_id = float(cfg.get("dp1_id", 0) or 0)
    dc1_id = float(cfg.get("dc1_id", 0) or 0)
    dc2_id = float(cfg.get("dc2_id", 0) or 0)
    if depth_native <= 0:
        return dp_od, dp_id
    top_dc2 = depth_native - dc2_l
    top_dc1 = depth_native - dc2_l - dc1_l
    if dc2_l > 0 and dc2_od > 0 and md_native > top_dc2:
        return dc2_od, dc2_id
    if dc1_l > 0 and dc1_od > 0 and md_native > top_dc1:
        return dc1_od, dc1_id
    return dp_od, dp_id


def _collect_breakpoints(depth_native, casings, bha_len, dc1_l, dc2_l):
    """Sorted unique MDs where hole ID or pipe OD may change (annulus integration)."""
    b = {0.0, depth_native}
    for row in casings:
        try:
            s = float(row.get("start", 0))
            e = float(row.get("end", 0))
        except (TypeError, ValueError):
            continue
        lo, hi = min(s, e), max(s, e)
        if 0 < lo < depth_native:
            b.add(lo)
        if 0 < hi < depth_native:
            b.add(hi)
    top_dc2 = depth_native - dc2_l
    top_dc1 = depth_native - dc2_l - dc1_l
    top_bha = depth_native - bha_len
    for x in (top_dc2, top_dc1, top_bha):
        if 0 < x < depth_native:
            b.add(x)
    return sorted(b)


def _annulus_pressure_si(config, depth_m, q_lpm, n, tau_0_si, K_si, rho_kgm3, bit_diameter_in):
    """Sum annulus friction over MD segments between casing/BHA boundaries (Pa)."""
    length_unit = config.get("length_unit") or "m"
    unit_to_m = 0.3048 if length_unit == "ft" else 1.0
    depth_native = _depth_m_to_native(depth_m, length_unit)
    if depth_native <= 0:
        return 0.0
    casings = _parse_casings(config)
    dc1_l = float(config.get("dc1_length", 0) or 0)
    dc2_l = float(config.get("dc2_length", 0) or 0)
    bha_len = dc1_l + dc2_l
    eps = 0.01
    bps = _collect_breakpoints(depth_native, casings, bha_len, dc1_l, dc2_l)
    total_pa = 0.0
    for i in range(len(bps) - 1):
        md0, md1 = bps[i], bps[i + 1]
        len_native = md1 - md0
        if len_native <= 0:
            continue
        mid = (md0 + md1) / 2.0
        hole_id_in = _hole_id_at_md(mid, casings, bit_diameter_in)
        pipe_od_in, _ = _pipe_geometry_at_md(mid, depth_native, config)
        d_ann_in = hole_id_in - pipe_od_in
        if d_ann_in <= eps:
            continue
            
        d_o_m = hole_id_in * 0.0254
        d_i_m = pipe_od_in * 0.0254
        L_m = len_native * unit_to_m
        
        A_m2 = math.pi * ((d_o_m/2)**2 - (d_i_m/2)**2)
        v = (q_lpm / 60000.0) / max(1e-6, A_m2)
        
        dp = hb_pressure_drop_annulus_si(v, d_o_m, d_i_m, L_m, n, tau_0_si, K_si, rho_kgm3)
        total_pa += dp
    return total_pa


class SimState:
    """
    Mutable simulator state advanced once per tick in `get_next`.
    Depth integrates ROP over wall-clock dt; hydraulics use the same BHA model as the dashboard twin.
    """

    def __init__(self):
        # Slowly drifting “surface” and mud properties (random walk or toward API targets).
        self.rop = 15.0
        self.mud_level = 90.0
        self.flow_rate = 2000.0
        self.mud_temp = 45.0
        
        # Rheology (semi-independent)
        self.pv = 20.0
        self.yp = 12.0
        self.n_flow = 0.700
        self.density = 1.20
        self.theta_600 = 60.0
        self.theta_300 = 40.0
        self.theta_200 = 30.0
        self.theta_100 = 20.0
        self.theta_6 = 6.0
        self.theta_3 = 5.0

        # Depth tracking
        self.current_depth = None
        self.last_time = time.time()
        self.last_rheo_time = 0 # trigger immediate update on first tick

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

        # ROP is strictly maintained in meters/hour internally.
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
                        if config.get("length_unit") == "ft":
                            casing_depth /= 3.28084
            except Exception: pass
            self.current_depth = casing_depth if casing_depth > 0 else 0

        # rop is in unit/h. so dt is converted to hours
        self.current_depth += self.rop * (dt / 3600.0)

        self.mud_level += random.uniform(-0.02, 0.02)
        self.mud_level = max(50.0, min(100.0, self.mud_level))
        
        target_flow = config.get("target_flow_rate") if config else None
        self.flow_rate = update_val(self.flow_rate, target_flow, 1000.0, 3500.0, 25.0, 20.0)

        # 2. Update Mud & Rheological properties every 15 minutes (900 seconds)
        if now - self.last_rheo_time >= 900:
            self.last_rheo_time = now
            
            self.mud_temp += random.uniform(-0.5, 0.5)
            self.mud_temp = max(40.0, min(60.0, self.mud_temp))

            temp_effect = (self.mud_temp - 45.0) * -0.05
            self.pv = update_val(self.pv, None, 10.0, 35.0, 0, 0.5, extra=temp_effect)
            self.yp = update_val(self.yp, None, 5.0, 30.0, 0.2, 0.3)
            
            self.theta_300 = self.pv + self.yp
            self.theta_600 = self.theta_300 + self.pv
            self.theta_200 = self.theta_300 * 0.75 + random.uniform(-1, 1)
            self.theta_100 = self.theta_300 * 0.5 + random.uniform(-1, 1)
            self.theta_3 = max(1.0, self.yp * 0.4 + random.uniform(-0.5, 0.5))
            self.theta_6 = self.theta_3 + random.uniform(0.5, 1.5)
            
            target_den = config.get("target_density") if config else None
            self.density = update_val(self.density, target_den, 1.0, 2.7, 0.01, 0.02)

        # 3. Drilling Hydraulics Calculation Foundation ---
        q_lpm = self.flow_rate
        rho_kgm3 = self.density * 1000.0
        n_ypl, tau_0_si, K_si = calculate_ypl_parameters(self.theta_600, self.theta_300, self.theta_3)
        
        target_k = config.get("target_k") if config else None
        target_n = config.get("target_n") if config else None
        
        if target_k is not None and target_k > 0:
            K_si = target_k
        if target_n is not None and target_n > 0:
            n_ypl = target_n
            
        self.n_flow = n_ypl
        
        pump_press = 2500.0
        standpipe_press = 2500.0
        
        if config:
            n_size = float(config.get("bit_nozzle_size") or 12)
            n_qty = int(config.get("bit_nozzle_qty") or 3)
            nozzles = [n_size] * n_qty
            tfa = sum([3.14159 * ((n/32.0)**2) / 4 for n in nozzles]) if nozzles else 0.5
            if tfa <= 0: tfa = 0.5

            q_gpm = self.flow_rate * 0.264172
            mw_ppg = self.density * 8.345
            
            bit_pd_psi = (mw_ppg * (q_gpm**2)) / (10858 * (tfa**2))
            bit_pd_pa = bit_pd_psi / 0.000145038

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
            
            # Drill Pipe (DP1) Length is governed by dynamic depth.
            # Convert current_depth (meters) to the active length unit before subtraction.
            bha_length = dc1_l + dc2_l
            current_depth_in_unit = self.current_depth * (1.0 if config.get("length_unit") == "m" else 3.28084)
            dyn_dp1_l = max(0.0, current_depth_in_unit - bha_length)

            pipe_pd_pa = 0.0
            pipe_pd_pa += calc_pd_pipe_si(dyn_dp1_l, float(config.get("dp1_id") or 3.826))
            pipe_pd_pa += calc_pd_pipe_si(dc1_l, float(config.get("dc1_id") or 2.50))
            pipe_pd_pa += calc_pd_pipe_si(dc2_l, float(config.get("dc2_id") or 0))

            bit_d = float(config.get("bit_diameter", 8.5))
            annulus_pd_pa = _annulus_pressure_si(config, self.current_depth, q_lpm, n_ypl, tau_0_si, K_si, rho_kgm3, bit_d)

            # Surface line pressure drop (E = 12 for Class 1-2)
            dP_surface = 12.0 * self.density * ((q_lpm / 1000.0)**1.86)
            
            total_psi = dP_surface + (pipe_pd_pa + bit_pd_pa + annulus_pd_pa) * 0.000145038
            
            pump_press = total_psi + random.uniform(-5, 5)
            # Assuming standpipe press does not include the initial line loss from pump to standpipe, but the prompt says:
            # "Bu formülün çıktısı doğrudan PSI cinsinden hesaplanmalı ve toplam sistem basınç kaybına (Pump_Press_psi ve Standpipe_Press_psi) bir baz yük olarak eklenmelidir."
            standpipe_press = total_psi * 0.98 + random.uniform(-2, 2)

        pump_press = max(100.0, min(8000.0, pump_press))

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
            "Current_Depth_m": round(self.current_depth, 2),
            "theta_600": round(self.theta_600, 1),
            "theta_300": round(self.theta_300, 1),
            "theta_200": round(self.theta_200, 1),
            "theta_100": round(self.theta_100, 1),
            "theta_6": round(self.theta_6, 1),
            "theta_3": round(self.theta_3, 1)
        }

def save_to_db(conn, data):
    """Persist one timestep; schema must match `init_db` / server expectations."""
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO sensor_data (
            Timestamp, ROP_m_h, Mud_Level_pct, Flow_Rate_lpm, 
            Pump_Press_psi, Standpipe_Press_psi, Mud_Temp_C, 
            Yield_Point, Plastic_Viscosity, Flow_Behavior_Index, Mud_Density_SG, Current_Depth_m,
            theta_600, theta_300, theta_200, theta_100, theta_6, theta_3
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        data["Timestamp"], data["ROP_m_h"], data["Mud_Level_pct"], data["Flow_Rate_lpm"],
        data["Pump_Press_psi"], data["Standpipe_Press_psi"], data["Mud_Temp_C"],
        data["Yield_Point"], data["Plastic_Viscosity"], data["Flow_Behavior_Index"],
        data["Mud_Density_SG"], data.get("Current_Depth_m", 0),
        data.get("theta_600", 0), data.get("theta_300", 0), data.get("theta_200", 0),
        data.get("theta_100", 0), data.get("theta_6", 0), data.get("theta_3", 0)
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