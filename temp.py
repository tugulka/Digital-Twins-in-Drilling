""" # L1
Synthetic rig data generator: maintains a continuous physical state machine. # L2
This simulator models drilling mechanics (ROP, Depth, BHA friction) and fluid mechanics (Yield Point, Density, Flow Rate). # L3
Key behaviors: # L4
1. It reads optional targets from the `sim_config` SQLite table (written remotely by the React dashboard). # L5
2. It mathematically transitions core properties towards those targets (using gradient-based steps) OR applies a random walk for realism. # L6
3. It inserts one unified sensor row into the SQLite `sensor_data` table on each tick. The frontend consumes this. # L7
""" # L8
import sqlite3 # L9
import random # L10
from datetime import datetime # L11
import time # L12
import math # L13
 # L14
DB_NAME = "sensor_data.db" # L15
 # L16
def init_db(): # L17
    """Create `sensor_data` if missing; best-effort ALTER for columns added after first deploy.""" # L18
    conn = sqlite3.connect(DB_NAME) # L19
    cursor = conn.cursor() # L20
    cursor.execute(''' # L21
        CREATE TABLE IF NOT EXISTS sensor_data ( # L22
            id INTEGER PRIMARY KEY AUTOINCREMENT, # L23
            Timestamp TEXT, # L24
            ROP_m_h REAL, # L25
            Mud_Level_pct REAL, # L26
            Flow_Rate_lpm REAL, # L27
            Pump_Press_psi REAL, # L28
            Standpipe_Press_psi REAL, # L29
            Mud_Temp_C REAL, # L30
            Yield_Point REAL, # L31
            Plastic_Viscosity REAL, # L32
            Flow_Behavior_Index REAL, # L33
            Mud_Density_SG REAL, # L34
            Current_Depth_m REAL, # L35
            theta_600 REAL, # L36
            theta_300 REAL, # L37
            theta_200 REAL, # L38
            theta_100 REAL, # L39
            theta_6 REAL, # L40
            theta_3 REAL # L41
        ) # L42
    ''') # L43
    try: # L44
        cursor.execute("ALTER TABLE sensor_data ADD COLUMN Mud_Density_SG REAL") # L45
    except Exception: # L46
        pass # L47
    try: # L48
        cursor.execute("ALTER TABLE sensor_data ADD COLUMN Current_Depth_m REAL") # L49
    except Exception: # L50
        pass # L51
    for col in ['theta_600', 'theta_300', 'theta_200', 'theta_100', 'theta_6', 'theta_3']: # L52
        try: # L53
            cursor.execute(f"ALTER TABLE sensor_data ADD COLUMN {col} REAL") # L54
        except Exception: # L55
            pass # L56
    conn.commit() # L57
    return conn # L58
 # L59
import json # L60
 # L61
# --- Shared constant with dashboard/src/hydraulics.js (YP enters annulus/pipe friction proxy). --- # L62
K_YP_IN_PIPE_TERM = 0.22 # L63
 # L64
 # L65
def _visc_twin(pv, yp): # L66
    """Empirical viscous term for pipe/annulus segments (must match JS `viscTwin`).""" # L67
    return float(pv) + 5.0 + K_YP_IN_PIPE_TERM * float(yp) # L68
 # L69
 # L70
def calculate_ypl_parameters(theta_600, theta_300, theta_3): # L71
    try: # L72
        num = max(0.1, theta_600 - theta_3) # L73
        den = max(0.1, theta_300 - theta_3) # L74
        n = 3.321928 * math.log10(num / den) # L75
    except ValueError: # L76
        n = 0.5 # L77
    n = max(0.1, min(0.99, n)) # L78
    tau_0_field = theta_3 # L79
    tau_0_si = tau_0_field * 0.4788 # L80
    K_field = (theta_300 - tau_0_field) / (511**n) # L81
    K_si = K_field * 0.4788 * (1.703**n) # L82
    return n, tau_0_si, K_si # L83
 # L84
def calculate_re_c(n): # L85
    return (6464 * n) / (((1 + 3*n)**2) * ((2 + n)**((2+n)/(1+n)))) # L86
 # L87
