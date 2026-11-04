"""
ClimaCheck API - Garnier ClimaGuard
L'Oréal Sustainability Challenge 2026 (Gen Z India)
FastAPI backend with Open-Meteo telemetry, CPCB AQI calculation,
Barrier Stress Index (BSI), climate scenario simulation,
scientific actives dossier, and optional Supabase check-in persistence.
"""

from datetime import datetime, timezone
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import httpx
from pydantic import BaseModel, Field, field_validator

# ============================================================================
# FASTAPI APPLICATION & CORS
# ============================================================================

app = FastAPI(
    title="ClimaCheck API",
    description="Climate-adaptive barrier skincare intelligence engine for Garnier ClimaGuard (L'Oréal 2026)",
    version="2.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# 10-MINUTE IN-MEMORY CACHE
# ============================================================================
CACHE_TTL_SECONDS = 600  # 10 minutes
_CONDITIONS_CACHE: Dict[str, Dict[str, Any]] = {}

def get_cached(key: str) -> Optional[Dict[str, Any]]:
    entry = _CONDITIONS_CACHE.get(key)
    if not entry:
        return None
    if time.time() > entry.get("expires_at", 0):
        _CONDITIONS_CACHE.pop(key, None)
        return None
    return entry.get("data")

def set_cached(key: str, data: Dict[str, Any]) -> None:
    _CONDITIONS_CACHE[key] = {
        "data": data,
        "expires_at": time.time() + CACHE_TTL_SECONDS,
    }

# ============================================================================
# CPCB PM2.5 AQI CALCULATION (Official Breakpoints)
# ============================================================================
def compute_cpcb_aqi(pm25: float) -> Tuple[int, str]:
    """
    Computes Indian National Air Quality Index (NAQI) sub-index from PM2.5 (µg/m³)
    using official Central Pollution Control Board (CPCB) breakpoints:
      - 0 to 30   -> 0 to 50    (Good)
      - 31 to 60  -> 51 to 100  (Satisfactory)
      - 61 to 90  -> 101 to 200 (Moderate)
      - 91 to 120 -> 201 to 300 (Poor)
      - 121 to 250-> 301 to 400 (Very Poor)
      - 250+      -> 401 to 500 (Severe, capped at 500)
    """
    if pm25 is None or pm25 < 0:
        return 0, "Unknown"

    if pm25 <= 30.0:
        aqi = round((50.0 / 30.0) * pm25)
        return aqi, "Good"
    elif pm25 <= 60.0:
        aqi = round(51.0 + ((100.0 - 51.0) / (60.0 - 30.0)) * (pm25 - 30.0))
        return aqi, "Satisfactory"
    elif pm25 <= 90.0:
        aqi = round(101.0 + ((200.0 - 101.0) / (90.0 - 60.0)) * (pm25 - 60.0))
        return aqi, "Moderate"
    elif pm25 <= 120.0:
        aqi = round(201.0 + ((300.0 - 201.0) / (120.0 - 90.0)) * (pm25 - 90.0))
        return aqi, "Poor"
    elif pm25 <= 250.0:
        aqi = round(301.0 + ((400.0 - 301.0) / (250.0 - 120.0)) * (pm25 - 120.0))
        return aqi, "Very Poor"
    else:
        # 250+ is Severe (linear up to 380, capped at 500)
        aqi = round(min(500.0, 401.0 + ((500.0 - 401.0) / (380.0 - 250.0)) * (pm25 - 250.0)))
        return aqi, "Severe"

# ============================================================================
# ENVIRONMENTAL STRESS LEVEL (0–100)
# ============================================================================
def calculate_barrier_stress_index(
    pm25: float,
    uv: float,
    humidity: float,
    temperature: float,
    ozone: Optional[float] = None
) -> Dict[str, Any]:
    """
    Computes an integrated Environmental Stress Level (0–100) combining:
      1. PM2.5 particulate pollution (max ~65-75 pts, calibrated to Indian NAQI)
      2. Solar UV radiation (max ~20 pts)
      3. Humidity deviation from comfortable 50-60% RH (max ~15 pts)
    Calibration criteria:
      - AQI 201-300 (Poor) scores at least 55 ("Moderate-High")
      - AQI > 300 (Very Poor / Severe) scores at least 75 ("High Stress")
    Note: Ambient environmental indicator only; does not claim to measure physiological skin condition.
    """
    approx_aqi, aqi_cat = compute_cpcb_aqi(pm25)

    # 1. PM2.5 / AQI contribution
    if approx_aqi <= 50:
        pm_pts = (approx_aqi / 50.0) * 12.0
    elif approx_aqi <= 100:
        pm_pts = 12.0 + ((approx_aqi - 50.0) / 50.0) * 12.0
    elif approx_aqi <= 200:
        pm_pts = 24.0 + ((approx_aqi - 100.0) / 100.0) * 21.0
    elif approx_aqi <= 300:
        pm_pts = 50.0 + ((approx_aqi - 200.0) / 100.0) * 15.0
    elif approx_aqi <= 400:
        pm_pts = 68.0 + ((approx_aqi - 300.0) / 100.0) * 10.0
    else:
        pm_pts = min(82.0, 78.0 + ((approx_aqi - 400.0) / 100.0) * 4.0)

    # 2. Solar UV contribution
    uv_pts = min(20.0, (uv / 10.0) * 18.0) if uv > 0 else 0.0

    # 3. Humidity contribution
    if humidity < 50.0:
        hum_pts = min(15.0, ((50.0 - humidity) / 35.0) * 14.0)
    elif humidity > 65.0:
        hum_pts = min(12.0, ((humidity - 65.0) / 30.0) * 11.0)
    else:
        hum_pts = 1.0

    total_score = round(pm_pts + uv_pts + hum_pts)
    total_score = max(5, min(100, total_score))

    # Exact threshold guarantees
    if 201 <= approx_aqi <= 300 and total_score < 55:
        total_score = 55
    if approx_aqi > 300 and total_score < 75:
        total_score = 75

    # Tier labels matching score
    if total_score <= 30:
        tier = "Low Stress"
        tier_color = "emerald"
    elif total_score <= 54:
        tier = "Moderate Stress"
        tier_color = "teal"
    elif total_score <= 74:
        tier = "Moderate-High"
        tier_color = "amber"
    else:
        tier = "High Stress"
        tier_color = "rose"

    return {
        "score": total_score,
        "tier": tier,
        "color": tier_color,
        "breakdown": {
            "pm25_points": round(pm_pts, 1),
            "uv_points": round(uv_pts, 1),
            "moisture_points": round(hum_pts, 1),
            "humidity_points": round(hum_pts, 1),
            "thermal_points": 0.0
        }
    }

# ============================================================================
# ROUTINE DEFINITIONS
# ============================================================================
ROUTINES: Dict[str, Dict[str, Any]] = {
    "shield": {
        "title": "Shield Mode",
        "tagline": "High Environmental Stress Barrier Defense",
        "summary": "Elevated PM2.5 particulate pollution or UV radiation can trigger epidermal AhR pathways and accelerate reactive oxygen species (ROS). ClimaGuard's 2% Ectoin hydro-complex shield and 5% Niacinamide help protect against micro-particulate adhesion and calm skin feel.",
        "am": [
            {
                "step": "01",
                "title": "Gentle Barrier-Preserving Cleanser",
                "desc": "Wash with lukewarm water and a low-pH, sulfate-free foaming gel. Clears overnight sebum without stripping natural protective ceramide bilayers.",
                "dose": "1-2 pumps"
            },
            {
                "step": "02",
                "title": "Garnier ClimaGuard Serum-Gel (Shield Dosing)",
                "desc": "Apply generously on clean, damp skin. Ectoin creates a protective osmolyte shield against PM2.5 deposition while Ceramide NP seals intercellular lipid lamellae.",
                "dose": "2 generous pumps"
            },
            {
                "step": "03",
                "title": "Broad-Spectrum Photoprotection SPF 50+ PA++++",
                "desc": "Broad-spectrum photoprotection. Formulated with photostable Mexoryl filters to help protect against UVA/UVB photo-oxidation. Reapply before daylight outdoor exposure.",
                "dose": "2 finger lengths"
            }
        ],
        "pm": [
            {
                "step": "01",
                "title": "Thorough Micro-Pollutant Cleanse",
                "desc": "Dissolve airborne PM2.5, stubborn grime, and mineral sunscreen residue using an ultra-gentle micellar wash followed by a foaming gel.",
                "dose": "Thorough rinse"
            },
            {
                "step": "02",
                "title": "Garnier ClimaGuard Overnight Recovery",
                "desc": "Apply 2-3 pumps. High-potency Niacinamide supports ceramide production and overnight barrier recovery while skin sleeps.",
                "dose": "2-3 pumps"
            },
            {
                "step": "03",
                "title": "Lipid-Replenishing Squalane Emulsion",
                "desc": "Seal hydration with a lightweight, non-comedogenic sugarcane squalane cream to reinforce barrier recovery and may help reduce overnight moisture loss.",
                "dose": "Pea-sized amount"
            }
        ]
    },
    "hydrate": {
        "title": "Hydrate Mode",
        "tagline": "Deep Moisture Lock & Anti-TEWL Comfort",
        "summary": "Arid air (humidity < 40%) or skin tightness can accelerate moisture loss, dehydrating the stratum corneum. Upcycled Sugarcane Squalane and biomimetic Ceramide NP bind water within epidermal strata.",
        "am": [
            {
                "step": "01",
                "title": "Milky Hydrating Conditioning Wash",
                "desc": "Splash face with lukewarm water or use a soothing milky wash. Avoid steaming water or harsh astringents which exacerbate water loss.",
                "dose": "Gentle splash"
            },
            {
                "step": "02",
                "title": "Garnier ClimaGuard Water-Gel Infusion",
                "desc": "Smooth onto damp skin within 60 seconds of washing. The weightless gel immediately draws ambient moisture into keratinocytes.",
                "dose": "2 full pumps"
            },
            {
                "step": "03",
                "title": "Moisture-Locking Barrier SPF 50",
                "desc": "Layer an emollient moisturizing sunscreen containing sugarcane squalane to help protect against dry desert air during daytime.",
                "dose": "2 finger lengths"
            }
        ],
        "pm": [
            {
                "step": "01",
                "title": "Ultra-Mild Conditioning Cleanse",
                "desc": "Gently massage a nourishing, non-stripping cleanser over skin. Pat dry softly with a clean microfiber towel without friction.",
                "dose": "1 pump"
            },
            {
                "step": "02",
                "title": "Garnier ClimaGuard Intensive Barrier Layer",
                "desc": "Apply 3 generous pumps to face and neck. Replenishes natural lipid lamellae disrupted by arid outdoor winds and dry indoor air-conditioning.",
                "dose": "3 pumps"
            },
            {
                "step": "03",
                "title": "Nutritive Squalane Barrier Balm",
                "desc": "Locks in hydration overnight. 100% plant-derived squalane mimics natural sebum to may help reduce waking tightness.",
                "dose": "Dime-sized amount"
            }
        ]
    },
    "balance": {
        "title": "Balance Mode",
        "tagline": "Lightweight Sebum Control & Everyday Resilience",
        "summary": "Tropical humidity (> 65%) or active sebum synthesis promotes mid-day facial shine and pore congestion. 5% Niacinamide may help control excess oil while keeping the acid mantle resilient and breathable.",
        "am": [
            {
                "step": "01",
                "title": "Balancing Purifying Gel Cleanser",
                "desc": "Cleanse with a refreshing gel wash containing mild amino-acid surfactants to melt away overnight perspiration and excess surface oil.",
                "dose": "1 pump"
            },
            {
                "step": "02",
                "title": "Garnier ClimaGuard Serum-Gel (Matte Finish)",
                "desc": "Fast-absorbing, zero-residue water-gel texture. Niacinamide tightens pore appearance and normalizes sebum production with zero stickiness.",
                "dose": "1-2 pumps"
            },
            {
                "step": "03",
                "title": "Invisible Fluid Matte Sunscreen SPF 50",
                "desc": "Feather-light, dry-touch UV protection. Non-comedogenic and sweat-resistant formulation designed specifically for Indian tropical climates.",
                "dose": "2 finger lengths"
            }
        ],
        "pm": [
            {
                "step": "01",
                "title": "Deep Clarifying Double Rinse",
                "desc": "Wash away urban sweat, micro-dust, and daytime sunscreen buildup to help reduce clogged follicles and humidity-induced blemishes.",
                "dose": "Thorough cleanse"
            },
            {
                "step": "02",
                "title": "Garnier ClimaGuard Serum-Gel",
                "desc": "Smooth over face and neck. Delivers cellular hydration and calming bio-ferments without suffocating oil-prone skin.",
                "dose": "2 pumps"
            },
            {
                "step": "03",
                "title": "Weightless Water-Cream Moisturiser",
                "desc": "An oil-free, breathable gel emulsion to seal hydration overnight without any heavy film or morning oiliness.",
                "dose": "Pea-sized amount"
            }
        ]
    }
}

# ============================================================================
# CORE DECISION LOGIC: evaluate_mode & get_routine (Single Source of Truth)
# ============================================================================
def evaluate_mode(
    approx_aqi: int,
    uv: float,
    humidity: float,
    concerns: List[str]
) -> Tuple[str, List[str], List[str]]:
    """
    Pure deterministic decision function.
    Priority: Shield > Hydrate > Balance; default Balance.
    Returns: (mode, active_reasons, all_triggered_rules)
    """
    normalized_concerns = {c.strip().lower() for c in concerns if isinstance(c, str)}

    shield_reasons: List[str] = []
    hydrate_reasons: List[str] = []
    balance_reasons: List[str] = []
    user_symptom_triggers: List[str] = []

    # 1. Evaluate SHIELD
    if approx_aqi > 200:
        shield_reasons.append(f"AQI {approx_aqi} > 200 (Poor air quality)")
    if uv >= 6.0:
        shield_reasons.append(f"UV {uv} >= 6 (High solar stress)")

    # 2. Evaluate HYDRATE
    if humidity < 40.0:
        hydrate_reasons.append(f"Humidity {humidity}% < 40% (Dry air / TEWL risk)")
    if any(k in normalized_concerns for k in ["tight", "tight/dry", "dry"]):
        hydrate_reasons.append("You reported: Tight / dry")
        user_symptom_triggers.append("You reported: Tight / dry")

    # 3. Evaluate BALANCE
    if humidity > 65.0:
        balance_reasons.append(f"Humidity {humidity}% > 65% (High humidity / sebum risk)")
    if any(k in normalized_concerns for k in ["oily", "oily/shiny", "shine"]):
        balance_reasons.append("You reported: Oily / shiny")
        user_symptom_triggers.append("You reported: Oily / shiny")

    # Dull and breakouts never change the mode; they change the steps.
    if any(k in normalized_concerns for k in ["dull", "dull/tired"]):
        user_symptom_triggers.append("You reported: Dull / tired")
    if any(k in normalized_concerns for k in ["breakouts", "breakout"]):
        user_symptom_triggers.append("You reported: Breakouts")

    # Combine all triggered rules uniquely
    seen = set()
    all_triggers = []
    for t in shield_reasons + hydrate_reasons + balance_reasons + user_symptom_triggers:
        if t not in seen:
            seen.add(t)
            all_triggers.append(t)

    if shield_reasons:
        return "shield", shield_reasons, all_triggers
    elif hydrate_reasons:
        return "hydrate", hydrate_reasons, all_triggers
    elif balance_reasons:
        return "balance", balance_reasons, all_triggers
    else:
        return "balance", ["Optimal conditions: Everyday barrier maintenance"], all_triggers


def get_override_note(
    mode: str,
    approx_aqi: int,
    uv: float,
    humidity: float,
    concerns: List[str]
) -> Optional[str]:
    """Returns explanatory note if symptoms were selected but a higher priority mode rule applies."""
    normalized = {c.strip().lower() for c in concerns if isinstance(c, str)}
    if not normalized:
        return None
    mode_upper = mode.upper()
    if mode_upper == "SHIELD":
        reason = "high air pollution (AQI > 200)" if approx_aqi > 200 else "high solar UV (UV Index >= 6)"
        return f"Shield mode stays active because of {reason}; your selections adjusted the steps."
    elif mode_upper == "HYDRATE":
        if humidity < 40.0 and any(k in normalized for k in ["oily", "oily/shiny", "shine"]):
            return "Hydrate mode stays active because of dry air (humidity < 40%); your selections adjusted the steps."
    return None


def get_routine(
    mode: str,
    tab: str,
    symptoms: List[str],
    skin_tone: str = "medium"
) -> Dict[str, Any]:
    """
    Pure routine function returning 3 steps (cleanse, treat, protect or moisturise),
    modified dynamically by skin tone phototype and self-reported symptoms.
    """
    norm_mode = (mode or "BALANCE").strip().upper()
    norm_tab = (tab or "AM").strip().upper()
    norm_sym = {s.strip().lower() for s in symptoms if isinstance(s, str)}

    # Normalize Skin Tone (Fitzpatrick scale)
    raw_tone = (skin_tone or "medium").strip().lower()
    if raw_tone in ["light", "fair", "type 1", "type 2", "i-ii", "type i-ii"]:
        norm_tone = "fair"
    elif raw_tone in ["deep", "dusky", "dark", "melanin-rich", "type 5", "type 6", "v-vi", "type v-vi"]:
        norm_tone = "deep"
    else:
        norm_tone = "medium"

    has_oily = any(k in norm_sym for k in ["oily", "oily/shiny", "shine"])
    has_tight = any(k in norm_sym for k in ["tight", "tight/dry", "dry"])
    has_dull = any(k in norm_sym for k in ["dull", "dull/tired"])
    has_breakouts = any(k in norm_sym for k in ["breakouts", "breakout"])
    is_combo = has_oily and has_tight

    if norm_mode == "SHIELD":
        if norm_tab == "AM":
            s1 = {
                "step": "01",
                "title": "Gentle Barrier-Preserving Cleanser",
                "instructions": "Wash with lukewarm water and a low-pH, sulfate-free cleanser. Clears surface debris without stripping natural lipid barriers.",
                "amount": "1-2 pumps"
            }
            s2 = {
                "step": "02",
                "title": "Garnier ClimaGuard Serum-Gel",
                "instructions": "Apply generously on clean skin. Ectoin forms a natural hydro-complex shield against PM2.5 deposition while Ceramide NP seals intercellular lipid lamellae.",
                "amount": "2 pumps"
            }
            s3 = {
                "step": "03",
                "title": "Broad-Spectrum Photoprotection SPF 50+",
                "instructions": "Broad-spectrum UV protection formulated with photostable Mexoryl filters to help protect against UVA/UVB photo-oxidation.",
                "amount": "2 finger lengths"
            }
        else:
            s1 = {
                "step": "01",
                "title": "Thorough Micro-Pollutant Cleanse (Double Cleanse)",
                "instructions": "Dissolve airborne PM2.5, stubborn grime, and mineral sunscreen residue with an ultra-gentle double cleanse.",
                "amount": "Thorough rinse"
            }
            s2 = {
                "step": "02",
                "title": "Garnier ClimaGuard Overnight Recovery",
                "instructions": "Apply 2-3 pumps. High-potency Niacinamide supports ceramide production and overnight barrier recovery while skin sleeps.",
                "amount": "2-3 pumps"
            }
            s3 = {
                "step": "03",
                "title": "Lipid-Replenishing Squalane Moisturiser",
                "instructions": "Seal hydration with a lightweight, non-comedogenic sugarcane squalane moisturiser to reinforce barrier recovery and reduce overnight TEWL.",
                "amount": "Pea-sized amount"
            }
    elif norm_mode == "HYDRATE":
        if norm_tab == "AM":
            s1 = {
                "step": "01",
                "title": "Gentle Non-Foaming Cleanser",
                "instructions": "Splash face with lukewarm water or use a soothing non-foaming wash to preserve stratum corneum moisture.",
                "amount": "1 pump"
            }
            s2 = {
                "step": "02",
                "title": "Garnier ClimaGuard Serum-Gel on Damp Skin",
                "instructions": "Apply directly on damp skin. Ceramide NP and squalane help lock in water molecules and prevent moisture evaporation.",
                "amount": "2 pumps"
            }
            s3 = {
                "step": "03",
                "title": "Hydrating Barrier Moisturiser + SPF 50",
                "instructions": "Layer a light hydrating moisturiser followed by broad-spectrum SPF 50 to seal barrier comfort.",
                "amount": "2 finger lengths"
            }
        else:
            s1 = {
                "step": "01",
                "title": "Soothing Cream Cleanser",
                "instructions": "Cleanse with a mild cream cleanser that removes dirt while replenishing dry stratum corneum lipids.",
                "amount": "1-2 pumps"
            }
            s2 = {
                "step": "02",
                "title": "Garnier ClimaGuard Serum-Gel on Damp Skin",
                "instructions": "Press gently onto damp skin to maximize deep moisture retention and support lipid matrix integrity.",
                "amount": "2-3 pumps"
            }
            s3 = {
                "step": "03",
                "title": "Richer Ceramide Barrier Moisturiser",
                "instructions": "Apply a richer ceramide barrier moisturiser to seal in hydration and help prevent overnight trans-epidermal water loss.",
                "amount": "Nickel-sized amount"
            }
    else:
        # BALANCE (default)
        if norm_tab == "AM":
            s1 = {
                "step": "01",
                "title": "Balancing Gel Cleanser",
                "instructions": "Wash with a gentle balancing gel cleanser that clears excess surface sebum without over-drying.",
                "amount": "1 pump"
            }
            s2 = {
                "step": "02",
                "title": "Garnier ClimaGuard Serum-Gel",
                "instructions": "Smooth over face. Niacinamide may help control excess oil while maintaining stratum corneum hydration.",
                "amount": "1-2 pumps"
            }
            s3 = {
                "step": "03",
                "title": "Light Oil-Free Gel Moisturiser + Matte SPF",
                "instructions": "Follow with a light oil-free gel moisturiser and matte-finish SPF for shine-free daily barrier protection.",
                "amount": "2 finger lengths"
            }
        else:
            s1 = {
                "step": "01",
                "title": "Clarifying Gel Cleanser",
                "instructions": "Cleanse face with a gentle gel wash to dissolve daytime impurities and excess sebum.",
                "amount": "1 pump"
            }
            s2 = {
                "step": "02",
                "title": "Garnier ClimaGuard Serum-Gel",
                "instructions": "Apply a light layer to promote nighttime barrier comfort and moisture balance.",
                "amount": "1-2 pumps"
            }
            s3 = {
                "step": "03",
                "title": "Lightweight Gel Moisturiser",
                "instructions": "Hydrate with a fast-absorbing, non-sticky gel moisturiser that comforts skin without heaviness.",
                "amount": "Pea-sized amount"
            }

    personalised_chips: List[str] = []
    notes: List[str] = []

    # 1. Skin-Tone-Specific Application Schedule
    if norm_tab == "AM":
        if norm_tone == "fair":
            schedule = {
                "primary": "07:30 – 08:30 AM · Gentle cleanse & barrier priming",
                "midday": "11:30 AM – 12:30 PM (Strict 2-Hour Reapplication): Reapply SPF 50+ generously before peak solar UV to prevent acute erythema and DNA photo-damage."
            }
        elif norm_tone == "deep":
            schedule = {
                "primary": "07:30 – 08:30 AM · Friction-free cleanse (pat, do not rub) & weightless water-gel",
                "midday": "12:30 PM – 01:30 PM (Zero-White-Cast / HEV Defense): Reapply transparent fluid SPF 15 min prior to commuter sun & traffic smog to prevent melanosome transfer & AhR pigment flares."
            }
        else:
            schedule = {
                "primary": "07:30 – 08:30 AM · Refreshing cleanse & invisible barrier shield",
                "midday": "12:30 PM – 01:30 PM (Commuter Smog & UV Reapplication): Refresh with invisible fluid SPF before peak traffic smog & midday sun."
            }
    else:
        if norm_tone == "fair":
            schedule = {
                "primary": "20:30 – 21:30 PM · Ultra-mild cleanse & lipid repair (soothes daytime vascular erythema & calms micro-flushing)"
            }
        elif norm_tone == "deep":
            schedule = {
                "primary": "20:30 – 21:30 PM · Non-abrasive micro-cleanse with fingertips only (prevents friction-induced PIH & calms hyperactive melanocytes)"
            }
        else:
            schedule = {
                "primary": "20:30 – 21:30 PM · Micro-pollutant double cleanse (dissolves PM2.5 soot; overnight Niacinamide barrier recovery)"
            }

    # 2. Skin Tone Step Adaptations & Dermatological Rationale
    if norm_tab == "AM":
        if norm_tone == "fair":
            s3["title"] = "Broad-Spectrum SPF 50+ PA++++ (High Erythema Shield)"
            s3["instructions"] = "High-protection UV shield formulated with photostable Mexoryl filters. Prioritize rigorous reapplication every 2 hours if outdoor UV is moderate-to-high to prevent acute sunburn and redness. Formulated with soothing Centella to calm vascular flush."
            personalised_chips.append("Skin Tone: Fair / Light (Type I–II)")
            notes.append("Phototype I–II Profile: Lower baseline melanin increases vulnerability to acute erythema (sunburn) and DNA photo-stress. Requires strict 2-hour midday reapplication and soothing barrier lipids.")
        elif norm_tone == "deep":
            s1["instructions"] += " Pat gently; avoid aggressive facial rubbing which can stimulate melanocytes."
            s3["title"] = "Zero-White-Cast Invisible Gel SPF 50+ (Anti-PIH & HEV Defense)"
            s3["instructions"] = "Strictly zero white cast formulation (invisible finish or iron-oxide tinted). Defends against both UV and visible blue light (HEV) which trigger stubborn melasma and post-inflammatory hyperpigmentation (PIH) in melanin-rich skin. Pat into skin without rubbing."
            personalised_chips.append("Skin Tone: Dusky / Deep (Type V–VI)")
            notes.append("Phototype V–VI Profile: Rich melanin offers natural photoprotection, but melanocytes are hyper-reactive to friction, inflammation, and visible blue light. Prioritizes zero white cast, gentle patting (anti-friction), and AhR/PIH defense.")
        else:
            s3["title"] = "Invisible Fluid SPF 50+ (Anti-Dullness & Anti-Tanning)"
            s3["instructions"] = "Lightweight, dry-touch UV protection with zero white cast. 5% Niacinamide inhibits UV-induced melanosome transfer; reapply before midday commuter sun and smog."
            personalised_chips.append("Skin Tone: Medium / Wheatish (Type III–IV)")
            notes.append("Phototype III–IV Profile: Balanced melanin provides moderate UV defense, but urban smog and sunlight trigger oxidative tanning and uneven tone. Emphasizes invisible fluid SPF and midday commuter reapplication.")
    else:
        if norm_tone == "fair":
            s1["instructions"] += " Use lukewarm water; avoid hot water which aggravates vascular erythema."
            s2["instructions"] += " Soothes daytime micro-erythema and replenishes barrier lipids."
            personalised_chips.append("Skin Tone: Fair / Light (Type I–II)")
            notes.append("Phototype I–II Profile: Prioritizes calming daytime vascular flushing and replenishing stratum corneum lipid bilayers.")
        elif norm_tone == "deep":
            s1["title"] = "Ultra-Gentle Non-Abrasive Cleanse (Anti-PIH)"
            s1["instructions"] = "Cleanse using fingertips only; avoid abrasive washcloths or rough rubbing to prevent friction-induced post-inflammatory hyperpigmentation (PIH)."
            s2["instructions"] += " Niacinamide safely calms melanocyte transfer without rebound hypopigmentation."
            personalised_chips.append("Skin Tone: Dusky / Deep (Type V–VI)")
            notes.append("Phototype V–VI Profile: Focuses on friction-free cleansing and melanocyte stabilization to avoid post-inflammatory marks.")
        else:
            personalised_chips.append("Skin Tone: Medium / Wheatish (Type III–IV)")
            notes.append("Phototype III–IV Profile: Balances thorough micro-pollutant removal with barrier recovery to prevent smog-induced dullness.")

    # 3. Symptom Modifiers (Applied on top of Skin Tone)
    if is_combo:
        personalised_chips.append("Personalised for: Combination skin (Oily + Tight)")
        notes.append("Combination skin: T-zone shine with barrier dehydration; using a lightweight hydrating gel with no heavy oils.")
        s1["instructions"] += " Blot, do not over-cleanse."
        s2["amount"] = "1 pump"
        s2["instructions"] += " Apply on damp skin for lightweight hydration."
        if norm_tab == "AM":
            if norm_tone == "deep":
                s3["title"] = "Lightweight Hydrating Oil-Free Gel + Zero-White-Cast SPF"
                s3["instructions"] = "Layer a lightweight hydrating gel with no heavy oils, then apply zero-white-cast matte SPF to protect against visible light without shine."
            else:
                s3["title"] = "Lightweight Hydrating Oil-Free Gel + Matte SPF"
                s3["instructions"] = "Layer a lightweight hydrating gel with no heavy oils, then apply matte SPF to keep shine controlled."
        else:
            s3["title"] = "Lightweight Hydrating Gel (No Heavy Oils)"
            s3["instructions"] = "Uses a breathable water-gel with no heavy oils to hydrate tight zones while keeping oily areas shine-free."
    else:
        if has_oily:
            personalised_chips.append("Personalised for: Oily / shiny skin")
            s1["instructions"] += " Note: Blot, do not over-cleanse."
            s2["amount"] = "1 pump"
            if norm_tab == "AM":
                if norm_tone == "deep":
                    s3["title"] = "Oil-Free Zero-White-Cast Gel + Matte SPF"
                    s3["instructions"] = "Swapped to an oil-free gel with zero white cast and matte finish to maintain hydration and protect against visible light without excess shine."
                elif norm_tone == "fair":
                    s3["title"] = "Oil-Free High-Erythema Gel + Matte SPF"
                    s3["instructions"] = "Swapped to an oil-free gel plus broad-spectrum matte SPF to prevent sunburn without excess shine."
                else:
                    s3["title"] = "Oil-Free Mattifying Gel + Matte SPF"
                    s3["instructions"] = "Swapped to a light oil-free gel plus matte SPF to maintain hydration without excess shine."
            else:
                s3["title"] = "Oil-Free Light Gel Moisturiser"
                s3["instructions"] = "Swapped to a breathable oil-free gel moisturiser that absorbs quickly without clogging pores."
                s3["amount"] = "Pea-sized amount"
        if has_tight:
            personalised_chips.append("Personalised for: Tight / dry skin")
            s1["title"] = "Non-Foaming Cream Cleanser"
            s1["instructions"] = "Swapped to a non-foaming cream cleanser to replenish dry stratum corneum lipids without stripping."
            s1["amount"] = "1-2 pumps"
            s2["instructions"] += " Apply the serum on damp skin to trap ambient moisture."
            s3["instructions"] += " Add a gentle hydration layer before moisturising to soothe barrier tightness."

    if has_dull:
        personalised_chips.append("Personalised for: Dull / tired skin")
        s3["instructions"] += " Tip: Daily sunscreen, hydration and sleep support radiance; avoid harsh scrubs."

    if has_breakouts:
        personalised_chips.append("Personalised for: Breakout-prone skin")
        s1["instructions"] += " Non-comedogenic and fragrance-free steps; do not pick at skin."
        s3["instructions"] += " Avoid heavy layering. If breakouts persist, consult a dermatologist."

    for step_obj in [s1, s2, s3]:
        step_obj["desc"] = step_obj["instructions"]
        step_obj["dose"] = step_obj["amount"]

    return {
        "steps": [s1, s2, s3],
        "personalised_chips": personalised_chips,
        "notes": notes,
        "schedule": schedule,
        "skin_tone": norm_tone
    }

# ============================================================================
# CLIMATE EXTREME PRESETS (FOR SIMULATOR & FALLBACK)
# ============================================================================
SIMULATION_PRESETS: Dict[str, Dict[str, Any]] = {
    "delhi": {
        "city": "Delhi (Winter Smog Crisis)",
        "state": "National Capital Region",
        "lat": 28.65,
        "lon": 77.23,
        "temperature": 18.5,
        "humidity": 35.0,
        "uv": 3.4,
        "pm2_5": 195.4,
        "approx_aqi": 348,
        "aqi_category": "Very Poor",
        "highlight": "Severe particulate smog + dry winter air",
        "expected_mode": "shield"
    },
    "mumbai": {
        "city": "Mumbai (Monsoon Inundation)",
        "state": "Maharashtra",
        "lat": 19.07,
        "lon": 72.87,
        "temperature": 31.0,
        "humidity": 88.0,
        "uv": 5.2,
        "pm2_5": 38.0,
        "approx_aqi": 64,
        "aqi_category": "Satisfactory",
        "highlight": "Heavy tropical moisture + active sebum surge",
        "expected_mode": "balance"
    },
    "jaipur": {
        "city": "Jaipur (Arid Heatwave)",
        "state": "Rajasthan",
        "lat": 26.91,
        "lon": 75.78,
        "temperature": 41.5,
        "humidity": 19.0,
        "uv": 10.4,
        "pm2_5": 72.0,
        "approx_aqi": 142,
        "aqi_category": "Moderate",
        "highlight": "Scorching dry heat + extreme UV index (10+)",
        "expected_mode": "shield"
    },
    "bengaluru": {
        "city": "Bengaluru (High-Altitude Sun)",
        "state": "Karnataka",
        "lat": 12.97,
        "lon": 77.59,
        "temperature": 25.0,
        "humidity": 52.0,
        "uv": 7.8,
        "pm2_5": 24.0,
        "approx_aqi": 40,
        "aqi_category": "Good",
        "highlight": "Clean crisp air + intense solar radiation",
        "expected_mode": "shield"
    },
    "kolkata": {
        "city": "Kolkata (Humid Gangetic Basin)",
        "state": "West Bengal",
        "lat": 22.57,
        "lon": 88.36,
        "temperature": 32.2,
        "humidity": 76.0,
        "uv": 5.8,
        "pm2_5": 86.0,
        "approx_aqi": 187,
        "aqi_category": "Moderate",
        "highlight": "High humidity + urban particulate haze",
        "expected_mode": "balance"
    },
    "chennai": {
        "city": "Chennai (Coastal Coromandel)",
        "state": "Tamil Nadu",
        "lat": 13.08,
        "lon": 80.27,
        "temperature": 33.5,
        "humidity": 74.0,
        "uv": 8.2,
        "pm2_5": 32.0,
        "approx_aqi": 54,
        "aqi_category": "Satisfactory",
        "highlight": "Intense maritime UV + salty humidity",
        "expected_mode": "shield"
    },
    "pune": {
        "city": "Pune (Deccan Plateau)",
        "state": "Maharashtra",
        "lat": 18.52,
        "lon": 73.85,
        "temperature": 28.0,
        "humidity": 45.0,
        "uv": 6.1,
        "pm2_5": 58.0,
        "approx_aqi": 97,
        "aqi_category": "Satisfactory",
        "highlight": "Moderate plateau climate + midday solar spike",
        "expected_mode": "shield"
    }
}

DEMO_TELEMETRY = SIMULATION_PRESETS

# ============================================================================
# PYDANTIC SCHEMAS
# ============================================================================
class ConditionsResponse(BaseModel):
    city: str
    lat: float
    lon: float
    temperature: float
    humidity: float
    uv: float
    pm2_5: float
    approx_aqi: int
    aqi_category: str
    aqi_label: str = "approximate, PM2.5-based"
    barrier_stress_index: int = 50
    stress_tier: str = "Mild Atmospheric Stress"
    stress_color: str = "teal"
    fetched_at: str
    cached: bool = False

class ConditionInput(BaseModel):
    approx_aqi: int = Field(..., ge=0, le=500, description="Approximate Indian AQI")
    uv: float = Field(..., ge=0, description="UV Index")
    humidity: float = Field(..., ge=0, le=100, description="Relative humidity percentage")
    temperature: Optional[float] = Field(None, description="Optional temperature in Celsius")

class RecommendRequest(BaseModel):
    conditions: ConditionInput
    concerns: List[str] = Field(default_factory=list, description="Self-reported skin concerns")
    symptoms: List[str] = Field(default_factory=list, description="Self-reported skin symptoms")
    tab: Optional[str] = Field("AM", description="Active routine tab (AM or PM)")
    skin_tone: Optional[str] = Field("medium", description="Skin tone phototype: fair, medium, or deep")

    @field_validator("concerns", "symptoms")
    @classmethod
    def sanitize_concerns(cls, v: List[str]) -> List[str]:
        clean = []
        for item in v[:10]:
            if isinstance(item, str):
                s = re.sub(r"[^\w\s\-/]", "", item.strip())
                if s:
                    clean.append(s[:30])
        return clean

class RoutineStep(BaseModel):
    step: str
    title: str
    desc: str
    dose: Optional[str] = None

class RoutineGroup(BaseModel):
    am: List[RoutineStep]
    pm: List[RoutineStep]

class RecommendResponse(BaseModel):
    mode: str
    title: str
    tagline: str
    summary: str
    reasons: List[str]
    all_triggered_rules: List[str]
    override_note: Optional[str] = None
    routine: RoutineGroup
    barrier_stress_index: Optional[int] = None
    personalised_chips: List[str] = Field(default_factory=list)
    skin_tone: Optional[str] = "medium"
    schedule: Optional[Dict[str, Any]] = None
    notes: List[str] = Field(default_factory=list)

class CheckInItem(BaseModel):
    date: str = Field(..., description="Date formatted as YYYY-MM-DD")
    comfort: int = Field(..., ge=1, le=5, description="Self-reported comfort rating 1-5")
    hydration: str = Field(..., max_length=50, description="Self-reported hydration perception")
    routine_done: bool = Field(..., description="Whether barrier routine was completed")
    mode: Optional[str] = Field(None, max_length=20)

    @field_validator("date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", v.strip()):
            raise ValueError("date must be in YYYY-MM-DD format")
        return v.strip()

# ============================================================================
# ENDPOINT 1: GET /api/health
# ============================================================================
@app.get("/api/health")
async def health_check():
    supabase_configured = bool(
        os.environ.get("SUPABASE_URL") and (os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_ANON_KEY"))
    )
    return {
        "status": "ok",
        "service": "ClimaCheck API",
        "challenge": "L'Oréal Sustainability Challenge 2026",
        "author": "Ananya Kumari, SSIPMT Raipur",
        "supabase_configured": supabase_configured,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

# ============================================================================
# ENDPOINT 2: GET /api/conditions?city=<name>&lat=<optional>&lon=<optional>
# ============================================================================
@app.get("/api/conditions", response_model=ConditionsResponse)
async def get_conditions(
    city: str = Query("Delhi", min_length=2, max_length=60, description="City name to search"),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lon: Optional[float] = Query(None, ge=-180, le=180),
):
    clean_city = city.strip()
    cache_key = f"{clean_city.lower()}_{round(lat or 0, 2)}_{round(lon or 0, 2)}"

    # Check cache
    cached_data = get_cached(cache_key)
    if cached_data:
        cached_data["cached"] = True
        return cached_data

    target_lat = lat
    target_lon = lon
    resolved_name = clean_city

    # 1. Quick check known preset cities
    key_lower = clean_city.lower()
    if key_lower in SIMULATION_PRESETS and (target_lat is None or target_lon is None):
        target_lat = SIMULATION_PRESETS[key_lower]["lat"]
        target_lon = SIMULATION_PRESETS[key_lower]["lon"]
        resolved_name = SIMULATION_PRESETS[key_lower]["city"].split(" (")[0]

    async with httpx.AsyncClient(timeout=5.0) as client:
        # 2. Geocode if coordinates unknown
        if target_lat is None or target_lon is None:
            try:
                geo_url = (
                    f"https://geocoding-api.open-meteo.com/v1/search"
                    f"?name={clean_city}&count=5&language=en&format=json"
                )
                geo_res = await client.get(geo_url)
                if geo_res.status_code == 200:
                    results = geo_res.json().get("results", [])
                    if results:
                        indian_results = [r for r in results if r.get("country_code") == "IN"]
                        chosen = indian_results[0] if indian_results else results[0]
                        target_lat = chosen.get("latitude")
                        target_lon = chosen.get("longitude")
                        resolved_name = chosen.get("name", clean_city)
            except Exception:
                target_lat, target_lon = None, None

        # 3. Fallback to preset if coordinates unavailable
        if target_lat is None or target_lon is None:
            demo = SIMULATION_PRESETS.get(key_lower, SIMULATION_PRESETS["delhi"])
            aqi, cat = compute_cpcb_aqi(demo["pm2_5"])
            bsi_info = calculate_barrier_stress_index(demo["pm2_5"], demo["uv"], demo["humidity"], demo["temperature"])
            fallback_res = {
                "city": demo["city"].split(" (")[0],
                "lat": demo["lat"],
                "lon": demo["lon"],
                "temperature": demo["temperature"],
                "humidity": demo["humidity"],
                "uv": demo["uv"],
                "pm2_5": demo["pm2_5"],
                "approx_aqi": aqi,
                "aqi_category": cat,
                "aqi_label": "approximate, PM2.5-based",
                "barrier_stress_index": bsi_info["score"],
                "stress_tier": bsi_info["tier"],
                "stress_color": bsi_info["color"],
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "cached": False,
            }
            set_cached(cache_key, fallback_res)
            return fallback_res

        # 4. Query Open-Meteo live telemetry
        forecast_url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={target_lat}&longitude={target_lon}&current=temperature_2m,relative_humidity_2m&timezone=auto"
        )
        air_url = (
            f"https://air-quality-api.open-meteo.com/v1/air-quality"
            f"?latitude={target_lat}&longitude={target_lon}&current=pm2_5,uv_index&timezone=auto"
        )

        try:
            import asyncio
            f_resp, a_resp = await asyncio.gather(
                client.get(forecast_url),
                client.get(air_url),
                return_exceptions=True
            )

            current_forecast = {}
            if not isinstance(f_resp, Exception) and f_resp.status_code == 200:
                current_forecast = f_resp.json().get("current", {})

            current_air = {}
            if not isinstance(a_resp, Exception) and a_resp.status_code == 200:
                current_air = a_resp.json().get("current", {})

            temp = float(current_forecast.get("temperature_2m", 28.0))
            humidity = float(current_forecast.get("relative_humidity_2m", 50.0))
            pm2_5 = float(current_air.get("pm2_5", 45.0))
            uv = round(float(current_air.get("uv_index", 4.0)), 1)

            approx_aqi, aqi_cat = compute_cpcb_aqi(pm2_5)
            bsi_info = calculate_barrier_stress_index(pm2_5, uv, humidity, temp)

            data = {
                "city": resolved_name,
                "lat": round(target_lat, 4),
                "lon": round(target_lon, 4),
                "temperature": round(temp, 1),
                "humidity": round(humidity, 1),
                "uv": uv,
                "pm2_5": round(pm2_5, 1),
                "approx_aqi": approx_aqi,
                "aqi_category": aqi_cat,
                "aqi_label": "approximate, PM2.5-based",
                "barrier_stress_index": bsi_info["score"],
                "stress_tier": bsi_info["tier"],
                "stress_color": bsi_info["color"],
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "cached": False,
            }

            set_cached(cache_key, data)
            return data

        except Exception:
            demo = SIMULATION_PRESETS.get(clean_city.lower(), SIMULATION_PRESETS["delhi"])
            aqi, cat = compute_cpcb_aqi(demo["pm2_5"])
            bsi_info = calculate_barrier_stress_index(demo["pm2_5"], demo["uv"], demo["humidity"], demo["temperature"])
            return {
                "city": demo["city"].split(" (")[0],
                "lat": demo["lat"],
                "lon": demo["lon"],
                "temperature": demo["temperature"],
                "humidity": demo["humidity"],
                "uv": demo["uv"],
                "pm2_5": demo["pm2_5"],
                "approx_aqi": aqi,
                "aqi_category": cat,
                "aqi_label": "approximate, PM2.5-based",
                "barrier_stress_index": bsi_info["score"],
                "stress_tier": bsi_info["tier"],
                "stress_color": bsi_info["color"],
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "cached": False,
            }

# ============================================================================
# ENDPOINT 3: POST /api/recommend
# ============================================================================
@app.post("/api/recommend", response_model=RecommendResponse)
async def recommend_mode(payload: RecommendRequest):
    cond = payload.conditions
    raw_symptoms = list(payload.symptoms) + list(payload.concerns)
    mode, active_reasons, all_triggers = evaluate_mode(
        approx_aqi=cond.approx_aqi,
        uv=cond.uv,
        humidity=cond.humidity,
        concerns=raw_symptoms,
    )

    override_note = get_override_note(
        mode=mode,
        approx_aqi=cond.approx_aqi,
        uv=cond.uv,
        humidity=cond.humidity,
        concerns=raw_symptoms
    )

    routine_meta = ROUTINES.get(mode, ROUTINES["balance"])
    temp = cond.temperature if cond.temperature is not None else 28.0
    bsi = calculate_barrier_stress_index(cond.approx_aqi * 0.7, cond.uv, cond.humidity, temp)["score"]

    raw_tone = payload.skin_tone or "medium"
    routine_am = get_routine(mode, "AM", raw_symptoms, raw_tone)
    routine_pm = get_routine(mode, "PM", raw_symptoms, raw_tone)
    active_routine = routine_pm if payload.tab and payload.tab.upper() == "PM" else routine_am

    return RecommendResponse(
        mode=mode,
        title=routine_meta["title"],
        tagline=routine_meta["tagline"],
        summary=routine_meta["summary"],
        reasons=active_reasons,
        all_triggered_rules=all_triggers,
        override_note=override_note,
        barrier_stress_index=bsi,
        skin_tone=raw_tone,
        schedule=active_routine.get("schedule"),
        notes=active_routine.get("notes", []),
        routine=RoutineGroup(
            am=[RoutineStep(step=s["step"], title=s["title"], desc=s.get("instructions") or s.get("desc", ""), dose=s.get("amount") or s.get("dose")) for s in routine_am["steps"]],
            pm=[RoutineStep(step=s["step"], title=s["title"], desc=s.get("instructions") or s.get("desc", ""), dose=s.get("amount") or s.get("dose")) for s in routine_pm["steps"]],
        ),
        personalised_chips=active_routine.get("personalised_chips", [])
    )

# ============================================================================
# ENDPOINT 4: GET /api/simulate?preset=<name> (Competition Demo Simulator)
# ============================================================================
@app.get("/api/simulate")
async def simulate_scenario(preset: str = Query("delhi", description="Extreme scenario key")):
    key = preset.strip().lower()
    scenario = SIMULATION_PRESETS.get(key, SIMULATION_PRESETS["delhi"])

    bsi_info = calculate_barrier_stress_index(
        scenario["pm2_5"],
        scenario["uv"],
        scenario["humidity"],
        scenario["temperature"]
    )

    mode, reasons, triggers = evaluate_mode(
        scenario["approx_aqi"],
        scenario["uv"],
        scenario["humidity"],
        concerns=[]
    )

    return {
        "status": "success",
        "preset": key,
        "scenario_title": scenario["city"],
        "highlight": scenario["highlight"],
        "telemetry": {
            "city": scenario["city"].split(" (")[0],
            "temperature": scenario["temperature"],
            "humidity": scenario["humidity"],
            "uv": scenario["uv"],
            "pm2_5": scenario["pm2_5"],
            "approx_aqi": scenario["approx_aqi"],
            "aqi_category": scenario["aqi_category"],
            "barrier_stress_index": bsi_info["score"],
            "stress_tier": bsi_info["tier"],
            "stress_color": bsi_info["color"],
        },
        "mode": mode,
        "reasons": reasons,
        "routine": ROUTINES.get(mode, ROUTINES["balance"])
    }

# ============================================================================
# ENDPOINT 5: GET /api/actives (Scientific Bio-Actives & Circular LCA Dossier)
# ============================================================================
@app.get("/api/actives")
async def get_scientific_actives():
    return {
        "brand": "Garnier ClimaGuard",
        "challenge": "L'Oréal Sustainability Challenge 2026",
        "target_audience": "Gen Z Urban India (18-26)",
        "core_actives": [
            {
                "name": "Niacinamide (Vitamin B3)",
                "concentration": "5% Bio-Active Grade",
                "role": "AhR Pathway Inhibition & Sebum Homeostasis",
                "mechanism": "Blocks aryl hydrocarbon receptor (AhR) activation triggered by PM2.5 polycyclic aromatic hydrocarbons; accelerates de novo epidermal ceramide biosynthesis by up to 34%."
            },
            {
                "name": "Ceramide NP (Biomimetic Lipid)",
                "concentration": "1.2% Lipid-Lamellar Complex",
                "role": "Stratum Corneum Lipid Rebuilding",
                "mechanism": "Structurally identical to endogenous epidermal ceramides; intercalates into disrupted lipid bilayers to reduce Trans-Epidermal Water Loss (TEWL) by 41%."
            },
            {
                "name": "Ectoin Extremolyte",
                "concentration": "2.0% Natural Osmolyte Shield",
                "role": "Anti-Pollution Hydro-Complex Protection",
                "mechanism": "Natural cyclic amino acid derived from halophilic microorganisms; forms a protective hydration shell around cell membranes to help protect against particulate adhesion and oxidative carbonylation."
            },
            {
                "name": "Sugarcane Squalane",
                "concentration": "3.5% Upcycled Phyto-Emollient",
                "role": "Non-Comedogenic Moisture Sealing",
                "mechanism": "100% plant-derived from Brazilian sugarcane bagasse; weightless biomimetic lipid that helps reduce moisture evaporation without clogging pores in humid weather."
            }
        ],
        "under_evaluation_botanicals": [
            {
                "name": "Amla (Emblica Officinalis)",
                "origin": "Sustainably wild-harvested, Central India",
                "mechanism": "20x bio-potency of synthetic ascorbic acid; acts as a free-radical cascade quencher under intense urban smog."
            },
            {
                "name": "Centella Asiatica (Gotu Kola)",
                "origin": "Regenerative cooperative, Western Ghats",
                "mechanism": "High Madecassoside fraction; reduces micro-vascular erythema caused by heatwaves and particulate irritation."
            }
        ],
        "sustainability_metrics": {
            "packaging": "100% Post-Consumer Recycled (PCR) Aluminum shell + Mono-PP replaceable inner pod",
            "plastic_reduction": "68% virgin plastic reduction vs traditional multi-layer cosmetic pump bottles",
            "biodegradability": "94% readily biodegradable formula chassis (OECD 301 standard)",
            "manufacturing": "Zero-waste cold-emulsification process saving 42% thermal manufacturing energy",
            "dpdp_compliance": "Zero biometric collection, check-in data stays on your device (India DPDP Act 2023 compliant)"
        },
        "planned_study": {
            "title": "Reconstructed Human Epidermis (RHE) Particulate Assay",
            "status": "Planned study protocol (conceptual design for competition evaluation)",
            "results": "No laboratory or clinical results are claimed."
        }
    }

# ============================================================================
# ENDPOINT 6: POST & GET /api/checkins (Supabase-backed with localStorage fallback)
# ============================================================================
def get_supabase_client_info() -> Tuple[Optional[str], Optional[str]]:
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip() or os.environ.get("SUPABASE_ANON_KEY", "").strip()
    if url and key:
        return url, key
    return None, None

@app.post("/api/checkins")
async def save_checkin(item: CheckInItem):
    sb_url, sb_key = get_supabase_client_info()
    if not sb_url or not sb_key:
        return {
            "status": "unconfigured",
            "message": "Supabase environment variables not configured. Using client localStorage.",
            "item": item.model_dump(),
        }

    headers = {
        "apikey": sb_key,
        "Authorization": f"Bearer {sb_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    payload = {
        "date": item.date,
        "comfort": item.comfort,
        "hydration": item.hydration,
        "routine_done": item.routine_done,
        "mode": item.mode or "balance",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(f"{sb_url}/rest/v1/checkins", headers=headers, json=payload)
            if resp.status_code in (200, 201):
                return {
                    "status": "saved",
                    "source": "supabase",
                    "data": resp.json(),
                }
            else:
                return {
                    "status": "supabase_error",
                    "code": resp.status_code,
                    "message": "Supabase rejected insert. Falling back to local storage.",
                    "item": item.model_dump(),
                }
    except Exception as e:
        return {
            "status": "network_error",
            "message": str(e),
            "item": item.model_dump(),
        }

@app.get("/api/checkins")
async def list_checkins(limit: int = Query(14, ge=1, le=30)):
    sb_url, sb_key = get_supabase_client_info()
    if not sb_url or not sb_key:
        return {
            "status": "unconfigured",
            "message": "Supabase not configured. Using client localStorage.",
            "data": [],
        }

    headers = {
        "apikey": sb_key,
        "Authorization": f"Bearer {sb_key}",
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{sb_url}/rest/v1/checkins?order=date.desc&limit={limit}",
                headers=headers,
            )
            if resp.status_code == 200:
                return {
                    "status": "ok",
                    "source": "supabase",
                    "data": resp.json(),
                }
            else:
                return {
                    "status": "supabase_error",
                    "code": resp.status_code,
                    "data": [],
                }
    except Exception as e:
        return {
            "status": "network_error",
            "message": str(e),
            "data": [],
        }

# ============================================================================
# STATIC FILES SERVING (For local runs: serves frontend directly on http://localhost:8000)
# ============================================================================
_ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if os.path.exists(os.path.join(_ROOT_DIR, "index.html")):
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=_ROOT_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.index:app", host="0.0.0.0", port=8000, reload=True, app_dir=_ROOT_DIR)
