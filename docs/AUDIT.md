# Reliability audit — Focus Spoofer v1.7 → v1.8

Scope: `extension/` (MV3 manifest, service worker, MAIN-world content scripts, popup, settings).
Method: code review, then a real-browser regression suite run against **both** the v1.7 code
and the fixed code. Every "Fixed" item below has a test that fails on v1.7 and passes on
v1.8 unless it is marked *hardening*. See [TESTING.md](TESTING.md) for how to run the suites.

## Prioritized bugs likely contributing to uninstalls

Priority reflects how many users hit it × how visible the damage is.

| # | Pri | Bug (v1.7) | Who sees it | Status | Evidence |
|---|-----|-----------|-------------|--------|----------|
| 1 | P0 | **Page focus/blur handling broken while protection is on.** `addEventListener` dropped every `blur`/`focusout`/`mouseleave` registration on *every element*, and capture-phase filters on `window` stopped every element `focus`/`focusin` after the first one. Form validation on blur, React `onFocus`/`onBlur` (wired through `focusin`/`focusout` on the root), autocomplete dropdowns and hover menus stopped working. | Anyone who turns it on for a real web app | Fixed | `spoofer.test.mjs` "element focus/blur…"; `tab-switch.test.mjs` "focused input…" |
| 2 | P0 | **Popup lies after a browser restart or extension update.** `chrome.storage.session` is wiped, but the page's own `sessionStorage` flag (restored with the tab) keeps protection on. The popup says *Inactive* and the badge is off while the page is still spoofed; the first click does nothing visible. Every auto-update triggered this for every protected tab. | Every user on every update | Fixed: popup reconciles with the page; badges are rebuilt on startup/update | `background.test.mjs` "popup state survives…", "extension update/reload…" |
| 3 | P1 | **One bad Always-On entry disables all Always-On sites.** Chrome rejects the whole `registerContentScripts` call if any match pattern is invalid (e.g. the popup saving an IPv6 host like `[::1]`). The failure was only logged to the console. | Always-On users | Fixed: invalid entries are isolated and skipped | `background.test.mjs` "one malformed always-on entry…" |
| 4 | P1 | **Badge says ON but the page is unprotected after a cross-origin navigation** (SSO redirects, course platforms that hop domains, clicking a link to another site). The flag lives in per-origin `sessionStorage`, so the new origin's gate stays closed. | "Didn't work on my website" | Fixed (best effort, see U1) | `background.test.mjs` "navigating an active tab…" |
| 5 | P1 | **Battery/CPU drain on every protected frame**, including visible tabs and every ad iframe: a perpetual native rAF loop (renders at 60 fps forever), a worker posting every 16 ms, and a 100 ms interval. | Laptop users who leave it on | Fixed: clocks run only while the tab is really hidden; rAF is driven on demand | `tab-switch.test.mjs` proves hidden-tab ticking still works. **No power measurement was taken**; the saving is inferred from removing the always-on loops. |
| 6 | P2 | **Canvas/WebGL/audio noise can break drawing apps, editors, games, image export**, and there was no way to keep focus spoofing without it. | Creative/tool sites | Mitigated: Settings → "Fingerprint randomization" (default on, unchanged behaviour) | `background.test.mjs` "fingerprint randomization can be turned off…" |
| 7 | P2 | **`Function.prototype.toString` replaced on every page for every user**, even where protection was never turned on — a global footprint that integrity checks on unrelated sites could trip over. | Everyone | Fixed: installed only on activation | `spoofer.test.mjs` "inactive page is left untouched" |
| 8 | P2 | **`window.onresize` neutralized** (while `addEventListener('resize')` was not), breaking responsive layouts that use the property. No detection benefit. | Some sites | Fixed | `spoofer.test.mjs` "window.onresize…" |
| 9 | P2 | **Return-to-tab leaked a `focus` event** when the page had loaded without an initial focus (opened or reloaded in the background): the "allow the first focus" rule let the *return* through. Intermittent. | Detection-sensitive sites | Fixed | `tab-switch.test.mjs` "protected page never sees the tab switch" (was flaky on v1.7) |
| 10 | P3 | Popup kept showing "Protected" after unchecking *Always enable for this site* when the tab itself was not toggled on. | Always-On users | Fixed | Manual (popup UI) |
| 11 | P3 | Popup switch could disagree with the background if the toggle message failed. | Rare | Fixed | Manual |
| 12 | P3 | Content-script (un)registration and per-tab state were unserialized read-modify-writes; overlapping events could produce duplicate-ID errors or lost updates. | Rare | *Hardening*: not reproduced in the browser (the burst test passes on v1.7 too); reproduced with a mocked API in `test/unit/background.test.mjs` | |

