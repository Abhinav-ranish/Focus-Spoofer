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

## 4. Helpful Commands

To create the zip file via terminal:
```bash
zip -r focus-spoofer.zip . -x "*.git*" "README.md" "PUBLISHING.md" "*.zip"
```

## 5. Review Period
The initial review usually takes **2-5 business days**. You will receive an email once it is approved or if changes are requested.
