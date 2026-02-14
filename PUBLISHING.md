# Publishing Focus Spoofer to the Chrome Web Store

This guide walks you through the steps to get **Focus Spoofer** published on the Chrome Web Store.

## 1. Prepare Your Assets

Before submitting, ensure you have the following assets ready:

### Extension Package
- Create a `.zip` file containing all files in the project root **except** `.git`, `README.md`, and this `PUBLISHING.md` file.
- Ensure `manifest.json` has the correct `version`, `name`, and `description`.

### Store Assets
| Asset Type | Dimensions | Requirement |
| :--- | :--- | :--- |
| **Small Tile Icon** | 440 x 280 | **Required** |
| **Large Tile Icon** | 920 x 680 | Optional (recommended) |
| **Marquee Tile** | 1400 x 560 | Optional (recommended) |
| **Screenshots** | 1280x800 or 640x400 | At least 1 required (up to 5) |

> [!TIP]
> Use high-quality screenshots that show the extension in action. Consider adding a short video (YouTube link) to the store listing.

## 2. Chrome Developer Account

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Sign in with a Google Account.
3. Pay the **$5 USD one-time developer registration fee**.

## 3. Upload & Submission

1. **Upload**: Click **"+ New Item"** and upload the `.zip` file you created.
2. **Package Tab**: Verify the version number and permissions.
3. **Store Listing Tab**:
    - **Description**: Highlight features like visibility spoofing and tab focus protection.
    - **Category**: Usually "Productivity" or "Developer Tools".
    - **Graphics**: Upload your tile icons and screenshots.
4. **Privacy Tab**:
    - **Single Purpose**: Explain that the extension's only purpose is to spoof focus events.
    - **Data Usage**: State that you do not collect or sell user data.
5. **Submit for Review**: Once all sections are green, click **"Submit for Review"**.

## 4. Store Listing Information

Copy and paste these into the Developer Dashboard:

### Tagline (Summary)
Stay Active, Stay Private. Prevents websites from detecting when you switch tabs or minimize the window.

### Detailed Description
**Take back your privacy with Focus Spoofer.**

Have you ever had a website pause your video, stop a timer, or flag you as "inactive" just because you switched tabs or minimized your browser? Focus Spoofer fixes that.

This lightweight extension tricks websites into thinking they are always visible and focused, regardless of what you're actually doing. 

**Key Features:**
- **Tab Visibility Spoofing**: Blocks websites from knowing when you’ve switched to another tab.
- **Window Focus Protection**: Prevents sites from detecting when you minimize the browser or click away.
- **Event Blocking**: Automatically stops `visibilitychange`, `blur`, and `mouseleave` events that trigger "away" states.
- **Simple Toggle**: Turn protection on or off with a single click from the toolbar.
- **Privacy First**: No tracking, no data collection, and no external calls. Everything happens locally in your browser.

**Perfect for:**
- Interactive learning platforms that pause when you multitask.
- Training videos that require stays on-screen.
- Preventing sites from tracking your attention metrics.

**Note:** For best results, it is recommended to reload the page after toggling the spoofing ON or OFF to ensure all overrides are correctly applied.

---

## 5. Permission Justifications

During submission, you will be asked to justify each permission. Use these concise explanations:

| Permission | Justification |
| :--- | :--- |
| **storage** | Used to persist user preferences (e.g., "Always On" list) across browser sessions. |
| **scripting** | Required to inject the spoofing logic into web pages to override focus and visibility APIs. |
| **activeTab** | Enables the extension to access and modify the currently active tab when the user interacts with the popup. |
| **webNavigation** | Used to detect page loads and automatically apply spoofing settings to whitelisted domains. |
| **Host permission** (`<all_urls>`) | The extension is a general-purpose utility designed to work on any website the user explicitly enables it for. |

---

## 6. Privacy & Safety Questionnaire Answers

Use these answers for the "Privacy" tab in the dashboard:

### Data Usage
- **Do you collect any user data?**: **NO** (Leave all checkboxes unchecked).

### Certifications
- [x] **I do not sell or transfer user data to third parties...**
- [x] **I do not use or transfer user data for purposes that are unrelated...**
- [x] **I do not use or transfer user data to determine creditworthiness...**

### Remote Code
- **Are you using remote code?**: **No, I am not using remote code**

---

## 7. Helpful Commands

To create the zip file via terminal:
```bash
zip -r focus-spoofer.zip . -x "*.git*" "README.md" "PUBLISHING.md" "*.zip"
```

## 5. Review Period
The initial review usually takes **2-5 business days**. You will receive an email once it is approved or if changes are requested.
