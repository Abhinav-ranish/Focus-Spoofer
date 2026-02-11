# Focus Spoofer

A Chrome Extension that prevents websites from detecting when you switch tabs or minimize the window.

## Features

- **Toggle On/Off**: Easily enable or disable focusing spoofing for the current tab.
- **Visibility Spoofing**: Forces `document.hidden` to `false` and `document.visibilityState` to `'visible'`.
- **Focus Spoofing**: Forces `document.hasFocus()` to return `true`.
- **Event Blocking**: Blocks `blur`, `visibilitychange`, `mouseleave`, and `pagehide` events so the page thinks you never left.

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
