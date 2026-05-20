"""
HTTP API for the drilling dashboard. Reads/writes SQLite (`sensor_data.db`).

Responsibilities:
    - Serve the latest sensor row for 1 Hz dashboard polling (`/api/latest-data`).
    - Serve downsampled history for Recharts (`/api/history`) so long windows do not overload the browser.
    - Persist BHA / casing / bit configuration (`sim_config`) so `mock_data_gen.py` picks it up on the next tick.

Process model:
    Run **after** `mock_data_gen.py` has created tables; `POST /api/config` recreates `sim_config` with a single row (id=1).

Listen address:
    `uvicorn` binds `0.0.0.0:8000` at the bottom of this file.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
import uvicorn
from contextlib import contextmanager
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import Optional

app = FastAPI()


@app.on_event("startup")
def startup_event():
    """Verify that sim_config is created and populated with the default row on launch."""
    import sqlite3
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    # Check if table exists
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sim_config'")
    table_exists = cursor.fetchone()
    if not table_exists:
        print("Auto-seeding: Creating sim_config table...")
        cursor.execute('''
            CREATE TABLE sim_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                casings TEXT, length_unit TEXT,
                dp1_id REAL, dp1_od REAL, dp1_length REAL,
                hwdp_id REAL, hwdp_od REAL, hwdp_length REAL,
                dc1_id REAL, dc1_od REAL, dc1_length REAL,
                dc2_id REAL, dc2_od REAL, dc2_length REAL,
                bit_diameter REAL, bit_nozzle_size REAL, bit_nozzle_qty INTEGER,
                target_density REAL, target_k REAL, target_n REAL, target_flow_rate REAL
            )
        ''')
    
    # Check if a default row exists
    cursor.execute("SELECT count(*) FROM sim_config WHERE id=1")
    count = cursor.fetchone()[0]
    if count == 0:
        print("Auto-seeding: Populating default wellbore/BHA config...")
        cursor.execute('''
            INSERT INTO sim_config (
                id, casings, length_unit, bit_diameter, bit_nozzle_size, bit_nozzle_qty,
                dp1_id, dp1_od, dp1_length,
                hwdp_id, hwdp_od, hwdp_length,
                dc1_id, dc1_od, dc1_length, dc2_id, dc2_od, dc2_length,
                target_density, target_k, target_n, target_flow_rate
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            '[{"start": 0, "end": 50, "id": 18.936}, {"start": 0, "end": 250, "id": 12.615}]',
            'm', 12.25, 12.0, 3,
            2.602, 3.5, 1500.0,
            3.0, 5.0, 18.78,
            2.813, 8.0, 72.0,
            2.813, 5.0, 36.0,
            None, None, None, None
        ))
    conn.commit()
    conn.close()



class SimConfig(BaseModel):
    """
    Payload for `POST /api/config`: mirrors the keys the React Wellbore & BHA modal edits.
    Optional target_* fields are legacy hooks for the simulator to bias density / YP / flow.
    """
    target_density: Optional[float] = None
    target_k: Optional[float] = None
    target_n: Optional[float] = None
    target_flow_rate: Optional[float] = None
    casings: str
    length_unit: str
    dp1_id: float
    dp1_od: float
    dp1_length: float
    hwdp_id: float
    hwdp_od: float
    hwdp_length: float
    dc1_id: float
    dc1_od: float
    dc1_length: float
    dc2_id: float
    dc2_od: float
    dc2_length: float
    bit_diameter: float
    bit_nozzle_size: float
    bit_nozzle_qty: int

# Allow CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_NAME = "sensor_data.db"

@contextmanager
def get_db_cursor():
    """
    Yields a database cursor configured with sqlite3.Row factory.
    This ensures that each fetched row can be cleanly mapped to a Python `dict(row)`.
    """
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    try:
        yield conn.cursor()
    finally:
        conn.close()

@app.get("/api/latest-data")
def get_latest_data():
    """
    Retrieves the absolute most recent sensor data record from the DB.
    This empowers the React dashboard's primary numeric displays (e.g., Sensor Cards).
    """
    with get_db_cursor() as cursor:
        cursor.execute("SELECT * FROM sensor_data ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        if row:
            return dict(row)
        return {"error": "No data available yet"}

@app.get("/api/history")
def get_history(limit: int = 30, minutes: int = None, hours: int = None):
    """
    Retrieves historical sensor data to plot on the React-Recharts components.
    Includes smart downsampling. If 24 hours of data are requested, sending 
    1 row/sec (86,400 rows) would immediately freeze the browser. 
    Thus, logic here reduces temporal footprint modulo id.
    """
    with get_db_cursor() as cursor:
        if minutes or hours:
            # Query dataset restricted to the provided timeframe bounds
            delta = timedelta(minutes=minutes or 0, hours=hours or 0)
            threshold = (datetime.now() - delta).strftime("%Y-%m-%d %H:%M:%S")
            
            # Downsample intelligently. Assumes ~1 record recorded every 2 seconds.
            total_seconds = (minutes or 0) * 60 + (hours or 0) * 3600
            modulo = max(1, int(total_seconds / 2 / 200)) # Caps at ~200 data points for UI stability.

            # Returns only every 'modulo' row id in ascending chronological order
            cursor.execute("SELECT * FROM sensor_data WHERE Timestamp >= ? AND id % ? = 0 ORDER BY id ASC", (threshold, modulo))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        else:
            # Simple retrieval context: Get the last 'limit' records in ascending order
            cursor.execute("""
                SELECT * FROM (
                    SELECT * FROM sensor_data ORDER BY id DESC LIMIT ?
                ) ORDER BY id ASC
            """, (limit,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

@app.get("/api/config")
def get_config():
    """
    Exposes current underlying parameters and configurations from 'sim_config'.
    Returns default values if the DB layout is not yet instantiated.
    """
    with get_db_cursor() as cursor:
        try:
            cursor.execute("SELECT * FROM sim_config WHERE id=1")
            row = cursor.fetchone()
            if row:
                return dict(row)
        except sqlite3.OperationalError:
            pass # Table doesn't exist yet, fallback to hardcoded defaults
            
        return {
            "casings": '[{"start": 0, "end": 50, "id": 18.936}, {"start": 0, "end": 250, "id": 12.615}]',
            "length_unit": "m",
            "dp1_id": 2.602, "dp1_od": 3.5, "dp1_length": 1500.0,
            "hwdp_id": 3.0, "hwdp_od": 5.0, "hwdp_length": 18.78,
            "dc1_id": 2.813, "dc1_od": 8.0, "dc1_length": 72.0,
            "dc2_id": 2.813, "dc2_od": 5.0, "dc2_length": 36.0,
            "bit_diameter": 12.25, "bit_nozzle_size": 12.0, "bit_nozzle_qty": 3,
            "target_density": None, "target_k": None, "target_n": None, "target_flow_rate": None
        }

@app.post("/api/config")
def set_config(config: SimConfig):
    """
    Overwrites the single-row (`id = 1`) `sim_config` table constraint.
    It guarantees that physics calculations on the Python background worker
    reflect exactly what the user set through React immediately.
    """
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('DROP TABLE IF EXISTS sim_config')
    
    cursor.execute('''
        CREATE TABLE sim_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            casings TEXT, length_unit TEXT,
            dp1_id REAL, dp1_od REAL, dp1_length REAL,
            hwdp_id REAL, hwdp_od REAL, hwdp_length REAL,
            dc1_id REAL, dc1_od REAL, dc1_length REAL,
            dc2_id REAL, dc2_od REAL, dc2_length REAL,
            bit_diameter REAL, bit_nozzle_size REAL, bit_nozzle_qty INTEGER,
            target_density REAL, target_k REAL, target_n REAL, target_flow_rate REAL
        )
    ''')
    cursor.execute('''
        INSERT OR REPLACE INTO sim_config (
            id, casings, length_unit, bit_diameter, bit_nozzle_size, bit_nozzle_qty,
            dp1_id, dp1_od, dp1_length,
            hwdp_id, hwdp_od, hwdp_length,
            dc1_id, dc1_od, dc1_length, dc2_id, dc2_od, dc2_length,
            target_density, target_k, target_n, target_flow_rate
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        config.casings, config.length_unit, config.bit_diameter, config.bit_nozzle_size, config.bit_nozzle_qty,
        config.dp1_id, config.dp1_od, config.dp1_length,
        config.hwdp_id, config.hwdp_od, config.hwdp_length,
        config.dc1_id, config.dc1_od, config.dc1_length,
        config.dc2_id, config.dc2_od, config.dc2_length,
        config.target_density, config.target_k, config.target_n, config.target_flow_rate
    ))
    conn.commit()
    conn.close()
    return {"status": "success"}

if __name__ == "__main__":
    print("Starting API Server on http://0.0.0.0:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