def hb_pressure_drop_pipe_si(v, d, L, n, tau_0_si, K_si, rho): # L88
    if v <= 0 or d <= 0 or L <= 0: return 0.0 # L89
    term1 = (3*n + 1) / (4*n) # L90
    if K_si <= 0: K_si = 1e-6 # L91
    Re_g = (rho * (d**n) * (v**(2-n))) / (K_si * (8**(n-1)) * (term1**n)) # L92
    Re_c = calculate_re_c(n) # L93
     # L94
    if Re_g <= Re_c: # L95
        dP = (4 * L / d) * (tau_0_si + K_si * (term1**n) * ((8*v / d)**n)) # L96
    else: # L97
        a = (1.1025 * (n**0.18)) / 100.0 # L98
        b = 0.263 * (n**0.033) # L99
        f = a / max(1e-6, (Re_g**b)) # L100
        dP = (2 * f * rho * (v**2) * L) / d # L101
    return dP # L102
 # L103
def hb_pressure_drop_annulus_si(v, d_o, d_i, L, n, tau_0_si, K_si, rho): # L104
    d_eq = d_o - d_i # L105
    if v <= 0 or d_eq <= 0 or L <= 0: return 0.0 # L106
    term1 = (2*n + 1) / (3*n) # L107
    if K_si <= 0: K_si = 1e-6 # L108
    Re_g = (rho * (d_eq**n) * (v**(2-n))) / (K_si * (12**(n-1)) * (term1**n)) # L109
    Re_c = calculate_re_c(n) # L110
     # L111
    if Re_g <= Re_c: # L112
        dP = (4 * L / d_eq) * (tau_0_si + K_si * (term1**n) * ((12*v / d_eq)**n)) # L113
    else: # L114
        a = (1.1025 * (n**0.18)) / 100.0 # L115
        b = 0.263 * (n**0.033) # L116
        f = a / max(1e-6, (Re_g**b)) # L117
        dP = (2 * f * rho * (v**2) * L) / d_eq # L118
    return dP # L119
 # L120
 # L121
 # L122
def _depth_m_to_native(depth_m, length_unit): # L123
    """API depth is always meters; config intervals may be in meters or feet.""" # L124
    if depth_m is None: # L125
        return 0.0 # L126
    d = float(depth_m) # L127
    if d < 0: # L128
        return 0.0 # L129
    return d * 3.28084 if length_unit == "ft" else d # L130
 # L131
 # L132
def _parse_casings(config): # L133
    """Return list of {start,end,id} casing intervals from JSON string in sim_config.""" # L134
    try: # L135
        c = json.loads(config.get("casings") or "[]") # L136
        return c if isinstance(c, list) else [] # L137
    except Exception: # L138
        return [] # L139
 # L140
 # L141
def _hole_id_at_md(md_native, casings, bit_diameter_in): # L142
    """Open-hole or cased-hole inner diameter (in) at measured depth for annulus gap.""" # L143
    cand = [] # L144
    for row in casings: # L145
        try: # L146
            s = float(row.get("start", 0)) # L147
            e = float(row.get("end", 0)) # L148
            cid = float(row.get("id", 0)) # L149
        except (TypeError, ValueError): # L150
            continue # L151
        lo, hi = min(s, e), max(s, e) # L152
        if md_native >= lo and md_native < hi: # L153
            cand.append(cid) # L154
    if not cand: # L155
        return float(bit_diameter_in or 0) # L156
    return min(cand) # L157
 # L158
 # L159
def _pipe_geometry_at_md(md_native, depth_native, cfg): # L160
    """Return (OD, ID) in inches for drill string component present at md_native.""" # L161
    dc1_l = float(cfg.get("dc1_length", 0) or 0) # L162
    dc2_l = float(cfg.get("dc2_length", 0) or 0) # L163
    dp_od = float(cfg.get("dp1_od", 0) or 0) # L164
    dc1_od = float(cfg.get("dc1_od", 0) or 0) # L165
    dc2_od = float(cfg.get("dc2_od", 0) or 0) # L166
    dp_id = float(cfg.get("dp1_id", 0) or 0) # L167
    dc1_id = float(cfg.get("dc1_id", 0) or 0) # L168
    dc2_id = float(cfg.get("dc2_id", 0) or 0) # L169
    if depth_native <= 0: # L170
        return dp_od, dp_id # L171
    top_dc2 = depth_native - dc2_l # L172
    top_dc1 = depth_native - dc2_l - dc1_l # L173
    if dc2_l > 0 and dc2_od > 0 and md_native > top_dc2: # L174
        return dc2_od, dc2_id # L175
    if dc1_l > 0 and dc1_od > 0 and md_native > top_dc1: # L176
        return dc1_od, dc1_id # L177
    return dp_od, dp_id # L178
 # L179
 # L180
