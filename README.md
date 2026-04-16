# Digital Twins in Drilling

A small **drilling digital-twin demo**: a Python simulator writes time-series sensor data to SQLite, a **FastAPI** service exposes it over HTTP, and a **React (Vite)** dashboard visualizes pressures, flow, rheology, and configurable wellbore/BHA parameters. The UI supports **Turkish and English** labels and several engineering unit choices.

Initial scaffolding and much of the first implementation were produced with **Google Antigravity**; this repository may include follow-up fixes and documentation.

## Architecture

| Piece | Role |
|--------|------|
| `mock_data_gen.py` | Correlated random walk + simplified hydraulics; inserts one row every ~2 s into `sensor_data.db`. |
| `server.py` | REST API: latest row, historical series (with coarse downsampling for long ranges), read/write simulator config. |
| `dashboard/` | Vite + React + Recharts; polls the API and renders cards, pump gauge, tank level, and modals. |

## Prerequisites

- Python 3.10+ (recommended)
- Node.js 18+ (for the dashboard)

## Setup

### 1. Python dependencies

From the repository root:

```bash
python -m pip install -r requirements.txt
```

### 2. Generate data (terminal 1)

```bash
python mock_data_gen.py
```

Leave this running so the database keeps updating.

### 3. API server (terminal 2)

```bash
python server.py
```

The API listens on **http://localhost:8000** (see `uvicorn.run` in `server.py`).

### 4. Dashboard (terminal 3)

```bash
cd dashboard
npm install
npm run dev
```

Open the URL Vite prints (typically **http://localhost:5173**). The frontend is configured to call `http://localhost:8000`.

## Optional: PDF text extraction

`extract_pdf.py` uses `pypdf` to dump text from a paper PDF into `pdf_text.txt` (adjust the filename inside the script if needed).

## Project layout

- `sensor_data.db` — SQLite file (created when you run the generator or server).
- `dashboard/src/App.jsx` — Main UI, unit conversion, and API polling.

## License

Add a license file if you publish this repo publicly.
