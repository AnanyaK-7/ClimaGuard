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

# ============================================================================
# 5. ALL 16 COMBINATIONS OF SKIN FEEL TOGGLES PERSONALIZATION TESTS
# ============================================================================
import itertools

class TestSkinFeelPersonalization:
    """
    Verifies that every combination of the four skin feel toggles (oily, tight, dull, breakouts)
    visibly changes the rendered routine text, maintains mode priority, and observes non-medical phrasing.
    """
    ALL_SYMPTOMS = ["oily", "tight", "dull", "breakouts"]

    @pytest.fixture
    def all_16_combinations(self):
        combos = []
        for r in range(len(self.ALL_SYMPTOMS) + 1):
            for subset in itertools.combinations(self.ALL_SYMPTOMS, r):
                combos.append(list(subset))
        assert len(combos) == 16
        return combos

    def test_all_16_combinations_change_routine(self, all_16_combinations):
        # Baseline: empty concerns under mild conditions (AQI 70, UV 3.0, Humidity 55.0)
        base_res = client.post("/api/recommend", json={
            "conditions": {"approx_aqi": 70, "uv": 3.0, "humidity": 55.0},
            "concerns": []
        }).json()
        base_text = " ".join(s["title"] + " " + s["desc"] + " " + (s["dose"] or "") for s in base_res["routine"]["am"] + base_res["routine"]["pm"])

        for combo in all_16_combinations:
            res = client.post("/api/recommend", json={
                "conditions": {"approx_aqi": 70, "uv": 3.0, "humidity": 55.0},
                "concerns": combo
            }).json()

            current_text = " ".join(s["title"] + " " + s["desc"] + " " + (s["dose"] or "") for s in res["routine"]["am"] + res["routine"]["pm"])

            if not combo:
                assert current_text == base_text
                assert res["personalization_note"] is None
                assert res["balance_tips_added"] is False
            else:
                # Every non-empty combination MUST change the rendered routine text!
                assert current_text != base_text, f"Routine text for combination {combo} did not change compared to baseline!"

                # Check Oily assertions
                if "oily" in combo:
                    assert any("You reported: Oily / shiny" in r for r in res["reasons"])
                    assert "smaller amount" in current_text or "1 pump" in current_text
                    assert "lightweight gel" in current_text.lower() or "excess oil" in current_text.lower()

                # Check Tight assertions
                if "tight" in combo:
                    assert any("You reported: Tight / dry" in r for r in res["reasons"])
                    assert res["mode"] == "hydrate"
                    assert "hydrating layer" in current_text.lower() or "non-foaming" in current_text.lower()

                # Check Dull assertions
                if "dull" in combo:
                    assert any("You reported: Dull / tired" in r for r in res["reasons"])
                    assert "brightening note" in current_text.lower() or "radiance" in current_text.lower()

                # Check Breakouts assertions
                if "breakouts" in combo:
                    assert any("You reported: Breakouts" in r for r in res["reasons"])
                    assert "non-comedogenic" in current_text.lower()
                    assert "consult a dermatologist" in current_text.lower()

    def test_shield_mode_retention_and_balance_tips(self, all_16_combinations):
        # Under Delhi winter smog (AQI 348), Shield mode must remain active across all combinations
        for combo in all_16_combinations:
            res = client.post("/api/recommend", json={
                "conditions": {"approx_aqi": 348, "uv": 3.4, "humidity": 35.0},
                "concerns": combo
            }).json()

            assert res["mode"] == "shield", f"Expected Shield mode to remain active for combo {combo}"

            if combo:
                assert res["personalization_note"] == "Shield mode stays active because of air quality; your selection adjusted the steps."
            else:
                assert res["personalization_note"] is None

            if "oily" in combo:
                assert res["balance_tips_added"] is True, "Balance tips added badge must be True when oily is selected in Shield mode"
            else:
                assert res["balance_tips_added"] is False