def _collect_breakpoints(depth_native, casings, bha_len, dc1_l, dc2_l): # L181
    """Sorted unique MDs where hole ID or pipe OD may change (annulus integration).""" # L182
    b = {0.0, depth_native} # L183
    for row in casings: # L184
        try: # L185
            s = float(row.get("start", 0)) # L186
            e = float(row.get("end", 0)) # L187
        except (TypeError, ValueError): # L188
            continue # L189
        lo, hi = min(s, e), max(s, e) # L190
        if 0 < lo < depth_native: # L191
            b.add(lo) # L192
        if 0 < hi < depth_native: # L193
            b.add(hi) # L194
    top_dc2 = depth_native - dc2_l # L195
    top_dc1 = depth_native - dc2_l - dc1_l # L196
    top_bha = depth_native - bha_len # L197
    for x in (top_dc2, top_dc1, top_bha): # L198
        if 0 < x < depth_native: # L199
            b.add(x) # L200
    return sorted(b) # L201
 # L202
 # L203
def _annulus_pressure_si(config, depth_m, q_lpm, n, tau_0_si, K_si, rho_kgm3, bit_diameter_in): # L204
    """Sum annulus friction over MD segments between casing/BHA boundaries (Pa).""" # L205
    length_unit = config.get("length_unit") or "m" # L206
    unit_to_m = 0.3048 if length_unit == "ft" else 1.0 # L207
    depth_native = _depth_m_to_native(depth_m, length_unit) # L208
    if depth_native <= 0: # L209
        return 0.0 # L210
    casings = _parse_casings(config) # L211
    dc1_l = float(config.get("dc1_length", 0) or 0) # L212
    dc2_l = float(config.get("dc2_length", 0) or 0) # L213
    bha_len = dc1_l + dc2_l # L214
    eps = 0.01 # L215
    bps = _collect_breakpoints(depth_native, casings, bha_len, dc1_l, dc2_l) # L216
    total_pa = 0.0 # L217
    for i in range(len(bps) - 1): # L218
        md0, md1 = bps[i], bps[i + 1] # L219
        len_native = md1 - md0 # L220
        if len_native <= 0: # L221
            continue # L222
        mid = (md0 + md1) / 2.0 # L223
        hole_id_in = _hole_id_at_md(mid, casings, bit_diameter_in) # L224
        pipe_od_in, _ = _pipe_geometry_at_md(mid, depth_native, config) # L225
        d_ann_in = hole_id_in - pipe_od_in # L226
        if d_ann_in <= eps: # L227
            continue # L228
             # L229
        d_o_m = hole_id_in * 0.0254 # L230
        d_i_m = pipe_od_in * 0.0254 # L231
        L_m = len_native * unit_to_m # L232
         # L233
        A_m2 = math.pi * ((d_o_m/2)**2 - (d_i_m/2)**2) # L234
        v = (q_lpm / 60000.0) / max(1e-6, A_m2) # L235
         # L236
        dp = hb_pressure_drop_annulus_si(v, d_o_m, d_i_m, L_m, n, tau_0_si, K_si, rho_kgm3) # L237
        total_pa += dp # L238
    return total_pa # L239
 # L240
 # L241
