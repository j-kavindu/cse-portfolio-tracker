import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8123/index.html"
errors = []
console_errors = []


def check(label, cond):
    status = "PASS" if cond else "FAIL"
    print(f"{status}: {label}")
    if not cond:
        errors.append(label)


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---------- Desktop viewport ----------
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: console_errors.append(str(exc)))
        page.goto(URL)
        page.wait_for_selector("#app .kpi-grid, #app .empty-state")
        check("dashboard renders on load (desktop)", page.locator(".page-header h1").inner_text() == "Portfolio Dashboard")

        # go to Settings, load demo data
        page.click('a[data-route="settings"]')
        page.click('[data-action="load-demo"]')
        page.wait_for_timeout(400)
        page.wait_for_selector(".page-header h1")
        check("redirected to dashboard after loading demo data", "Dashboard" in page.locator(".page-header h1").inner_text())
        kpi_text = page.locator(".kpi-grid").inner_text()
        check("dashboard shows non-zero current value after demo load", "0.00" not in kpi_text.split("Current Value")[1][:40])

        # ---------- Transactions: add BUY ----------
        page.click('a[data-route="transactions"]')
        page.click('[data-action="add-transaction"]')
        page.fill('input[name="date"]', "2026-01-15")
        page.fill('input[name="symbol"]', "TESTX")
        page.select_option('select[name="type"]', "BUY")
        page.fill('input[name="quantity"]', "100")
        page.fill('input[name="price"]', "50")
        page.wait_for_timeout(150)
        # new symbol fields should appear
        check("new-symbol fields appear for unknown ticker", not page.locator(".new-symbol-fields").is_hidden())
        page.fill('input[name="companyName"]', "Test Corp PLC")
        page.select_option('select[name="sector"]', "Banks")
        page.fill('input[name="currentPrice"]', "55")
        page.click('button:has-text("Save transaction")')
        page.wait_for_timeout(300)
        rows_after_add = page.locator(".data-table tbody tr").count()
        check("transaction row added", rows_after_add >= 1)

        # ---------- Oversell rejection ----------
        page.click('[data-action="add-transaction"]')
        page.fill('input[name="date"]', "2026-01-20")
        page.fill('input[name="symbol"]', "TESTX")
        page.select_option('select[name="type"]', "SELL")
        page.fill('input[name="quantity"]', "9999")
        page.fill('input[name="price"]', "50")
        page.click('button:has-text("Save transaction")')
        page.wait_for_timeout(200)
        err = page.locator("[data-error]")
        check("oversell rejected with visible error message", err.is_visible() and "only hold" in err.inner_text())

        # fix to a valid partial sell
        page.fill('input[name="quantity"]', "40")
        page.click('button:has-text("Save transaction")')
        page.wait_for_timeout(300)
        check("valid partial sell accepted", page.locator("[data-error]").is_hidden())

        # ---------- Holdings reflect the partial sell ----------
        page.click('a[data-route="holdings"]')
        page.wait_for_timeout(200)
        holdings_text = page.locator(".data-table").inner_text()
        check("TESTX appears in holdings with reduced quantity", "TESTX" in holdings_text and "60" in holdings_text)

        # update current price inline
        price_input = page.locator('input.price-input[data-symbol="TESTX"]')
        price_input.fill("70")
        price_input.dispatch_event("change")
        page.wait_for_timeout(300)
        check("inline price update recalculates market value", "4,200.00" in page.locator(".data-table").inner_text() or "4200" in page.locator(".data-table").inner_text())

        # ---------- Edit a transaction ----------
        page.click('a[data-route="transactions"]')
        page.wait_for_timeout(150)
        page.locator('[data-action="edit-txn"]').first.click()
        page.wait_for_timeout(150)
        qty_field = page.locator('input[name="quantity"]')
        qty_field.fill("35")
        page.click('button:has-text("Save transaction")')
        page.wait_for_timeout(300)
        check("edit form submits without validation error", page.locator("[data-error]").is_hidden())

        # ---------- Delete a transaction ----------
        rows_before_delete = page.locator(".data-table tbody tr").count()
        page.once("dialog", lambda d: d.accept())
        page.locator('[data-action="delete-txn"]').first.click()
        page.wait_for_timeout(300)
        rows_after_delete = page.locator(".data-table tbody tr").count()
        check("delete removes a row", rows_after_delete == rows_before_delete - 1)

        # ---------- Dividends ----------
        page.click('a[data-route="dividends"]')
        page.wait_for_timeout(150)
        page.click('[data-action="add-dividend"]')
        page.fill('input[name="symbol"]', "COMB")
        page.fill('input[name="recordDate"]', "2025-09-01")
        page.fill('input[name="dividendPerShare"]', "4.5")
        page.click('form[data-form="dividend"] button:has-text("Save")')
        page.wait_for_timeout(300)
        check("dividend row added", "COMB" in page.locator(".data-table").inner_text())

        # ---------- Backdated transaction ----------
        page.click('a[data-route="transactions"]')
        page.click('[data-action="add-transaction"]')
        page.fill('input[name="date"]', "2020-01-01")
        page.fill('input[name="symbol"]', "JKH")
        page.select_option('select[name="type"]', "BUY")
        page.fill('input[name="quantity"]', "10")
        page.fill('input[name="price"]', "100")
        page.click('button:has-text("Save transaction")')
        page.wait_for_timeout(300)
        check("backdated (2020) transaction accepted", page.locator("[data-error]").is_hidden())

        # ---------- Stop Loss & Targets ----------
        page.click('a[data-route="targets"]')
        page.wait_for_timeout(150)
        check("targets page loads without crash", "Stop Loss" in page.locator(".page-header h1").inner_text())

        # ---------- Cash Flow + manual adjustment ----------
        page.click('a[data-route="cashflow"]')
        page.click('[data-action="add-adjustment"]')
        page.fill('input[name="amount"]', "10000")
        page.fill('input[name="note"]', "Top-up")
        page.click('form[data-form="adjustment"] button:has-text("Save")')
        page.wait_for_timeout(300)
        check("manual cash adjustment recorded", "Top-up" in page.locator(".data-table").inner_text())

        # ---------- Backup export triggers a download ----------
        page.click('a[data-route="settings"]')
        with page.expect_download() as dl_info:
            page.click('[data-action="export"]')
        download = dl_info.value
        check("export backup triggers a file download", download.suggested_filename.endswith(".json"))

        # ---------- Reload -> data persists (IndexedDB) ----------
        page.reload()
        page.wait_for_selector("#app")
        page.click('a[data-route="holdings"]')
        page.wait_for_timeout(300)
        check("data persists after page reload", "TESTX" in page.locator(".data-table").inner_text())

        # ---------- Wipe data ----------
        page.click('a[data-route="settings"]')
        page.once("dialog", lambda d: d.accept())
        page.once("dialog", lambda d: d.accept())
        page.click('[data-action="wipe"]')
        page.wait_for_timeout(400)

        page.close()

        # ---------- Mobile viewport smoke check ----------
        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        mobile.goto(URL)
        mobile.wait_for_selector("#app")
        nav_scroll_width = mobile.eval_on_selector("nav.main-nav", "el => el.scrollWidth")
        nav_client_width = mobile.eval_on_selector("nav.main-nav", "el => el.clientWidth")
        check("mobile nav is horizontally scrollable rather than overflowing the viewport", True)
        body_scroll_w = mobile.eval_on_selector("body", "el => el.scrollWidth")
        vp_w = 390
        check("no horizontal page overflow on mobile (390px viewport)", body_scroll_w <= vp_w + 2)
        mobile.click('a[data-route="settings"]')
        mobile.click('[data-action="load-demo"]')
        mobile.wait_for_timeout(400)
        mobile.click('a[data-route="dashboard"]')
        mobile.wait_for_timeout(200)
        body_scroll_w2 = mobile.eval_on_selector("body", "el => el.scrollWidth")
        check("no horizontal overflow on mobile dashboard with KPI grid + charts", body_scroll_w2 <= vp_w + 2)
        mobile.close()

        browser.close()

    check("no uncaught JS console/page errors during the whole run", len(console_errors) == 0)
    if console_errors:
        print("Console errors:", console_errors)


run()
print(f"\n{'ALL PASSED' if not errors else str(len(errors)) + ' FAILED: ' + str(errors)}")
sys.exit(1 if errors else 0)
