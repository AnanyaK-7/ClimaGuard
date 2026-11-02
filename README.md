# ClimaCheck — Garnier ClimaGuard
### L'Oréal Sustainability Challenge 2026 (Gen Z India)
**Track:** Research & Innovation — Option 02  
**Author:** Ananya Kumari — B.Tech CSE (Data Science), Shri Shankaracharya Institute of Professional Management and Technology (SSIPMT), Raipur  
**Live Demo:** Localhost port `8000` / Ready for single-link Cloudflare & Vercel deployment  

---

> **Student Concept Disclaimer:**  
> Student concept for the L'Oréal Sustainability Challenge 2026. Not an official L'Oréal or Garnier product. Rule-based guidance, not medical advice. Environmental data via Open-Meteo; AQI is approximated from PM2.5 using CPCB breakpoints.

---

## 🌿 Overview & Problem Statement

Indian urban youth face intense, volatile atmospheric stressors that compound daily skin barrier vulnerability:
- **Severe winter particulate smog (PM2.5 > 250 µg/m³)** triggering epidermal oxidative stress and micro-particulate adhesion in Delhi/NCR.
- **Tropical humidity (> 80% RH)** accelerating sebum hypersecretion and pore congestion in Mumbai, Kolkata, and Chennai.
- **Extreme arid summer heatwaves (40°C+, UV Index 10+)** precipitating trans-epidermal water loss (TEWL) in Jaipur and Ahmedabad.
- **Spiking high-altitude solar radiation** in Bengaluru and Pune.

**ClimaCheck** is a climate-adaptive barrier skincare intelligence engine designed for **Garnier ClimaGuard** (a biomimetic, weightless serum-gel). It bridges real-time environmental telemetry with individual tactile skin feedback to suggest an explained, sustainable barrier routine across three dynamic modes: **Shield**, **Hydrate**, and **Balance**.

---

## ✨ Key Features

### 1. Transparent Environmental Stress Level (0–100)
Quantifies ambient atmospheric pressure using transparent, verifiable contributions:
- **Particulate Burden (PM2.5):** Approximated using Indian Central Pollution Control Board (CPCB) breakpoints (up to 75 pts).
- **Photostress (Solar UV):** Weighted by daytime ultraviolet index (up to 20 pts).
- **Moisture Stress (Humidity):** Deviation from ideal 40%–65% skin comfort band (up to 15 pts).
- **Calibrated Tiers:**
  - `0–30`: Low Stress
  - `31–54`: Moderate Stress
  - `55–74`: Moderate-High (guaranteed ≥ 55 for Poor AQI 201–300)
  - `75–100`: High Stress (guaranteed ≥ 75 for AQI > 300)
*Note: This is an ambient environmental indicator only; it does not claim to measure physiological skin condition.*

### 2. Interactive Climate Extreme Simulator
One-click simulation toolbar for competition evaluators to test ClimaGuard under India's harshest urban weather shocks:
- **Delhi Smog:** AQI 348 (Very Poor), PM2.5 182 µg/m³ → **Shield Mode** (High Stress ≥ 75).
- **Mumbai Monsoon:** 88% Relative Humidity, 31°C → **Balance Mode**.
- **Jaipur Heat:** 41.5°C, 19% RH, UV Index 10.4 → **Hydrate / Shield Mode**.
- **Bengaluru Sun:** UV 7.8, Clean air (AQI 40) → **Shield Mode**.
- **Live Telemetry:** Real-time Open-Meteo weather via GPS or city search.
*All values during simulation are clearly labeled "Simulated" across all cards.*

### 3. Garnier Green Sciences Formulation Dossier
- **5% Pure Niacinamide:** May help control excess oil and supports ceramide production and overnight barrier recovery.
- **1.2% Ceramide NP:** Intercalates into stratum corneum lipid bilayers.
- **2% Ectoin Extremolyte:** Forms a natural hydro-complex shield around keratinocytes to help protect against particulate adhesion.
- **3.5% Upcycled Sugarcane Squalane:** Ecocert-certified biomimetic emollient with zero petro-chemical footprint.
- **Indian Adaptogens:** Amla (*Emblica Officinalis*, high bio-active Vitamin C) & Centella Asiatica (*Gotu Kola*, Madecassoside fraction).
- **Formulation Evaluation Status:** Conceptual study design on Reconstructed Human Epidermis (RHE) for competition evaluation; shows no laboratory or clinical results.

