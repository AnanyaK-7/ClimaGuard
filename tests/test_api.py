"""
Unit & Integration Tests for ClimaCheck API
Tests for CPCB AQI breakpoints, Barrier Stress Index (BSI),
boundary rules, FastAPI endpoints, simulation presets, and fallback handling.
"""

import pytest
from fastapi.testclient import TestClient

from api.index import app, compute_cpcb_aqi, evaluate_mode, calculate_barrier_stress_index

client = TestClient(app)

# ============================================================================
# 1. CPCB AQI BREAKPOINTS & BOUNDARY TESTS
# ============================================================================
class TestCPCB_AQI:
    def test_zero_and_negative(self):
        assert compute_cpcb_aqi(0) == (0, "Good")
        assert compute_cpcb_aqi(-5) == (0, "Unknown")
        assert compute_cpcb_aqi(None) == (0, "Unknown")

    def test_good_breakpoint_edge(self):
        assert compute_cpcb_aqi(15) == (25, "Good")
        assert compute_cpcb_aqi(30.0) == (50, "Good")

    def test_satisfactory_breakpoint_edge(self):
        aqi_start, cat_start = compute_cpcb_aqi(30.1)
        assert cat_start == "Satisfactory"
        assert aqi_start >= 51

        aqi_end, cat_end = compute_cpcb_aqi(60.0)
        assert aqi_end == 100
        assert cat_end == "Satisfactory"

    def test_moderate_breakpoint_edge(self):
        aqi_start, cat_start = compute_cpcb_aqi(60.1)
        assert cat_start == "Moderate"
        assert aqi_start >= 101

        aqi_end, cat_end = compute_cpcb_aqi(90.0)
        assert aqi_end == 200
        assert cat_end == "Moderate"

    def test_poor_breakpoint_edge(self):
        aqi_start, cat_start = compute_cpcb_aqi(90.1)
        assert cat_start == "Poor"
        assert aqi_start >= 201

        aqi_end, cat_end = compute_cpcb_aqi(120.0)
        assert aqi_end == 300
        assert cat_end == "Poor"

    def test_very_poor_breakpoint_edge(self):
        aqi_start, cat_start = compute_cpcb_aqi(120.1)
        assert cat_start == "Very Poor"
        assert aqi_start >= 301

        aqi_end, cat_end = compute_cpcb_aqi(250.0)
        assert aqi_end == 400
        assert cat_end == "Very Poor"

    def test_severe_breakpoint_edge_and_cap(self):
        aqi_start, cat_start = compute_cpcb_aqi(250.1)
        assert cat_start == "Severe"
        assert aqi_start >= 401

        aqi_cap, cat_cap = compute_cpcb_aqi(600.0)
        assert aqi_cap == 500
        assert cat_cap == "Severe"

# ============================================================================
# 2. ENVIRONMENTAL STRESS LEVEL TESTS
# ============================================================================
class TestBarrierStressIndex:
    def test_bsi_low_stress(self):
        res = calculate_barrier_stress_index(pm25=15.0, uv=2.0, humidity=55.0, temperature=24.0)
        assert res["score"] <= 30
        assert res["tier"] == "Low Stress"
        assert res["color"] == "emerald"

    def test_bsi_poor_aqi_boundary_55_plus(self):
        # PM2.5 = 95 gives AQI ~217 (Poor 201-300) -> must score at least 55 ("Moderate-High")
        res = calculate_barrier_stress_index(pm25=95.0, uv=2.0, humidity=50.0, temperature=25.0)
        assert res["score"] >= 55
        assert res["tier"] == "Moderate-High"
        assert res["color"] == "amber"

    def test_bsi_very_poor_aqi_75_plus(self):
        # PM2.5 = 150 gives AQI ~323 (> 300) -> must score 75+ ("High Stress")
        res = calculate_barrier_stress_index(pm25=150.0, uv=3.0, humidity=35.0, temperature=28.0)
        assert res["score"] >= 75
        assert res["tier"] == "High Stress"
        assert res["color"] == "rose"

    def test_bsi_bounds_clamped(self):
        res_zero = calculate_barrier_stress_index(pm25=0, uv=0, humidity=55.0, temperature=24.0)
        assert 5 <= res_zero["score"] <= 100

        res_max = calculate_barrier_stress_index(pm25=999.0, uv=20.0, humidity=5.0, temperature=50.0)
        assert res_max["score"] <= 100