class SimState: # L242
    """ # L243
    Mutable simulator state advanced once per tick in `get_next`. # L244
    Depth integrates ROP over wall-clock dt; hydraulics use the same BHA model as the dashboard twin. # L245
    """ # L246
 # L247
    def __init__(self): # L248
        # Slowly drifting “surface” and mud properties (random walk or toward API targets). # L249
        self.rop = 15.0 # L250
        self.mud_level = 90.0 # L251
        self.flow_rate = 2000.0 # L252
        self.mud_temp = 45.0 # L253
         # L254
        # Rheology (semi-independent) # L255
        self.pv = 20.0 # L256
        self.yp = 12.0 # L257
        self.n_flow = 0.700 # L258
        self.density = 1.20 # L259
        self.theta_600 = 60.0 # L260
        self.theta_300 = 40.0 # L261
        self.theta_200 = 30.0 # L262
        self.theta_100 = 20.0 # L263
        self.theta_6 = 6.0 # L264
        self.theta_3 = 5.0 # L265
 # L266
        # Depth tracking # L267
        self.current_depth = None # L268
        self.last_time = time.time() # L269
        self.last_rheo_time = 0 # trigger immediate update on first tick # L270
 # L271
    def get_next(self, conn): # L272
        """ # L273
        Advances the simulation state by one semantic step. # L274
        It pulls configuration rules, evaluates real-time gradients, calculates BHA friction, # L275
        and finally packages the data dictionary corresponding to the DB schema. # L276
        """ # L277
        config = None # L278
        try: # L279
            cursor = conn.cursor() # L280
            cursor.execute("SELECT * FROM sim_config WHERE id=1") # L281
            row = cursor.fetchone() # L282
            if row: # L283
                config = dict(zip([col[0] for col in cursor.description], row)) # L284
        except Exception: # L285
            pass # L286
 # L287
        # Helper routine: Smoothly transitions a fluid variable towards an overriding target (if specified in config). # L288
        # Otherwise, applies a noisy random walk to imitate raw physical sensor fluctuations. # L289
        def update_val(current, target, min_v, max_v, step_size, rand_range, extra=0): # L290
            if target is not None and target > 0: # L291
                diff = target - current # L292
                if abs(diff) > step_size: # L293
                    current += step_size if diff > 0 else -step_size # Gradient seek # L294
                else: # L295
                    current = target # Lock onto target # L296
            else: # L297
                current += random.uniform(-rand_range, rand_range) + extra # Jitter # L298
            return max(min_v, min(max_v, current)) # L299
 # L300
        self.rop += random.uniform(-1.0, 1.0) # L301
        self.rop = max(5.0, min(25.0, self.rop)) # L302
 # L303
        # --- Real-Time Depth Derivation --- # L304
        # Instead of static strings, Depth continuously increases based on ROP (Rate of Penetration).  # L305
        # ROP is in active length unit / hour. # L306
        now = time.time() # L307
        dt = now - self.last_time # L308
        self.last_time = now # L309
 # L310
        if self.current_depth is None: # L311
            # Initialization logic: if restarting the script, start the depth from the end of the predefined casing scope.  # L312
            casing_depth = 0 # L313
            try: # L314
                if config and config.get('casings'): # L315
                    cases = json.loads(config['casings']) # L316
                    if cases: # L317
                        casing_depth = max([float(c.get('end', 0)) for c in cases]) # L318
            except Exception: pass # L319
            self.current_depth = casing_depth if casing_depth > 0 else 0 # L320
 # L321
        # rop is in unit/h. so dt is converted to hours # L322
        self.current_depth += self.rop * (dt / 3600.0) # L323
 # L324
        self.mud_level += random.uniform(-0.02, 0.02) # L325
        self.mud_level = max(50.0, min(100.0, self.mud_level)) # L326
         # L327
        target_flow = config.get("target_flow_rate") if config else None # L328
        self.flow_rate = update_val(self.flow_rate, target_flow, 1000.0, 3500.0, 25.0, 20.0) # L329
 # L330
        # 2. Update Mud & Rheological properties every 15 minutes (900 seconds) # L331
        if now - self.last_rheo_time >= 900: # L332
            self.last_rheo_time = now # L333
             # L334
            self.mud_temp += random.uniform(-0.5, 0.5) # L335
            self.mud_temp = max(40.0, min(60.0, self.mud_temp)) # L336
 # L337
            temp_effect = (self.mud_temp - 45.0) * -0.05 # L338
            self.pv = update_val(self.pv, None, 10.0, 35.0, 0, 0.5, extra=temp_effect) # L339
            self.yp = update_val(self.yp, None, 5.0, 30.0, 0.2, 0.3) # L340
             # L341
            self.theta_300 = self.pv + self.yp # L342
            self.theta_600 = self.theta_300 + self.pv # L343
            self.theta_200 = self.theta_300 * 0.75 + random.uniform(-1, 1) # L344
            self.theta_100 = self.theta_300 * 0.5 + random.uniform(-1, 1) # L345
            self.theta_3 = max(1.0, self.yp * 0.4 + random.uniform(-0.5, 0.5)) # L346
            self.theta_6 = self.theta_3 + random.uniform(0.5, 1.5) # L347
             # L348
            target_den = config.get("target_density") if config else None # L349
            self.density = update_val(self.density, target_den, 1.0, 2.7, 0.01, 0.02) # L350
 # L351
        # 3. Drilling Hydraulics Calculation Foundation --- # L352
        q_lpm = self.flow_rate # L353
        rho_kgm3 = self.density * 1000.0 # L354
        n_ypl, tau_0_si, K_si = calculate_ypl_parameters(self.theta_600, self.theta_300, self.theta_3) # L355
         # L356
        target_k = config.get("target_k") if config else None # L357
        target_n = config.get("target_n") if config else None # L358
         # L359
        if target_k is not None and target_k > 0: # L360
            K_si = target_k # L361
        if target_n is not None and target_n > 0: # L362
            n_ypl = target_n # L363
             # L364
        self.n_flow = n_ypl # L365
         # L366
        pump_press = 2500.0 # L367
        standpipe_press = 2500.0 # L368
         # L369
        if config: # L370
            n_size = float(config.get("bit_nozzle_size", 12)) # L371
            n_qty = int(config.get("bit_nozzle_qty", 3)) # L372
            nozzles = [n_size] * n_qty # L373
            tfa = sum([3.14159 * ((n/32.0)**2) / 4 for n in nozzles]) if nozzles else 0.5 # L374
            if tfa <= 0: tfa = 0.5 # L375
 # L376
            q_gpm = self.flow_rate * 0.264172 # L377
            mw_ppg = self.density * 8.345 # L378
             # L379
            bit_pd_psi = (mw_ppg * (q_gpm**2)) / (10858 * (tfa**2)) # L380
            bit_pd_pa = bit_pd_psi / 0.000145038 # L381
 # L382
            unit_to_m = 0.3048 if config.get("length_unit") == "ft" else 1.0 # L383
             # L384
            def calc_pd_pipe_si(length_native, inner_d_in): # L385
                L_m = length_native * unit_to_m # L386
                d_m = inner_d_in * 0.0254 # L387
                if L_m > 0 and d_m > 0: # L388
                    A_m2 = math.pi * (d_m/2)**2 # L389
                    v = (q_lpm / 60000.0) / max(1e-6, A_m2) # L390
                    return hb_pressure_drop_pipe_si(v, d_m, L_m, n_ypl, tau_0_si, K_si, rho_kgm3) # L391
                return 0.0 # L392
             # L393
            dc1_l = float(config.get("dc1_length", 200)) # L394
            dc2_l = float(config.get("dc2_length", 0)) # L395
            bha_length = dc1_l + dc2_l # L396
            dyn_dp1_l = max(0.0, self.current_depth - bha_length) # L397
 # L398
            pipe_pd_pa = 0.0 # L399
            pipe_pd_pa += calc_pd_pipe_si(dyn_dp1_l, float(config.get("dp1_id", 3.826))) # L400
            pipe_pd_pa += calc_pd_pipe_si(dc1_l, float(config.get("dc1_id", 2.50))) # L401
            pipe_pd_pa += calc_pd_pipe_si(dc2_l, float(config.get("dc2_id", 0))) # L402
 # L403
            bit_d = float(config.get("bit_diameter", 8.5)) # L404
            annulus_pd_pa = _annulus_pressure_si(config, self.current_depth, q_lpm, n_ypl, tau_0_si, K_si, rho_kgm3, bit_d) # L405
 # L406
            # Surface line pressure drop (E = 12 for Class 1-2) # L407
            dP_surface = 12.0 * self.density * ((q_lpm / 1000.0)**1.86) # L408
             # L409
            total_psi = dP_surface + (pipe_pd_pa + bit_pd_pa + annulus_pd_pa) * 0.000145038 # L410
             # L411
            pump_press = total_psi + random.uniform(-5, 5) # L412
            # Assuming standpipe press does not include the initial line loss from pump to standpipe, but the prompt says: # L413
            # "Bu formülün çıktısı doğrudan PSI cinsinden hesaplanmalı ve toplam sistem basınç kaybına (Pump_Press_psi ve Standpipe_Press_psi) bir baz yük olarak eklenmelidir." # L414
            standpipe_press = total_psi * 0.98 + random.uniform(-2, 2) # L415
 # L416
        pump_press = max(100.0, min(8000.0, pump_press)) # L417
 # L418
        return { # L419
            "Timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), # L420
            "ROP_m_h": round(self.rop, 2), # L421
            "Mud_Level_pct": round(self.mud_level, 2), # L422
            "Flow_Rate_lpm": round(self.flow_rate, 1), # L423
            "Pump_Press_psi": round(pump_press, 1), # L424
            "Standpipe_Press_psi": round(standpipe_press, 1), # L425
            "Mud_Temp_C": round(self.mud_temp, 1), # L426
            "Yield_Point": round(self.yp, 1), # L427
            "Plastic_Viscosity": round(self.pv, 1), # L428
            "Flow_Behavior_Index": round(self.n_flow, 3), # L429
            "Mud_Density_SG": round(self.density, 2), # L430
            "Current_Depth_m": round(self.current_depth, 2), # L431
            "theta_600": round(self.theta_600, 1), # L432
            "theta_300": round(self.theta_300, 1), # L433
            "theta_200": round(self.theta_200, 1), # L434
            "theta_100": round(self.theta_100, 1), # L435
            "theta_6": round(self.theta_6, 1), # L436
            "theta_3": round(self.theta_3, 1) # L437
        } # L438
 # L439
