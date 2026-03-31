const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ICON_SVG = fs.readFileSync(path.join(__dirname, '../extension/icons/icon.svg'), 'utf-8');
const INNER_SVG = fs.readFileSync(path.join(__dirname, '../extension/icons/icon-inner.svg'), 'utf-8');
const INNER_ACTIVE_SVG = fs.readFileSync(path.join(__dirname, '../extension/icons/icon-inner-active.svg'), 'utf-8');

// Encode SVGs for inline use
const enc = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const SHARED_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: #0a0a0b;
    color: #f4f4f5;
    overflow: hidden;
  }
`;

// ── Screenshot 1: Popup inactive state (1280x800) ──
const screenshot1HTML = `<!DOCTYPE html><html><head><style>
${SHARED_STYLES}
body { width: 1280px; height: 800px; display: flex; align-items: center; justify-content: center; position: relative; }
.bg-glow {
  position: absolute; width: 600px; height: 600px; border-radius: 50%;
  background: radial-gradient(circle, rgba(239,68,68,0.08) 0%, transparent 70%);
  top: 50%; left: 50%; transform: translate(-50%, -50%);
}
.popup {
  width: 320px; background: #18181b; border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px; padding: 20px; box-shadow: 0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03);
}
.header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.logo { width: 28px; height: 28px; }
.header-text { display: flex; align-items: baseline; gap: 6px; flex: 1; }
h1 { font-size: 14px; font-weight: 600; }
.version { font-size: 10px; color: #52525b; }
.gear { color: #52525b; }
.card { background: #1a1a1e; border: 1px solid rgba(255,255,255,0.05); border-radius: 14px; padding: 24px 20px 20px; display: flex; flex-direction: column; align-items: center; }
.icon { width: 56px; height: 56px; margin-bottom: 12px; }
.status { font-weight: 600; font-size: 13px; color: #52525b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 16px; }
.toggle { width: 52px; height: 28px; background: #27272a; border-radius: 28px; position: relative; margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.08); }
.toggle::after { content: ''; position: absolute; width: 20px; height: 20px; background: #71717a; border-radius: 50%; top: 3px; left: 3px; }
.divider { width: 100%; height: 1px; background: rgba(255,255,255,0.06); margin-bottom: 16px; }
.option { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #a1a1aa; width: 100%; }
.checkbox { width: 16px; height: 16px; border: 1.5px solid #3f3f46; border-radius: 4px; flex-shrink: 0; }
.desc { font-size: 11px; color: #52525b; text-align: center; margin-top: 12px; line-height: 1.5; }
.tagline {
  position: absolute; bottom: 80px; text-align: center; width: 100%;
  font-size: 14px; color: #52525b; letter-spacing: 0.02em;
}
</style></head><body>
<div class="bg-glow"></div>
<div class="popup">
  <div class="header">
    <img src="${enc(ICON_SVG)}" class="logo">
    <div class="header-text"><h1>Focus Spoofer</h1><span class="version">v1.2</span></div>
    <span class="gear">⚙</span>
  </div>
  <div class="card">
    <img src="${enc(INNER_SVG)}" class="icon">
    <div class="status">Inactive</div>
    <div class="toggle"></div>
    <div class="divider"></div>
    <div class="option"><div class="checkbox"></div><span>Always enable for this site</span></div>
    <div class="desc">Prevents this tab from detecting when you switch away.</div>
  </div>
</div>
<div class="tagline">Your tabs. Your privacy. Your rules.</div>
</body></html>`;

// ── Screenshot 2: Popup active state (1280x800) ──
const screenshot2HTML = `<!DOCTYPE html><html><head><style>
${SHARED_STYLES}
body { width: 1280px; height: 800px; display: flex; align-items: center; justify-content: center; position: relative; }
.bg-glow {
  position: absolute; width: 600px; height: 600px; border-radius: 50%;
  background: radial-gradient(circle, rgba(34,197,94,0.1) 0%, transparent 70%);
  top: 50%; left: 50%; transform: translate(-50%, -50%);
}
.popup {
  width: 320px; background: #18181b; border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px; padding: 20px; box-shadow: 0 25px 60px rgba(0,0,0,0.6), 0 0 30px rgba(34,197,94,0.08);
}
.header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.logo { width: 28px; height: 28px; }
.header-text { display: flex; align-items: baseline; gap: 6px; flex: 1; }
h1 { font-size: 14px; font-weight: 600; }
.version { font-size: 10px; color: #52525b; }
.gear { color: #52525b; }
.card { background: #1a1a1e; border: 1px solid rgba(255,255,255,0.05); border-radius: 14px; padding: 24px 20px 20px; display: flex; flex-direction: column; align-items: center; }
.icon { width: 56px; height: 56px; margin-bottom: 12px; filter: drop-shadow(0 0 10px rgba(34,197,94,0.25)) drop-shadow(0 0 20px rgba(34,197,94,0.25)); }
.status { font-weight: 600; font-size: 13px; color: #22c55e; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 16px; }
.toggle { width: 52px; height: 28px; background: #22c55e; border-radius: 28px; position: relative; margin-bottom: 20px; box-shadow: 0 0 14px rgba(34,197,94,0.25); }
.toggle::after { content: ''; position: absolute; width: 20px; height: 20px; background: #fff; border-radius: 50%; top: 4px; right: 4px; }
.divider { width: 100%; height: 1px; background: rgba(255,255,255,0.06); margin-bottom: 16px; }
.option { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #a1a1aa; width: 100%; }
.checkbox { width: 16px; height: 16px; border: 1.5px solid #3f3f46; border-radius: 4px; flex-shrink: 0; }
.desc { font-size: 11px; color: #52525b; text-align: center; margin-top: 12px; line-height: 1.5; }
.tagline {
  position: absolute; bottom: 80px; text-align: center; width: 100%;
  font-size: 14px; color: #3f3f46; letter-spacing: 0.02em;
}
</style></head><body>
<div class="bg-glow"></div>
<div class="popup">
  <div class="header">
    <img src="${enc(ICON_SVG)}" class="logo">
    <div class="header-text"><h1>Focus Spoofer</h1><span class="version">v1.2</span></div>
    <span class="gear">⚙</span>
  </div>
  <div class="card">
    <img src="${enc(INNER_ACTIVE_SVG)}" class="icon">
    <div class="status">Protected</div>
    <div class="toggle"></div>
    <div class="divider"></div>
    <div class="option"><div class="checkbox"></div><span>Always enable for this site</span></div>
    <div class="desc">Prevents this tab from detecting when you switch away.</div>
  </div>
</div>
<div class="tagline">Focus spoofing active — tab appears always in view.</div>
</body></html>`;

// ── Screenshot 3: Settings page (1280x800) ──
const screenshot3HTML = `<!DOCTYPE html><html><head><style>
${SHARED_STYLES}
body { width: 1280px; height: 800px; display: flex; align-items: center; justify-content: center; }
.settings {
  width: 540px; padding: 48px 24px;
}
.page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
.page-header img { width: 32px; height: 32px; }
.page-header h1 { font-size: 20px; font-weight: 600; }
.card {
  background: #18181b; border: 1px solid rgba(255,255,255,0.06);
  border-radius: 16px; padding: 28px;
  box-shadow: 0 25px 60px rgba(0,0,0,0.4);
}
h2 { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
.card-desc { color: #a1a1aa; font-size: 13px; margin-bottom: 24px; line-height: 1.6; }
.input-group { display: flex; gap: 10px; margin-bottom: 24px; }
.input-group input {
  flex: 1; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04);
  color: #52525b; font-size: 13px; font-family: inherit; outline: none;
}
.input-group button {
  padding: 10px 20px; background: linear-gradient(135deg, #ef4444, #22c55e);
  color: #fff; border: none; border-radius: 10px; font-weight: 600; font-size: 13px;
}
.list-header { font-size: 11px; font-weight: 500; color: #52525b; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
.domain-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 14px; border-radius: 10px;
}
.domain-item:hover { background: rgba(255,255,255,0.03); }
.domain-name { font-size: 13px; font-family: 'SF Mono', monospace; }
.remove { color: #52525b; font-size: 11px; background: none; border: none; }
</style></head><body>
<div class="settings">
  <div class="page-header">
    <img src="${enc(ICON_SVG)}">
    <h1>Settings</h1>
  </div>
  <div class="card">
    <h2>Always-On Domains</h2>
    <p class="card-desc">Focus spoofing activates automatically for these domains when they load.</p>
    <div class="input-group">
      <input type="text" value="" placeholder="example.com">
      <button>Add</button>
    </div>
    <div class="list-header">Domains</div>
    <div class="domain-item"><span class="domain-name">canvas.asu.edu</span><span class="remove">Remove</span></div>
    <div class="domain-item"><span class="domain-name">zoom.us</span><span class="remove">Remove</span></div>
    <div class="domain-item"><span class="domain-name">teams.microsoft.com</span><span class="remove">Remove</span></div>
  </div>
</div>
</body></html>`;

// ── Small Promo Tile (440x280) ──
const smallPromoHTML = `<!DOCTYPE html><html><head><style>
${SHARED_STYLES}
body {
  width: 440px; height: 280px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #0a0a0b 0%, #151518 100%);
  position: relative; overflow: hidden;
}
.glow-red { position: absolute; width: 300px; height: 300px; border-radius: 50%; background: radial-gradient(circle, rgba(239,68,68,0.12) 0%, transparent 70%); top: -80px; left: -60px; }
.glow-green { position: absolute; width: 250px; height: 250px; border-radius: 50%; background: radial-gradient(circle, rgba(34,197,94,0.08) 0%, transparent 70%); bottom: -60px; right: -40px; }
.content { display: flex; align-items: center; gap: 28px; z-index: 1; }
.icon { width: 80px; height: 80px; filter: drop-shadow(0 4px 20px rgba(239,68,68,0.2)); }
.text h2 { font-size: 22px; font-weight: 700; margin-bottom: 6px; letter-spacing: -0.02em; }
.text p { font-size: 12px; color: #71717a; line-height: 1.5; max-width: 220px; }
.badge { display: inline-block; margin-top: 10px; padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 600; background: rgba(34,197,94,0.1); color: #22c55e; border: 1px solid rgba(34,197,94,0.2); }
</style></head><body>
<div class="glow-red"></div>
<div class="glow-green"></div>
<div class="content">
  <img src="${enc(ICON_SVG)}" class="icon">
  <div class="text">
    <h2>Focus Spoofer</h2>
    <p>Prevents websites from detecting when you switch tabs or minimize your window.</p>
    <span class="badge">v1.2 — Free & Open Source</span>
  </div>
</div>
</body></html>`;

// ── Marquee Promo Tile (1400x560) ──
const marqueeHTML = `<!DOCTYPE html><html><head><style>
${SHARED_STYLES}
body {
  width: 1400px; height: 560px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #0a0a0b 0%, #111114 50%, #0f1210 100%);
  position: relative; overflow: hidden;
}
.glow-red { position: absolute; width: 500px; height: 500px; border-radius: 50%; background: radial-gradient(circle, rgba(239,68,68,0.1) 0%, transparent 70%); top: -100px; left: 100px; }
.glow-green { position: absolute; width: 400px; height: 400px; border-radius: 50%; background: radial-gradient(circle, rgba(34,197,94,0.07) 0%, transparent 70%); bottom: -80px; right: 200px; }
.content { display: flex; align-items: center; gap: 80px; z-index: 1; }
.left { display: flex; flex-direction: column; align-items: flex-start; }
.icon { width: 72px; height: 72px; margin-bottom: 24px; filter: drop-shadow(0 4px 24px rgba(239,68,68,0.25)); }
.left h2 { font-size: 40px; font-weight: 800; letter-spacing: -0.03em; margin-bottom: 12px; line-height: 1.1; }
.left h2 span { background: linear-gradient(90deg, #ef4444, #22c55e); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.left p { font-size: 16px; color: #71717a; line-height: 1.6; max-width: 420px; }
.badges { display: flex; gap: 8px; margin-top: 20px; }
.badge { padding: 5px 14px; border-radius: 20px; font-size: 11px; font-weight: 600; }
.badge-red { background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.2); }
.badge-green { background: rgba(34,197,94,0.1); color: #22c55e; border: 1px solid rgba(34,197,94,0.2); }
.right { display: flex; gap: 20px; }
.mock-popup {
  width: 240px; background: #18181b; border: 1px solid rgba(255,255,255,0.06);
  border-radius: 14px; padding: 18px 16px;
  box-shadow: 0 20px 50px rgba(0,0,0,0.5);
}
.mock-popup.active { box-shadow: 0 20px 50px rgba(0,0,0,0.5), 0 0 30px rgba(34,197,94,0.06); }
.mock-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.mock-logo { width: 20px; height: 20px; }
.mock-title { font-size: 11px; font-weight: 600; }
.mock-card { background: #1a1a1e; border: 1px solid rgba(255,255,255,0.04); border-radius: 10px; padding: 18px 14px; display: flex; flex-direction: column; align-items: center; }
.mock-eye { width: 40px; height: 40px; margin-bottom: 8px; }
.mock-eye.glow { filter: drop-shadow(0 0 8px rgba(34,197,94,0.3)); }
.mock-status { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }
.mock-status.off { color: #52525b; }
.mock-status.on { color: #22c55e; }
.mock-toggle { width: 40px; height: 22px; border-radius: 22px; position: relative; }
.mock-toggle.off { background: #27272a; border: 1px solid rgba(255,255,255,0.08); }
.mock-toggle.on { background: #22c55e; }
.mock-toggle::after { content: ''; position: absolute; width: 16px; height: 16px; background: #71717a; border-radius: 50%; top: 2.5px; }
.mock-toggle.off::after { left: 3px; background: #71717a; }
.mock-toggle.on::after { right: 3px; left: auto; background: #fff; }
.mock-label { font-size: 10px; font-weight: 600; color: #3f3f46; text-align: center; margin-top: 8px; }
</style></head><body>
<div class="glow-red"></div>
<div class="glow-green"></div>
<div class="content">
  <div class="left">
    <img src="${enc(ICON_SVG)}" class="icon">
    <h2>Your Tabs.<br><span>Never Sleep.</span></h2>
    <p>Focus Spoofer prevents websites from detecting when you switch tabs, minimize the window, or look away.</p>
    <div class="badges">
      <span class="badge badge-red">Privacy First</span>
      <span class="badge badge-green">Open Source</span>
    </div>
  </div>
  <div class="right">
    <div class="mock-popup">
      <div class="mock-header"><img src="${enc(ICON_SVG)}" class="mock-logo"><span class="mock-title">Focus Spoofer</span></div>
      <div class="mock-card">
        <img src="${enc(INNER_SVG)}" class="mock-eye">
        <div class="mock-status off">Inactive</div>
        <div class="mock-toggle off"></div>
      </div>
      <div class="mock-label">Before</div>
    </div>
    <div class="mock-popup active">
      <div class="mock-header"><img src="${enc(ICON_SVG)}" class="mock-logo"><span class="mock-title">Focus Spoofer</span></div>
      <div class="mock-card">
        <img src="${enc(INNER_ACTIVE_SVG)}" class="mock-eye glow">
        <div class="mock-status on">Protected</div>
        <div class="mock-toggle on"></div>
      </div>
      <div class="mock-label">After</div>
    </div>
  </div>
</div>
</body></html>`;

async function generate() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const outDir = path.join(__dirname);

  const pages = [
    { name: 'screenshot-1-inactive.png', html: screenshot1HTML, width: 1280, height: 800 },
    { name: 'screenshot-2-active.png', html: screenshot2HTML, width: 1280, height: 800 },
    { name: 'screenshot-3-settings.png', html: screenshot3HTML, width: 1280, height: 800 },
    { name: 'small-promo-440x280.png', html: smallPromoHTML, width: 440, height: 280 },
    { name: 'marquee-1400x560.png', html: marqueeHTML, width: 1400, height: 560 },
  ];

  for (const { name, html, width, height } of pages) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    // Take at 2x then resize to exact dimensions for crisp output
    const buf = await page.screenshot({ type: 'png' });
    const sharp = require('sharp');
    await sharp(buf).resize(width, height).png().toFile(path.join(outDir, name));
    await page.close();
    console.log(`✓ ${name}`);
  }

  await browser.close();
  console.log('Done!');
}

generate().catch(console.error);