# ============================================================================
# 3. RULE ENGINE & BOUNDARY TESTS (decideMode / evaluate_mode)
# ============================================================================
class TestDecisionEngine:
    def test_uv_boundary_exact_6(self):
        mode, reasons, triggers = evaluate_mode(approx_aqi=150, uv=6.0, humidity=50, concerns=[])
        assert mode == "shield"
        assert any("UV 6.0 >= 6" in r for r in reasons)

    def test_uv_boundary_below_6(self):
        mode, reasons, triggers = evaluate_mode(approx_aqi=150, uv=5.9, humidity=50, concerns=[])
        assert mode == "balance"

    def test_aqi_boundary_exact_200(self):
        mode, reasons, triggers = evaluate_mode(approx_aqi=200, uv=3.0, humidity=50, concerns=[])
        assert mode == "balance"

    def test_aqi_boundary_above_200(self):
        mode, reasons, triggers = evaluate_mode(approx_aqi=201, uv=3.0, humidity=50, concerns=[])
        assert mode == "shield"
        assert any("AQI 201 > 200" in r for r in reasons)

    def test_humidity_boundary_exact_40(self):
        mode, reasons, triggers = evaluate_mode(approx_aqi=100, uv=3.0, humidity=40.0, concerns=[])
        assert mode == "balance"

    def test_humidity_boundary_below_40(self):
        mode, reasons, triggers = evaluate_mode(approx_aqi=100, uv=3.0, humidity=39.9, concerns=[])
        assert mode == "hydrate"
        assert any("Humidity 39.9% < 40%" in r for r in reasons)

    def test_humidity_boundary_exact_65(self):
        mode, reasons, triggers = evaluate_mode(approx_aqi=100, uv=3.0, humidity=65.0, concerns=[])
        assert mode == "balance"
        assert not any("Humidity 65" in r for r in reasons)

    def test_humidity_boundary_above_65(self):
        mode, reasons, triggers = evaluate_mode(approx_aqi=100, uv=3.0, humidity=65.1, concerns=[])
        assert mode == "balance"
        assert any("Humidity 65.1% > 65%" in r for r in reasons)

    def test_user_concern_tight_triggers_hydrate(self):
        mode, reasons, triggers = evaluate_mode(approx_aqi=100, uv=3.0, humidity=50.0, concerns=["tight"])
        assert mode == "hydrate"
        assert any("Tight / dry" in r for r in reasons)

    def test_user_concern_oily_triggers_balance(self):
        mode, reasons, triggers = evaluate_mode(approx_aqi=100, uv=3.0, humidity=50.0, concerns=["oily"])
        assert mode == "balance"
        assert any("Oily / shiny" in r for r in reasons)

    def test_priority_shield_over_hydrate(self):
        mode, reasons, triggers = evaluate_mode(approx_aqi=250, uv=3.0, humidity=25.0, concerns=["tight"])
        assert mode == "shield"
        assert len(triggers) >= 2

    def test_priority_shield_over_balance(self):
        mode, reasons, triggers = evaluate_mode(approx_aqi=80, uv=7.5, humidity=80.0, concerns=["oily"])
        assert mode == "shield"
        assert len(triggers) >= 2

    def test_priority_hydrate_over_balance(self):
        mode, reasons, triggers = evaluate_mode(approx_aqi=100, uv=3.0, humidity=30.0, concerns=["oily"])
        assert mode == "hydrate"

    def test_default_balance_when_no_triggers(self):
        mode, reasons, triggers = evaluate_mode(approx_aqi=80, uv=4.0, humidity=55.0, concerns=[])
        assert mode == "balance"
        assert "Optimal conditions" in reasons[0]

# ============================================================================
# 4. FASTAPI ENDPOINT INTEGRATION TESTS
# ============================================================================
class TestAPIEndpoints:
    def test_health_endpoint(self):
        res = client.get("/api/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "L'Oréal" in data["challenge"]
        assert "Ananya" in data["author"]

    def test_recommend_endpoint_shield(self):
        payload = {
            "conditions": {
                "approx_aqi": 320,
                "uv": 4.5,
                "humidity": 45,
                "temperature": 28
            },
            "concerns": ["dull"]
        }
        res = client.post("/api/recommend", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["mode"] == "shield"
        assert len(data["routine"]["am"]) == 3
        assert len(data["routine"]["pm"]) == 3
        assert data["barrier_stress_index"] is not None

    def test_recommend_endpoint_hydrate(self):
        payload = {
            "conditions": {
                "approx_aqi": 90,
                "uv": 4.0,
                "humidity": 30,
                "temperature": 25
            },
            "concerns": ["tight"]
        }
        res = client.post("/api/recommend", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["mode"] == "hydrate"

    def test_recommend_validation_error(self):
        payload = {
            "conditions": {
                "approx_aqi": 800,  # exceeds 500
                "uv": 4.0,
                "humidity": 30
            }
        }
        res = client.post("/api/recommend", json=payload)
        assert res.status_code == 422

    def test_conditions_endpoint_delhi(self):
        res = client.get("/api/conditions?city=Delhi")
        assert res.status_code == 200
        data = res.json()
        assert "Delhi" in data["city"]
        assert "approx_aqi" in data
        assert "barrier_stress_index" in data
        assert data["approx_aqi"] >= 0

    def test_simulate_endpoint(self):
        res = client.get("/api/simulate?preset=delhi")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"
        assert data["mode"] == "shield"
        assert "Winter Smog" in data["scenario_title"]

    def test_actives_endpoint(self):
        res = client.get("/api/actives")
        assert res.status_code == 200
        data = res.json()
        assert "Garnier ClimaGuard" in data["brand"]
        assert len(data["core_actives"]) >= 4
        assert "packaging" in data["sustainability_metrics"]

    def test_checkins_fallback_unconfigured(self):
        res = client.get("/api/checkins")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "unconfigured"