## Known limitations (documented, not fixed)

| | Limitation | Notes / recommendation |
|---|---|---|
| U1 | First load after a cross-origin navigation is protected by an injection at commit time (`injectImmediately`), which can run after the page's first inline scripts. A reload is fully protected from `document_start`. | Inherent to per-tab (not per-site) toggling without a per-tab content-script filter in MV3. |
| U2 | Signals not covered: `mouseout`/`pointerleave` with `relatedTarget === null`, Page Lifecycle `freeze`/`resume`, `IntersectionObserver` changes, server-side heartbeat timing, `document.activeElement` checks, focus of cross-origin iframes the user never toggled. | Add case by case if survey data shows specific sites. |
| U3 | The extension is detectable: `window.__FOCUS_SPOOFER_RUN`, the `FOCUS_SPOOFers_ACTIVE` sessionStorage key, and patched prototypes. | Intentionally **not** hardened. Proctoring, exam, anti-cheat and anti-abuse systems are unsupported and out of scope. |
| U4 | The timing defence still creates a near-silent `AudioContext` at load in every protected frame (keeps the tab "audible" to avoid intensive throttling). After the first user gesture the tab can show a speaker icon and hold the audio device. | Candidate follow-up: create/resume it only while hidden. Not changed because hidden-tab throttling exemption could not be verified end-to-end for a lazily created context. |
| U5 | A tab opened from a protected tab with an opener (same origin) can inherit the sessionStorage flag: protected, but its badge is off until the popup is opened. | Popup open reconciles it. |
| U6 | Discarded/sleeping tabs are not inspected at startup; their badge corrects itself when the tab loads or the popup is opened. | |
| U7 | Not injectable: `chrome://`, Chrome Web Store, other extensions' pages, PDFs in the built-in viewer, and `file://` (unless "Allow access to file URLs" is enabled). The popup shows "Unavailable" for non-http(s) pages. | |
| U8 | Browsers: automated suites pass on Chrome for Testing 149, Brave 153 and Edge 151 (macOS). Branded Google Chrome ≥137 ignores `--load-extension`, so Chrome stable (154 here) is covered by the manual matrix only. Firefox/Safari are unsupported (MV3 `world: 'MAIN'` registration). | |
| U9 | Install-time warning "Read your browsing history" comes from the `webNavigation` permission (used to protect frames on navigation and re-badge). `activeTab` is redundant with `<all_urls>`. | Permissions were not changed in this release to avoid any re-approval prompt or behaviour change. |
| U10 | `alwaysOnDomains` lives in one `chrome.storage.sync` item (~8 KB, a few hundred domains). Writes beyond that fail silently in the popup/settings. | Low impact. |

## Area-by-area notes

- **Manifest V3:** valid; no remote code; all scripts local; CSP-compatible (no inline scripts in extension pages — enforced by `npm run lint`). `version` bumped to 1.8. No permissions added.
- **Service worker lifecycle:** no in-memory state is relied on between events (state is in `chrome.storage.session`; queues only serialize work within one worker lifetime). Dynamic content scripts persist across worker restarts and are re-registered on install/update/startup. `setUninstallURL` is applied at top level on every worker start. Verified by "service worker restart keeps registrations and state" (worker stopped via DevTools protocol).
- **Visibility spoofing:** `document.hidden`, `visibilityState`, `webkit*` and `hasFocus()` are defined on `Document.prototype` and the instance; prototype-getter probes return the spoofed value (tested).
- **Focus/blur:** see bugs 1 and 9. Element-level behaviour now matches an unprotected page except for the blur/re-focus pair caused by the window itself losing/regaining focus (verified with real tab switches).
- **SPAs / dynamic navigation:** history-API navigations keep the document, so protection persists. Same-origin full navigations are covered at `document_start` by the flag; cross-origin, see bug 4 / U1.
- **Injection timing:** registered scripts run at `document_start` in the MAIN world in all frames (`matchOriginAsFallback` covers about:blank/srcdoc). The toggle reloads the tab so protection starts before page scripts.
- **Updates:** already-open pages keep the old MAIN-world code until reloaded (it doesn't depend on the extension context, so it keeps working); state and badges are rebuilt on update (bug 2).
- **Error handling:** previously silent failures (registration, flag injection, state storage) are now counted by category for users who opt in to usage stats; nothing is sent otherwise.
