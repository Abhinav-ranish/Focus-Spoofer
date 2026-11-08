# Contributing to Focus Spoofer

Thanks for helping out. Bug reports, site compatibility reports, translations and pull
requests are all welcome.

## Reporting a site that still detects you

Open a [site compatibility issue](https://github.com/Abhinav-ranish/Focus-Spoofer/issues/new?template=site_compat.yml)
with the site, what it does when you switch away, your browser and version, and the
extension version (shown in the popup header). If you can, try the
[live detection test](https://focus.oddworks.us/test) first and say which checks fail.

## Development setup

You need Node.js 22.5 or newer and a Chromium browser.

```bash
npm install
npm run check      # lint + unit tests + package build; run before every PR
npm run test:e2e   # real-browser suites; run when you touch extension/
```

Load `extension/` unpacked from `chrome://extensions` (Developer mode) to try changes by
hand. [docs/TESTING.md](docs/TESTING.md) covers the browser suites and the manual matrix.

## Ground rules for code

- **Spoofing logic lives only in `extension/spoofer.js`.** `inject.js` and
  `inject_always.js` are gates that decide whether it runs; don't copy logic into them.
- **Only page-level signals are suppressed.** Element `focus`/`blur` and hover events must
  keep working, or forms and menus break. Add a test when you change event handling.
- **No runtime dependencies and no remote code.** The extension ships as plain JavaScript.
- **Privacy is a feature.** Don't add anything that sends data off the device without an
  opt-in, and update `webpage/privacy.html` if what is collected changes.
- Match the surrounding style. `npm run lint` must pass.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before larger changes, and
[docs/AUDIT.md](docs/AUDIT.md) for known limitations.

## Translations

Extension strings are in `extension/_locales/<lang>/messages.json`, website strings in
`i18n/site/<lang>.json` (build with `npm run site:i18n`), and store listing text in
`store-assets/i18n/<lang>.json`. Use `en` as the source and keep every key.

## Pull requests

- Keep each PR to one change, and explain what it fixes and how you tested it.
- Add or update tests for behavior changes.
- By contributing you agree that your work is licensed under the
  [Apache License 2.0](LICENSE).