def save_to_db(conn, data): # L440
    """Persist one timestep; schema must match `init_db` / server expectations.""" # L441
    cursor = conn.cursor() # L442
    cursor.execute(''' # L443
        INSERT INTO sensor_data ( # L444
            Timestamp, ROP_m_h, Mud_Level_pct, Flow_Rate_lpm,  # L445
            Pump_Press_psi, Standpipe_Press_psi, Mud_Temp_C,  # L446
            Yield_Point, Plastic_Viscosity, Flow_Behavior_Index, Mud_Density_SG, Current_Depth_m, # L447
            theta_600, theta_300, theta_200, theta_100, theta_6, theta_3 # L448
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) # L449
    ''', ( # L450
        data["Timestamp"], data["ROP_m_h"], data["Mud_Level_pct"], data["Flow_Rate_lpm"], # L451
        data["Pump_Press_psi"], data["Standpipe_Press_psi"], data["Mud_Temp_C"], # L452
        data["Yield_Point"], data["Plastic_Viscosity"], data["Flow_Behavior_Index"], # L453
        data["Mud_Density_SG"], data.get("Current_Depth_m", 0), # L454
        data.get("theta_600", 0), data.get("theta_300", 0), data.get("theta_200", 0), # L455
        data.get("theta_100", 0), data.get("theta_6", 0), data.get("theta_3", 0) # L456
    )) # L457
    conn.commit() # L458
 # L459
if __name__ == "__main__": # L460
    print(f"Connecting to database {DB_NAME}...") # L461
    conn = init_db() # L462
    sim = SimState() # L463
    print("Correlated Data generation starting... (Press Ctrl+C to stop)") # L464
    try: # L465
        while True: # L466
            current_data = sim.get_next(conn) # L467
            save_to_db(conn, current_data) # L468
            print(f"[{current_data['Timestamp']}] Saved to DB: Flow={current_data['Flow_Rate_lpm']} => Pump Press={current_data['Pump_Press_psi']}") # L469
            time.sleep(2) # L470
    except KeyboardInterrupt: # L471
        print("\nData generation stopped.") # L472
    finally: # L473
        conn.close() # L474