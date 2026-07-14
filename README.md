# Focus Spoofer

A Chrome Extension that prevents websites from detecting when you switch tabs or minimize the window, and randomizes your canvas/WebGL/audio fingerprint.

## Features

- **Toggle On/Off**: Easily enable or disable protection for the current tab.
- **Visibility Spoofing**: Forces `document.hidden` to `false` and `document.visibilityState` to `'visible'` (defined on `Document.prototype`, so prototype-getter probes are covered too).
- **Focus Spoofing**: Forces `document.hasFocus()` to return `true`.
- **Event Blocking**: Blocks `blur`, `visibilitychange`, `mouseleave`, and `pagehide` events so the page thinks you never left.
- **Timing-Detection Defense**: Keeps `requestAnimationFrame`, `requestVideoFrameCallback`, and timers ticking at a near-normal cadence while the tab is hidden, so sites can't infer backgrounding from stalled callbacks.
- **Fingerprint Randomization**: Injects a per-page-load, visually-imperceptible perturbation into canvas readback (`toDataURL`, `toBlob`, `getImageData`), WebGL `readPixels`, and audio sample data. The value is stable within a single page load (so canvas apps don't flicker) but changes on every reload — which is exactly how Cover Your Tracks detects a "randomized fingerprint," and it also defeats amiunique.org and browserleaks.com/canvas. Patched methods still report as native to `toString()` probes (including `Function.prototype.toString.call`).

> Fingerprint randomization runs whenever protection is active. Because it perturbs pixel/sample *readback*, canvas-heavy apps that read a canvas back, modify it, and write it out in a tight loop could drift slightly; if a specific site misbehaves, toggle protection off for that site.

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
