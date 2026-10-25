from pathlib import Path
from time import time
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "test-results"
OUT.mkdir(exist_ok=True)
stamp = str(int(time()))[-7:]
errors = []
BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:4173")

def capture_console(prefix, message):
    if message.type == "error" and "401 (Unauthorized)" not in message.text:
        errors.append(f"{prefix} console: {message.text}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    owner_context = browser.new_context(viewport={"width": 1365, "height": 900})
    owner = owner_context.new_page()
    owner.on("console", lambda msg: capture_console("owner", msg))
    owner.on("pageerror", lambda exc: errors.append(f"owner page: {exc}"))
    owner.goto(BASE_URL)
    owner.wait_for_load_state("networkidle")
    assert owner.locator("#authGate").is_visible()
    owner.screenshot(path=str(OUT / "desktop-auth.png"), full_page=True)
    owner.get_by_role("button", name="创建账号").click()
    owner.locator("#registerName").fill("潞潞")
    owner.locator("#registerUsername").fill(f"owner_{stamp}")
    owner.locator("#registerPassword").fill("testing-password-2026")
    owner.get_by_role("button", name="创建我的私密空间").click()
    owner.locator("#authGate").wait_for(state="hidden")
    owner.get_by_role("button", name="记录今天").click()
    owner.locator("#periodToggle").check(force=True)
    owner.get_by_role("button", name="中等").click()
    owner.get_by_role("button", name="明显").click()
    owner.get_by_role("button", name="痛经").click()
    owner.get_by_role("button", name="平静").click()
    owner.get_by_role("button", name="不错").click()
    owner.locator("#noteInput").fill("今天早点休息")
    owner.screenshot(path=str(OUT / "desktop-log.png"), full_page=True)
    owner.get_by_role("button", name="保存这一天").click()
    owner.get_by_text("已同步", exact=True).wait_for()
    assert owner.locator("#todayFlow").inner_text() == "中等"
    assert owner.locator("#todayPain").inner_text() == "明显"
    assert owner.locator("#todaySleep").inner_text() == "不错"
    owner.locator("#accountButton").click()
    owner.locator("#settingsView").wait_for(state="visible")
    owner.locator("#createInviteButton").click()
    owner.locator("#inviteResult").wait_for(state="visible")
    invite_url = owner.locator("#inviteLink").input_value()
    owner.screenshot(path=str(OUT / "desktop-settings.png"), full_page=True)

    iphone = p.devices["iPhone 15"]
    viewer_context = browser.new_context(**iphone)
    viewer = viewer_context.new_page()
    viewer.on("console", lambda msg: capture_console("viewer", msg))
    viewer.on("pageerror", lambda exc: errors.append(f"viewer page: {exc}"))
    viewer.on("dialog", lambda dialog: dialog.accept())
    viewer.goto(invite_url)
    viewer.wait_for_load_state("networkidle")
    viewer.get_by_role("button", name="创建账号").click()
    viewer.locator("#registerName").fill("陪伴者")
    viewer.locator("#registerUsername").fill(f"viewer_{stamp}")
    viewer.locator("#registerPassword").fill("viewer-password-2026")
    viewer.get_by_role("button", name="创建我的私密空间").click()
    viewer.locator("#authGate").wait_for(state="hidden")
    viewer.locator("#todayView").wait_for(state="visible")
    assert "read-only" in viewer.locator("body").get_attribute("class")
    assert viewer.locator("#todayFlow").inner_text() == "中等"
    assert viewer.locator("#todayPain").inner_text() == "明显"
    viewer.screenshot(path=str(OUT / "mobile-shared-readonly.png"), full_page=True)

    viewer_context.close()
    owner_context.close()
    browser.close()

assert not errors, "\n".join(errors)
print("browser flow ok")
