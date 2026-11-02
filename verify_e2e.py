import asyncio
import json
import subprocess
import time
import urllib.request
import base64
import websockets
import sys

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

async def run_verification():
    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    proc = subprocess.Popen([
        chrome_path,
        "--headless=new",
        "--remote-debugging-port=9222",
        "--disable-gpu",
        "--window-size=1280,900",
        "http://127.0.0.1:8000"
    ])
    
    time.sleep(2.5)
    try:
        # Find page tab
        req = urllib.request.urlopen("http://127.0.0.1:9222/json")
        tabs = json.loads(req.read().decode())
        page_tab = next(t for t in tabs if "127.0.0.1:8000" in t.get("url", ""))
        ws_url = page_tab["webSocketDebuggerUrl"]

        async with websockets.connect(ws_url, max_size=20*1024*1024) as ws:
            msg_id = 0

            async def send_cmd(method, params=None):
                nonlocal msg_id
                msg_id += 1
                payload = {"id": msg_id, "method": method}
                if params:
                    payload["params"] = params
                await ws.send(json.dumps(payload))
                while True:
                    res = json.loads(await ws.recv())
                    if res.get("id") == msg_id:
                        return res.get("result", {})

            async def eval_js(expr):
                r = await send_cmd("Runtime.evaluate", {"expression": expr, "returnByValue": True})
                return r.get("result", {}).get("value")

            # Enable Page
            await send_cmd("Page.enable")
            await send_cmd("DOM.enable")

            # Wait 2 seconds for initial render & health check
            await asyncio.sleep(2)

            print("--- 1. Testing Initial State ---")
            loc = await eval_js("document.getElementById('current-city-label')?.textContent")
            health_badge = await eval_js("document.getElementById('backend-status-badge')?.classList.contains('hidden')")
            tele_tag = await eval_js("document.getElementById('telemetry-mode-tag')?.textContent")
            tracker_count = await eval_js("document.getElementById('tracker-total-count')?.textContent")
            tracker_streak = await eval_js("document.getElementById('tracker-streak-count')?.textContent")
            
            print(f"Location: {loc}")
            print(f"Health badge hidden? {health_badge} (False means badge is visible)")
            print(f"Telemetry tag: {tele_tag}")
            print(f"Tracker count: {tracker_count}")
            print(f"Tracker streak: {tracker_streak}")

            assert "No check-ins yet" in tracker_count, f"Tracker should start empty, got: {tracker_count}"

            print("\n--- 2. Testing Simulator Presets (Delhi Smog AQI 348) ---")
            await eval_js("document.querySelector('button[data-preset=\"delhi\"]').click()")
            await asyncio.sleep(1)

            delhi_tele_tag = await eval_js("document.getElementById('telemetry-mode-tag')?.textContent")
            delhi_aqi = await eval_js("document.getElementById('aqi-value')?.textContent")
            delhi_uv = await eval_js("document.getElementById('uv-value')?.textContent")
            delhi_hum = await eval_js("document.getElementById('humidity-value')?.textContent")
            delhi_bsi_score = await eval_js("parseInt(document.getElementById('bsi-score-value')?.textContent)")
            delhi_bsi_tier = await eval_js("document.getElementById('bsi-tier-badge')?.textContent.trim()")
            pills = await eval_js("Array.from(document.querySelectorAll('.telemetry-source-pill')).map(p => p.textContent)")

            print(f"Delhi Telemetry Tag: {delhi_tele_tag}")
            print(f"Delhi AQI: {delhi_aqi} (Expected: 348)")
            print(f"Delhi UV: {delhi_uv} (Expected: 3.4)")
            print(f"Delhi Humidity: {delhi_hum} (Expected: 35%)")
            print(f"Delhi Stress Level Score: {delhi_bsi_score} (Expected: >= 75)")
            print(f"Delhi Stress Level Tier: {delhi_bsi_tier} (Expected: High Stress)")
            print(f"Card Source Pills: {pills} (All should be 'Simulated')")

            assert delhi_tele_tag == "Simulated", f"Expected Simulated, got {delhi_tele_tag}"
            assert delhi_aqi == "348", f"Expected 348, got {delhi_aqi}"
            assert delhi_bsi_score >= 75, f"Expected BSI >= 75 for AQI > 300, got {delhi_bsi_score}"
            assert "High" in delhi_bsi_tier, f"Expected High Stress, got {delhi_bsi_tier}"
            assert all(p == "Simulated" for p in pills), f"Expected all pills to be Simulated, got {pills}"

            print("\n--- 3. Testing Poor AQI 201-300 Calibration (Score >= 55, Moderate-High) ---")
            bsi_test = await eval_js("calculateClientBSI(105, 3.0, 50, 25)")
            print(f"AQI ~250 Test: Score={bsi_test['score']}, Tier='{bsi_test['tier']}'")
            assert bsi_test['score'] >= 55, f"Expected score >= 55, got {bsi_test['score']}"
            assert bsi_test['tier'] == "Moderate-High", f"Expected Moderate-High, got {bsi_test['tier']}"

            print("\n--- 4. Testing Empty Tracker & Check-in Logging ---")
            empty_text = await eval_js("document.getElementById('tracker-total-count')?.textContent")
            streak_badge_hidden = await eval_js("document.getElementById('tracker-streak-count')?.classList.contains('hidden')")
            print(f"Empty tracker text: '{empty_text}', streak badge hidden: {streak_badge_hidden}")
            assert "No check-ins yet" in empty_text, "Tracker should start empty"
            assert streak_badge_hidden, "Streak badge should be hidden when empty"

            # Simulate submitting a check-in
            await eval_js("""
                const radios = document.querySelectorAll('input[name="comfort-score"]');
                if (radios.length > 3) radios[3].checked = true;
                const chk = document.getElementById('checkin-routine-done');
                if (chk) chk.checked = true;
                const form = document.getElementById('checkin-form');
                if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            """)
            await asyncio.sleep(0.5)
            updated_count = await eval_js("document.getElementById('tracker-total-count')?.textContent")
            print(f"Logged 1 check-in, updated tracker count: '{updated_count}'")
            assert "1 check-in" in updated_count, f"Expected 1 check-in logged, got {updated_count}"

            print("\n--- 5. Testing Night Routine (UV 0 defaults to PM) & Credibility Text Fixes ---")
            await eval_js("appState.uv = 0; appState.userManuallySwitchedRoutine = false; updateUI();")
            await asyncio.sleep(0.5)
            active_tab = await eval_js("appState.activeRoutineTab")
            pm_tab_active = await eval_js("document.getElementById('tab-routine-pm')?.classList.contains('bg-emerald-800')")
            am_step_3 = await eval_js("MODE_DETAILS.SHIELD.routineAM[2].desc")
            pm_step_2 = await eval_js("MODE_DETAILS.SHIELD.routinePM[1].desc")
            print(f"Active Tab at UV 0: {active_tab} (Expected: pm)")
            print(f"PM tab button highlighted: {pm_tab_active} (Expected: True)")
            print(f"AM Step 3 desc: '{am_step_3}'")
            print(f"PM Step 2 desc: '{pm_step_2}'")
            assert active_tab == "pm", f"Expected active tab to be pm at UV 0, got {active_tab}"
            assert pm_tab_active, "PM tab button should have active bg-emerald-800"
            assert "before peak midday sun" not in am_step_3.lower(), "Must not claim before peak midday sun"
            assert "prevent" not in am_step_3.lower(), "Must not contain 'prevent'"
            assert "supports ceramide production and overnight barrier recovery" in pm_step_2, "PM step 2 text fix verified"

            print("\n--- 6. Capturing Desktop Screenshot ---")
            # Set to realistic daylight live telemetry for clean presentation screenshot
            await eval_js("document.getElementById('btn-live-gps-mode')?.click()")
            await asyncio.sleep(1)
            screenshot_data = await send_cmd("Page.captureScreenshot", {"format": "png"})
            with open(r"D:\loreal challenge\screenshot_desktop_verified.png", "wb") as f:
                f.write(base64.b64decode(screenshot_data["data"]))
            print("Desktop screenshot saved: D:\\loreal challenge\\screenshot_desktop_verified.png")

            print("\n--- 7. Capturing Mobile (375px) Screenshot ---")
            await send_cmd("Emulation.setDeviceMetricsOverride", {
                "width": 375,
                "height": 812,
                "deviceScaleFactor": 2,
                "mobile": True
            })
            await asyncio.sleep(1)
            mobile_screenshot_data = await send_cmd("Page.captureScreenshot", {"format": "png"})
            with open(r"D:\loreal challenge\screenshot_mobile_verified.png", "wb") as f:
                f.write(base64.b64decode(mobile_screenshot_data["data"]))
            print("Mobile screenshot saved: D:\\loreal challenge\\screenshot_mobile_verified.png")

            print("\nALL E2E VERIFICATION CHECKS PASSED PERFECTLY!")

    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(run_verification())
