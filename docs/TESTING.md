# Testing

## Automated

```bash
npm install            # dev-only: playwright-core (no browser download)
npm run check          # lint + unit tests + package build
npm run test:e2e       # real-browser suites (~40 s)
```

The browser suites need a Chromium that still honours `--load-extension`: by default the
Chrome for Testing build in the Playwright cache (`npx playwright-core install chromium` if
missing). Point `CHROME_PATH` at another binary to test it, e.g. Brave:

```bash
CHROME_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" npm run test:e2e
```

`HEADFUL=1` shows the browser windows.

| Suite | What it covers |
|---|---|
| `test/unit/telemetry.test.mjs` | Opt-in gating (disabled ⇒ nothing stored/sent), per-day aggregation, only finished days sent, retry/drop rules, ISO-week flag, first-activation logic, opt-out purge, payload whitelist |
| `test/unit/worker.test.mjs` | Survey validation (honeypot, min fill time, reasons, size caps, origin), rate limiting, no IP stored, report validation/clamping, aggregate-only writes, dashboard auth, extension↔server contract |
| `test/unit/worker-sql.test.mjs` | The Worker against real SQLite (`node:sqlite`): `schema.sql`, aggregate upserts, dashboard queries, and every SQL block in DEPLOY.md |
| `test/unit/background.test.mjs` | Service worker booted in a VM with a mocked `chrome`: uninstall URL on every start, bad Always-On entry isolation, serialized registration, fingerprint opt-out wiring, telemetry hooks (and none when opted out) |
| `test/e2e/spoofer.test.mjs` | Inactive pages untouched; visibility/focus spoofing; element focus/blur/hover still work; `onresize`; refresh; repeated and rapid toggling; rAF/cancel |
| `test/e2e/background.test.mjs` | Always-On add/remove; malformed entries; storage bursts; cross-origin navigation; state loss (restart/update); service-worker restart; fingerprint opt-out; real extension reload (update path) |
| `test/e2e/tab-switch.test.mjs` | **Real** tab switches over raw DevTools protocol (Playwright pins pages visible): detection events suppressed, focused input not blurred, rAF keeps ticking while hidden, plus two control tests proving the page really was hidden |
| `test/e2e/backend.test.mjs` | Extension pointed at the real Worker code (Node adapter, in-memory D1): no requests when opted out; opt-in via the settings checkbox sends one aggregate report; survey usable at 360 px; `uninstallSelf()` opens the survey and a submission is stored without the IP |

Last run (2026-10-07, macOS): unit 33/33; all four e2e suites 24/24 on each of Chrome for
Testing 149, Brave 153.1.95 and Edge 151. Branded Google Chrome 154 cannot load unpacked
extensions from the command line, so it is covered by the manual matrix only. The Worker was
also smoke-tested under `wrangler dev` (workerd): survey stored, report aggregated, 6th survey
post in a minute rate-limited (429), dashboard auth.

## Manual browser matrix

Run before each release in **Chrome stable**, **Brave** (Shields default) and optionally
**Edge**, with the packaged build (`npm run build` → load `extension/` unpacked, or the zip on a
test profile). Use `webpage/test.html` (the project's own detector page) plus one real site the
change targets. Record pass/fail per browser.

| # | Scenario | Steps | Expected |
|---|---|---|---|
| M1 | Basic protection | Open test page → toggle ON → switch tabs 10 s → return | No visibility/blur events logged; badge `ON`; popup "Protected" |
| M2 | Rapid tab switching | With M1 active, Ctrl/Cmd-Tab rapidly 20× | No events logged; no console errors |
| M3 | Minimize / other app | Minimize the window, focus another app, return | No events logged |
| M4 | Repeated on/off | Toggle 6× | Popup, badge and page agree each time; final OFF ⇒ events are logged again |
| M5 | Refresh while active | Toggle ON → reload 3× | Stays protected; badge stays `ON` |
| M6 | Forms still work | On a site with blur validation (e.g. any signup form) with protection ON, tab between fields | Validation messages appear as without the extension |
| M7 | Hover menus | Site with hover dropdowns (e.g. a docs site nav) | Menus open and close normally |
| M8 | Always-On | Popup → "Always enable for this site" → open the site in a new tab | Protected without toggling; uncheck ⇒ popup shows the tab's own state |
| M9 | Settings list | Settings → add/remove domains, including a bogus one | Other domains keep working |
| M10 | Cross-origin navigation | Toggle ON → click a link to another site in the same tab | Badge `ON` and the new site is protected (reload for full `document_start` coverage) |
| M11 | Restart browser | Toggle ON on a tab → quit → reopen with "Continue where you left off" | Popup and badge show the real state (open the popup if the badge is missing on a sleeping tab) |
| M12 | Update | Load v1.7, protect a tab, replace with v1.8 and reload the extension at `chrome://extensions` | Tab still protected after page reload; popup/badge agree; can be turned off with one click |
| M13 | Existing listeners | Page that registers `visibilitychange`/`blur` before and after load (test page does both) | None fire while away |
| M14 | Fingerprint toggle | Settings → turn off "Fingerprint randomization" → reload a protected canvas site | Canvas output identical to unprotected; focus spoofing still on |
| M15 | Video | Protected YouTube tab, switch away 1 min | Playback continues; no "are you still there" from visibility |
| M16 | Usage stats off | Fresh profile, use normally for a day with DevTools → service worker → Network open | No requests to the backend |
| M17 | Usage stats on | Settings → enable → "Exactly what is sent" preview; next day check Network | One `POST /api/report` per finished day; body matches the preview |
| M18 | Uninstall | Remove the extension | Survey tab opens with `?v=<version>`; Skip sends nothing; Submit shows "Thanks!" |
| M19 | Brave Shields | Repeat M1, M6, M14 with Shields "Block fingerprinting: strict" | Same results |