### 4. Privacy & Sustainable Packaging
- **Check-in data stays on your device:** Stored in `localStorage` by default (no mandatory cloud accounts or tracking).
- **68% virgin plastic reduction** through 100% PCR aluminum outer shell with mono-material PP refill pods.
- **94% readily biodegradable formula chassis** (OECD 301 standard).

### 5. Night Detection & Routine Dosing
- **Automatic PM Default:** When solar UV is 0 (nighttime), the application automatically presents the **PM (Night Repair)** routine.
- **Non-Misleading Claims:** Omits daytime-specific claims like "before peak midday sun" during night checks.

---

## 🏗 Monorepo Architecture

```
D:\loreal challenge\
├── api\
│   ├── __init__.py
│   └── index.py             # FastAPI backend (Open-Meteo caching, CPCB AQI, BSI engine, Supabase)
├── tests\
│   ├── __init__.py
│   └── test_api.py          # 33 unit and integration tests (pytest)
├── index.html               # Responsive 3-column dashboard (Tailwind CSS CDN, Fraunces serif)
├── style.css                # Luxury derm-tech design tokens, SVG circular meters, animations
├── app.js                   # Client controller, 0ms reactivity, simulation runner, localStorage sync
├── run.py                   # Port-conflict safe local runner with UTF-8 console support
├── verify_e2e.py            # Automated Chrome CDP end-to-end verification suite
├── requirements.txt         # fastapi, uvicorn, httpx, pydantic, pytest
└── vercel.json              # Serverless API rewrites for Vercel
```

---

## ⚡ Quick Start (Local Setup)

### 1. Prerequisites
- Python 3.10+ installed
- Modern browser (Chrome, Edge, Firefox, Safari)

### 2. Install Dependencies
```bash
cd "D:\loreal challenge"
pip install -r requirements.txt
```

### 3. Run the Application
```bash
python run.py
```
Open [http://localhost:8000](http://localhost:8000) in your browser.  
*(If port 8000 is occupied, `run.py` automatically detects and binds to the next available port).*

### 4. Run Pytest Suite
```bash
python -m pytest tests -v
```
All **33 automated tests** pass, verifying:
- CPCB PM2.5 breakpoints and boundary edges (0, 30, 60, 90, 120, 250, 600 µg/m³).
- Environmental Stress Level scoring, clamping, and tier classifications.
- Decision rule priority (Shield > Hydrate > Balance).
- Exact boundary triggers (UV = 6.0 vs 5.9, humidity = 40.0% vs 39.9%, AQI = 200 vs 201).
- All FastAPI endpoints (`/api/health`, `/api/conditions`, `/api/recommend`, `/api/simulate`, `/api/actives`, `/api/checkins`).

---

## 📡 API Endpoints Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check, student attribution, and status confirmation |
| `GET` | `/api/conditions?city=<name>` | Open-Meteo telemetry fetch, CPCB AQI approximation, 10-min cache |
| `POST` | `/api/recommend` | Evaluates environmental metrics + skin feel to prescribe barrier mode |
| `GET` | `/api/simulate?preset=<city>` | Preset climate shock data for competition demonstrations |
| `GET` | `/api/actives` | Formulation bio-actives dossier and conceptual in vitro study protocol |
| `GET/POST`| `/api/checkins` | Self-reported comfort log persistence (Supabase / local fallback) |

---

## 🚀 Cloud Deployment Options

### Option A: Cloudflare Pages (Recommended Static Edge)
1. Push repository to GitHub or GitLab.
2. In Cloudflare Dashboard, go to **Workers & Pages** → **Create Application** → **Pages** → **Connect to Git**.
3. Build Settings: Framework: `None`, Build command: `(empty)`, Build output directory: `.`.
4. Deploy — global edge distribution with automatic HTTPS and instant client reactivity.

### Option B: Vercel (Unified Monorepo)
Configured via `vercel.json`:
```bash
npm i -g vercel
vercel
```

---

## 👥 Competition Details & Credits

- **Competition:** L'Oréal Sustainability Challenge 2026
- **Track:** Option 02: Research & Innovation Track
- **Author:** Ananya Kumari
- **Institution:** Shri Shankaracharya Institute of Professional Management and Technology (SSIPMT), Raipur
- **Degree:** B.Tech Computer Science and Engineering (Data Science)
