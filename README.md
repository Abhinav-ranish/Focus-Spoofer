# Focus Spoofer

A Chrome Extension that prevents websites from detecting when you switch tabs or minimize the window, and randomizes your canvas/WebGL/audio fingerprint.

## Features

- **Toggle On/Off**: Easily enable or disable protection for the current tab.
- **Visibility Spoofing**: Forces `document.hidden` to `false` and `document.visibilityState` to `'visible'` (defined on `Document.prototype`, so prototype-getter probes are covered too).
- **Focus Spoofing**: Forces `document.hasFocus()` to return `true`.
- **Event Blocking**: Blocks `visibilitychange` and `pagehide`, plus the `blur`/`focus`/`mouseleave` events that mean the *window or page* lost focus, so the page thinks you never left. Ordinary element focus/blur and hover events keep working, so forms and menus behave normally.
- **Timing-Detection Defense**: Keeps `requestAnimationFrame`, `requestVideoFrameCallback`, and timers ticking at a near-normal cadence while the tab is hidden, so sites can't infer backgrounding from stalled callbacks.
- **Fingerprint Randomization**: Injects a per-page-load, visually-imperceptible perturbation into canvas readback (`toDataURL`, `toBlob`, `getImageData`), WebGL `readPixels`, and audio sample data. The value is stable within a single page load (so canvas apps don't flicker) but changes on every reload — which is exactly how Cover Your Tracks detects a "randomized fingerprint," and it also defeats amiunique.org and browserleaks.com/canvas. Patched methods still report as native to `toString()` probes (including `Function.prototype.toString.call`).

> Fingerprint randomization runs whenever protection is active. Because it perturbs pixel/sample *readback*, canvas-heavy apps that read a canvas back, modify it, and write it out in a tight loop could drift slightly; if a specific site misbehaves, turn off **Settings → Fingerprint randomization** (focus spoofing keeps working).

## Installation

1.  Clone or download this repository.
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Enable **Developer mode** in the top right corner.
4.  Click **Load unpacked**.
5.  Select the folder containing this extension (`Focus-Toggle`).

## Usage

1.  Navigate to a website that pauses video or tracks your attention (e.g., a training site or YouTube).
2.  Click the **Focus Spoofer** (eye) icon in the toolbar.
3.  Toggle the switch to **ON**.
    *   The badge text will show "ON".
    *   The extension will inject code to trick the page into thinking it is always visible and focused.
4.  Switch tabs or minimize Chrome. The content should continue playing or remaining active.

## Notes

-   **Persistence**: The state is saved per-tab during the session. If you close the tab, the state is cleared.
-   **Reloading**: If you toggle OFF, it is recommended to reload the page to fully clear the injected overrides.

## Settings

-   **Always-On Domains**: protect listed sites automatically on every load.
-   **Fingerprint randomization**: on by default; turn off if a drawing app, editor or game misbehaves.
-   **Anonymous usage statistics**: off by default. When on, one daily summary of counts (no URLs, sites or identifiers) is sent. Settings lists exactly what is sent. See the [privacy policy](webpage/privacy.html).

## Development

```bash
npm install
npm run check      # lint + unit tests + dist/focus-spoofer-<version>.zip
npm run test:e2e   # real-browser regression suites
```

-   [docs/TESTING.md](docs/TESTING.md): automated suites and the manual browser matrix
-   [docs/AUDIT.md](docs/AUDIT.md): reliability audit and known limitations
-   [docs/DEPLOY.md](docs/DEPLOY.md): feedback backend (`server/`), build, Chrome Web Store disclosure
