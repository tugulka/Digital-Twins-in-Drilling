"""
HTTP API for the drilling dashboard. Reads/writes SQLite (`sensor_data.db`):
- Rows are appended by `mock_data_gen.py` (simulated rig sensors).
- `GET /api/latest-data` and `/api/history` feed the React charts and cards.
- `GET/POST /api/config` stores BHA/wellbore knobs used by the simulator.
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

class SimConfig(BaseModel):
    target_density: Optional[float] = None
    target_yp: Optional[float] = None
    target_flow_rate: Optional[float] = None
    casings: str
    length_unit: str
    dp1_id: float
    dp1_od: float
    dp1_length: float
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
    """Yields a cursor with Row factory so each row maps cleanly to `dict(row)`."""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    try:
        yield conn.cursor()
    finally:
        conn.close()

@app.get("/api/latest-data")
def get_latest_data():
    with get_db_cursor() as cursor:
        cursor.execute("SELECT * FROM sensor_data ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        if row:
            return dict(row)
        return {"error": "No data available yet"}

@app.get("/api/history")
def get_history(limit: int = 30, minutes: int = None, hours: int = None):
    with get_db_cursor() as cursor:
        if minutes or hours:
            delta = timedelta(minutes=minutes or 0, hours=hours or 0)
            threshold = (datetime.now() - delta).strftime("%Y-%m-%d %H:%M:%S")
            # Downsample intelligently to ensure the browser doesn't freeze
            # Assume 1 record every 2 seconds roughly.
            total_seconds = (minutes or 0) * 60 + (hours or 0) * 3600
            modulo = max(1, int(total_seconds / 2 / 200)) # max 200~300 data points

            cursor.execute("SELECT * FROM sensor_data WHERE Timestamp >= ? AND id % ? = 0 ORDER BY id ASC", (threshold, modulo))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        else:
            # Get last 'limit' records in ascending order for charting
            cursor.execute("""
                SELECT * FROM (
                    SELECT * FROM sensor_data ORDER BY id DESC LIMIT ?
                ) ORDER BY id ASC
            """, (limit,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

@app.get("/api/config")
def get_config():
    with get_db_cursor() as cursor:
        try:
            cursor.execute("SELECT * FROM sim_config WHERE id=1")
            row = cursor.fetchone()
            if row:
                return dict(row)
        except sqlite3.OperationalError:
            pass
        return {
            "casings": '[{"start": 0, "end": 3000, "id": 8.5}]',
            "length_unit": "m",
            "dp1_id": 3.826, "dp1_od": 4.5, "dp1_length": 1500,
            "dc1_id": 2.50, "dc1_od": 4.75, "dc1_length": 200,
            "dc2_id": 0, "dc2_od": 0, "dc2_length": 0,
            "bit_diameter": 6.0, "bit_nozzle_size": 12, "bit_nozzle_qty": 3,
            "target_density": None, "target_yp": None, "target_flow_rate": None
        }

@app.post("/api/config")
def set_config(config: SimConfig):
    """Replaces the single-row sim_config table (simple persistence without migrations)."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('DROP TABLE IF EXISTS sim_config')
    cursor.execute('''
        CREATE TABLE sim_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            casings TEXT, length_unit TEXT,
            dp1_id REAL, dp1_od REAL, dp1_length REAL,
            dc1_id REAL, dc1_od REAL, dc1_length REAL,
            dc2_id REAL, dc2_od REAL, dc2_length REAL,
            bit_diameter REAL, bit_nozzle_size REAL, bit_nozzle_qty INTEGER,
            target_density REAL, target_yp REAL, target_flow_rate REAL
        )
    ''')
    cursor.execute('''
        INSERT OR REPLACE INTO sim_config (
            id, casings, length_unit, bit_diameter, bit_nozzle_size, bit_nozzle_qty,
            dp1_id, dp1_od, dp1_length,
            dc1_id, dc1_od, dc1_length, dc2_id, dc2_od, dc2_length,
            target_density, target_yp, target_flow_rate
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        config.casings, config.length_unit, config.bit_diameter, config.bit_nozzle_size, config.bit_nozzle_qty,
        config.dp1_id, config.dp1_od, config.dp1_length,
        config.dc1_id, config.dc1_od, config.dc1_length,
        config.dc2_id, config.dc2_od, config.dc2_length,
        config.target_density, config.target_yp, config.target_flow_rate
    ))
    conn.commit()
    conn.close()
    return {"status": "success"}

if __name__ == "__main__":
    print("Starting API Server on http://0.0.0.0:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
