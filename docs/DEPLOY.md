# Deploying v1.8: feedback backend, extension build, Chrome Web Store

**Status (2026-10-07):** the backend is deployed at
`https://focus-spoofer-feedback.aranish.workers.dev` (Cloudflare account "Aranish@asu.edu's
Account", D1 `focus-spoofer`) and `extension/config.js` points at it. The dashboard token is in
`~/.config/focus-spoofer/dashboard-token` on the deploying machine (never committed). The
extension and the website changes are not published yet.

## 1. Backend (Cloudflare Worker + D1)

Everything lives in `server/`: one Worker serving the survey page (`/uninstall`), the survey
endpoint, the opt-in report endpoint, and a token-protected dashboard (`/dashboard`). The
free tier is enough: D1 (5 GB, 5M reads/day), Workers (100k requests/day), Rate Limiting.

```bash
cd server
npx wrangler d1 create focus-spoofer                 # copy the printed database_id
#   → paste it into wrangler.jsonc ("database_id")
npx wrangler d1 execute focus-spoofer --remote --file=schema.sql
npx wrangler secret put DASHBOARD_TOKEN              # long random string, e.g. `openssl rand -hex 32`
npx wrangler deploy                                  # prints https://focus-spoofer-feedback.<subdomain>.workers.dev
```

Recommended once the store build is live: uncomment the `EXTENSION_ORIGINS` var in
`wrangler.jsonc` (published ID `ejgeaphjlcnmjgadkcljhchgbaiioihh`) so only the store build's
reports are accepted. Reports are always refused from web-page origins; a non-browser client
can still forge them (there is deliberately no identity), so validation clamps and the rate
limiter bound the damage.

Optional: attach a custom domain (e.g. `feedback.<your-domain>`) in the Cloudflare dashboard
and use that origin instead.

Check it:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<origin>/uninstall          # 200
curl -s -X POST https://<origin>/api/report -H 'content-type: application/json' -d '{}'   # 400 bad_schema
```

Open `https://<origin>/dashboard` and paste the token.

Privacy-relevant configuration (already set in `wrangler.jsonc`): Workers observability/logs
are **off**, so request URLs and client addresses are not retained in logs. The rate limiter
keys on the client address only inside Cloudflare's rate-limit counters for the 60-second
window. Do not enable Logpush or Workers Logs for this Worker without updating the privacy policy.

## 2. Point the extension at it

Edit `extension/config.js`:

```js
BACKEND_ORIGIN: 'https://focus-spoofer-feedback.<subdomain>.workers.dev'
```

No trailing slash. No manifest change is needed: `<all_urls>` already covers the request and
`setUninstallURL` needs no permission. Leaving it empty ships a build with the survey and
reporting disabled (the settings checkbox shows "not available in this build").

## 3. Build and verify

```bash
npm install
npm run check          # lint + unit tests + dist/focus-spoofer-1.8.zip
npm run test:e2e       # real-browser suites
```

`npm run build` refuses a malformed origin and warns if it is empty. Then run the manual
matrix in [TESTING.md](TESTING.md) on Chrome stable and Brave with the zip loaded unpacked.

## 4. Chrome Web Store

### Privacy policy (required before publishing)

The live policy says "No analytics. Ever." — that would be false once the opt-in stats ship,
which is a policy-violation risk. `webpage/privacy.html` has been updated in this branch;
**deploy the website first**, then publish the extension.

### Privacy practices tab

- **Single purpose:** unchanged.
- **Permission justifications:** unchanged (no permissions added).
- **Remote code:** No.
- **Data usage:** none of the listed categories apply, so leave them unticked. Reports contain
  no personally identifiable, health, financial, authentication, communication or location
  data, no web history, no website content, and no user activity (clicks, keystrokes,
  mouse/scroll). Only opt-in counts of the extension's own toggle and settings events plus
  error categories are sent, with no identifier. The uninstall survey is an ordinary web page,
  answered voluntarily after removal.
  This is a judgment call: if a reviewer disagrees, the conservative fallback is to tick
  **User activity** and say "opt-in, anonymous, aggregate counts of extension feature use".
- **Certifications:** keep all three ticked (not sold; not used for unrelated purposes; not
  used for creditworthiness). They remain true.

### Listing description

Add one line, e.g.: *"Optional, off-by-default anonymous usage statistics (daily counts only,
no browsing data) — see Settings."*

### Version

`manifest.json` is 1.8. Upload `dist/focus-spoofer-1.8.zip`.

## 5. Reading the data

The dashboard covers the common views. For anything else, run SQL with
`npx wrangler d1 execute focus-spoofer --remote --command "<sql>"`. `npm test` runs every query below against
`schema.sql` (`test/unit/worker-sql.test.mjs`), so they stay valid.

**What the numbers mean.** `reports` is the number of *opted-in* installs that sent a report
for that day (each install sends at most one per day; a day is reported when the extension
woke up that day). It is **not** total daily active users and cannot be extrapolated without
knowing the opt-in rate; the Chrome Web Store's user count remains the source for totals.
Reports can be undercounted (offline, uninstalled before sending, worker never woke) and,
because there is no ID, cannot be de-duplicated across reinstalls or profiles.
`active_reports` counts reports with at least one activation that day.

Activation trend (opted-in installs that turned protection on, per day):

```sql
SELECT day, SUM(reports) AS reporting, SUM(active_reports) AS activating,
       ROUND(100.0 * SUM(active_reports) / SUM(reports), 1) AS pct_activating,
       SUM(activations) AS activations, SUM(deactivations) AS deactivations
FROM usage_daily WHERE day >= date('now', '-30 days')
GROUP BY day ORDER BY day;
```

Weekly reporting installs:

```sql
SELECT week, SUM(reports) AS installs_reporting, SUM(active_reports) AS installs_activating
FROM usage_weekly GROUP BY week ORDER BY week DESC LIMIT 12;
```

Feature usage (Always-On):

```sql
SELECT day, SUM(always_on_reports) AS installs_with_always_on,
       SUM(always_on_added) AS sites_added, SUM(always_on_removed) AS sites_removed
FROM usage_daily WHERE day >= date('now', '-30 days')
GROUP BY day ORDER BY day;
```

New installs reaching a first activation:

```sql
SELECT day, SUM(first_activations) AS first_activations
FROM usage_daily WHERE day >= date('now', '-30 days')
GROUP BY day ORDER BY day;
```

Error categories by version:

```sql
SELECT version, category, SUM(count) AS events
FROM errors_daily WHERE day >= date('now', '-30 days')
GROUP BY version, category ORDER BY events DESC;
```

Uninstall reasons and comments:

```sql
SELECT reason, COUNT(*) AS responses FROM uninstall_feedback
WHERE day >= date('now', '-90 days') GROUP BY reason ORDER BY responses DESC;
SELECT day, version, reason, details FROM uninstall_feedback
WHERE details IS NOT NULL ORDER BY id DESC LIMIT 50;
```

Free-text comments are user-written; read them as untrusted text (the dashboard renders them
with `textContent`). Delete any that contain personal information:
`DELETE FROM uninstall_feedback WHERE id = <id>;`
