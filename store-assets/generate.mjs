// Chrome Web Store assets, built from the REAL extension and website.
//
//   npm run assets
//
// 1. Captures the actual popup (stubbed tab state), the settings page, and the
//    live test page after genuine tab switches with and without protection.
// 2. Composes those captures into the store frames below and writes exact-size
//    PNGs next to this file.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, EXTENSION_DIR, launchRaw, sleep } from '../test/e2e/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../webpage');
const VERSION = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8')).version;
const png = (buf) => 'data:image/png;base64,' + buf.toString('base64');

// ── 1. Captures ──────────────────────────────────────────────────────────────
async function captureExtension() {
    const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'fs-assets-')), {
        executablePath: findChrome(), headless: true, deviceScaleFactor: 2,
        args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
    });
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    const shots = {};

    async function popup(scheme, active, host) {
        const p = await ctx.newPage();
        await p.emulateMedia({ colorScheme: scheme });
        await p.addInitScript(([active, host]) => {
            chrome.tabs.query = async () => [{ id: 1, url: `https://${host}/` }];
            chrome.runtime.sendMessage = (m, cb) => {
                const r = { isSpoofing: active, isAlwaysOn: false };
                if (cb) setTimeout(() => cb(r), 0);
                return Promise.resolve(r);
            };
        }, [active, host]);
        await p.setViewportSize({ width: 300, height: 230 });
        await p.goto(`chrome-extension://${id}/popup.html`);
        await p.waitForTimeout(400);
        const buf = await p.screenshot();
        await p.close();
        return buf;
    }
    shots.popupOn = await popup('light', true, 'www.youtube.com');
    shots.popupOff = await popup('light', false, 'www.youtube.com');
    shots.popupDarkOn = await popup('dark', true, 'canvas.instructure.com');

    const s = await ctx.newPage();
    await s.setViewportSize({ width: 760, height: 720 });
    await s.goto(`chrome-extension://${id}/options.html`);
    await s.evaluate(() => chrome.storage.sync.set({ alwaysOnDomains: ['youtube.com', 'coursera.org', 'canvas.instructure.com'] }));
    await s.reload();
    await s.waitForTimeout(400);
    shots.settings = await s.screenshot();
    await ctx.close();
    return shots;
}

function serveWebsite() {
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };
    const srv = http.createServer((q, r) => {
        const f = path.join(WEB, decodeURIComponent(new URL(q.url, 'http://x').pathname));
        if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
        r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
        r.end(fs.readFileSync(f));
    });
    return new Promise(res => srv.listen(0, '127.0.0.1', () => res(srv)));
}

// The live test page after a real tab switch, unprotected and protected.
async function captureTestPage() {
    const srv = await serveWebsite();
    const url = `http://127.0.0.1:${srv.address().port}/test.html`;
    const b = await launchRaw();
    const shots = {};
    async function shoot(protect) {
        const t = await b.newTab(url + (protect ? '?p=1' : '?p=0'));
        await t.send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 700, deviceScaleFactor: 2, mobile: false });
        await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
        if (protect) await b.toggle(t);
        await b.activate(t);
        await sleep(600);
        await t.eval(`document.getElementById('clearLog').click(); 1`); // real 'Log cleared' entry; everything after it is genuine
        for (let i = 0; i < 2; i++) {
            const other = await b.newTab('about:blank');
            await b.activate(other);
            await sleep(900);
            await b.activate(t);
            await sleep(500);
        }
        // Frame the tiles + log region.
        const r = JSON.parse(await t.eval(`JSON.stringify((() => { const b = document.querySelector('.tiles').getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, w: b.width }; })())`));
        const { data } = await t.send('Page.captureScreenshot', {
            format: 'png', captureBeyondViewport: true,
            clip: { x: r.x - 20, y: r.y - 20, width: r.w + 40, height: 800, scale: 1 },
        });
        return Buffer.from(data, 'base64');
    }
    shots.testOff = await shoot(false);
    shots.testOn = await shoot(true);
    await b.close();
    srv.close();
    return shots;
}

// ── 2. Frames ────────────────────────────────────────────────────────────────
const FONTS = '<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=block" rel="stylesheet">';
const BASE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --paper:#f2eee6; --paper-2:#e9e4d9; --surface:#fbf9f4; --ink:#161411; --ink-2:#5c564c; --ink-3:#958d80;
          --line:rgba(22,20,17,.12); --line-strong:rgba(22,20,17,.22); --signal:#e2452b; --ok:#2f7d4f;
          --serif:"Instrument Serif",Georgia,serif; --sans:"Geist",-apple-system,sans-serif; --mono:"Geist Mono",ui-monospace,monospace; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body { background: var(--paper); color: var(--ink); font-family: var(--sans); -webkit-font-smoothing: antialiased; position: relative; }
  .serif { font-family: var(--serif); font-weight: 400; letter-spacing: -0.03em; }
  em { font-style: italic; color: var(--signal); }
  .eyebrow { font: 13px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); display: flex; align-items: center; gap: 10px; }
  .eyebrow::before { content: ""; width: 20px; height: 1px; background: currentColor; }
  .card { background: var(--surface); border: 1px solid var(--line-strong); border-radius: 18px; box-shadow: 0 40px 80px -40px rgba(0,0,0,.35); overflow: hidden; }
  .brand { position: absolute; display: flex; align-items: center; gap: 10px; font: 22px var(--serif); }
  .brand svg { width: 26px; height: 26px; }
  .mono { font-family: var(--mono); }
`;
const MARK = `<svg viewBox="0 0 32 32"><path d="M3 16C7 9.5 11.5 7 16 7s9 2.5 13 9c-4 6.5-8.5 9-13 9s-9-2.5-13-9z" fill="none" stroke="#161411" stroke-width="1.8" stroke-linejoin="round"/><circle cx="16" cy="16" r="5" fill="#e2452b"/><circle cx="16" cy="16" r="2.2" fill="#161411"/></svg>`;
const EYE = `<svg viewBox="0 0 400 400" style="width:100%;height:100%;overflow:visible">
  <circle cx="200" cy="200" r="188" fill="none" stroke="rgba(22,20,17,.22)" stroke-dasharray="2 7"/>
  <defs><clipPath id="c"><path d="M36 200C104 98 296 98 364 200C296 302 104 302 36 200Z"/></clipPath></defs>
  <path d="M36 200C104 98 296 98 364 200C296 302 104 302 36 200Z" fill="#fbf9f4" stroke="#161411" stroke-width="2.5"/>
  <g clip-path="url(#c)"><g transform="translate(-26 4)">
    <path d="M272 200C272 244 240 272 199 270C157 268 128 240 129 198C130 157 160 128 201 129C243 131 272 158 272 200Z" fill="#e2452b"/>
    <circle cx="200" cy="200" r="27" fill="#161411"/><circle cx="184" cy="184" r="8" fill="#fff" opacity=".85"/></g></g>
  <path d="M36 200C104 98 296 98 364 200" fill="none" stroke="#161411" stroke-width="2.5" stroke-linecap="round"/></svg>`;
const page = (body, css = '') => `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${BASE}${css}</style></head><body>${body}</body></html>`;

function frames(c) {
    return [
        {
            name: 'screenshot-1-protected.png', width: 1280, height: 800,
            html: page(`
              <div class="brand" style="left:72px;top:56px">${MARK}Focus Spoofer</div>
              <div style="position:absolute;left:72px;top:200px;width:600px">
                <div class="eyebrow">Chrome extension · v${VERSION}</div>
                <h1 class="serif" style="font-size:112px;line-height:.92;margin:26px 0 30px">Look away.<br><em>The tab won't.</em></h1>
                <p style="font-size:21px;line-height:1.5;color:var(--ink-2);max-width:30ch">Websites can't tell when you switch tabs, minimize, or use another window.</p>
              </div>
              <div style="position:absolute;right:80px;top:150px;width:460px;height:460px;opacity:.9">${EYE}</div>
              <img src="${png(c.popupOn)}" style="position:absolute;right:120px;top:450px;width:360px;border-radius:16px;box-shadow:0 40px 80px -30px rgba(0,0,0,.4)">
            `),
        },
        {
            name: 'screenshot-2-live-test.png', width: 1280, height: 800,
            html: page(`
              <div style="position:absolute;left:72px;top:56px;right:72px;display:flex;justify-content:space-between;align-items:flex-end">
                <h2 class="serif" style="font-size:64px;line-height:.95">Same tab switch.<br><em>Nothing to see.</em></h2>
                <p style="font-size:17px;color:var(--ink-2);max-width:34ch;text-align:right">Real captures of the live test page after switching tabs twice.</p>
              </div>
              <div style="position:absolute;left:72px;right:72px;top:236px;display:grid;grid-template-columns:1fr 1fr;gap:32px">
                <figure><div class="eyebrow" style="margin-bottom:14px">Without Focus Spoofer</div><div class="card"><img src="${png(c.testOff)}" style="width:100%;display:block"></div></figure>
                <figure><div class="eyebrow" style="margin-bottom:14px;color:var(--ok)">With Focus Spoofer</div><div class="card"><img src="${png(c.testOn)}" style="width:100%;display:block"></div></figure>
              </div>
            `),
        },
        {
            name: 'screenshot-3-signals.png', width: 1280, height: 800,
            html: page(`
              <div style="position:absolute;left:72px;top:64px">
                <div class="eyebrow">What a page can see</div>
                <h2 class="serif" style="font-size:72px;line-height:.95;margin-top:20px">Five ways a tab<br><em>tells on you.</em></h2>
              </div>
              <div style="position:absolute;left:72px;right:72px;top:320px;display:grid;grid-template-columns:repeat(5,1fr);gap:16px">
                ${[
                    ['01', 'The tab switch', 'document.hidden', 'always false'],
                    ['02', 'The other window', 'hasFocus()', 'always true'],
                    ['03', 'The stalled clock', 'requestAnimationFrame', 'keeps ticking'],
                    ['04', 'The exit', 'mouseleave', 'never fires'],
                    ['05', 'The fingerprint', 'canvas readback', 'new every load'],
                ].map(([n, t, api, res]) => `
                  <div class="card" style="padding:24px;height:380px;display:flex;flex-direction:column;box-shadow:none">
                    <div class="mono" style="font-size:12px;color:var(--ink-3)">${n}</div>
                    <div class="serif" style="font-size:36px;line-height:1;margin:18px 0 auto">${t}</div>
                    <div class="mono" style="font-size:13px;padding:7px 9px;border-radius:8px;background:var(--paper-2);width:fit-content">${api}</div>
                    <div class="mono" style="font-size:12px;color:var(--ok);margin-top:14px">→ ${res}</div>
                  </div>`).join('')}
              </div>
              <p style="position:absolute;left:72px;bottom:44px;font-size:16px;color:var(--ink-2)">Forms, menus and video controls inside the page keep working normally.</p>
            `),
        },
        {
            name: 'screenshot-4-settings.png', width: 1280, height: 800,
            html: page(`
              <div style="position:absolute;left:72px;top:200px;width:440px">
                <div class="eyebrow">Settings</div>
                <h2 class="serif" style="font-size:68px;line-height:.95;margin:20px 0 26px">Always on where<br><em>you need it.</em></h2>
                <ul style="list-style:none;display:grid;gap:14px;font-size:17px;color:var(--ink-2)">
                  <li>— Protect chosen sites on every visit</li>
                  <li>— Turn fingerprint noise off for drawing apps</li>
                  <li>— Usage stats stay off unless you opt in</li>
                </ul>
              </div>
              <div class="card" style="position:absolute;right:72px;top:64px;width:620px"><img src="${png(c.settings)}" style="width:100%;display:block"></div>
            `),
        },
        {
            name: 'small-promo-440x280.png', width: 440, height: 280,
            html: page(`
              <div style="position:absolute;left:28px;top:30px;width:100px;height:100px">${EYE}</div>
              <div class="serif" style="position:absolute;left:28px;bottom:58px;font-size:52px;line-height:.92">Look away.<br><em>The tab won't.</em></div>
              <div class="brand" style="position:absolute;right:26px;top:30px;font-size:19px">Focus Spoofer</div>
              <div class="mono" style="position:absolute;left:30px;bottom:26px;font-size:11px;color:var(--ink-3)">Stops tab-switch detection</div>
            `),
        },
        {
            name: 'marquee-1400x560.png', width: 1400, height: 560,
            html: page(`
              <div class="brand" style="left:96px;top:64px">${MARK}Focus Spoofer</div>
              <h1 class="serif" style="position:absolute;left:96px;top:150px;font-size:118px;line-height:.92">Look away.<br><em>The tab won't.</em></h1>
              <p style="position:absolute;left:100px;bottom:70px;font-size:20px;color:var(--ink-2)">Websites can't tell when you switch tabs or minimize.</p>
              <div style="position:absolute;right:120px;top:40px;width:480px;height:480px;opacity:.9">${EYE}</div>
              <img src="${png(c.popupOn)}" style="position:absolute;right:150px;top:300px;width:340px;border-radius:16px;box-shadow:0 40px 80px -30px rgba(0,0,0,.4)">
            `),
        },
        {
            // Open Graph / Twitter card for the website (served from webpage/assets).
            name: '../webpage/assets/og.png', width: 1200, height: 630,
            html: page(`
              <div class="brand" style="left:80px;top:64px">${MARK}Focus Spoofer</div>
              <h1 class="serif" style="position:absolute;left:80px;top:170px;font-size:104px;line-height:.92">Look away.<br><em>The tab won't.</em></h1>
              <p style="position:absolute;left:84px;bottom:76px;font-size:24px;color:var(--ink-2);max-width:26ch;line-height:1.35">Free Chrome extension that stops websites from detecting tab switches.</p>
              <div style="position:absolute;right:70px;top:90px;width:430px;height:430px;opacity:.9">${EYE}</div>
              <img src="${png(c.popupOn)}" style="position:absolute;right:96px;top:330px;width:330px;border-radius:16px;box-shadow:0 40px 80px -30px rgba(0,0,0,.4)">
            `),
        },
    ];
}

async function render(list) {
    const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
    for (const f of list) {
        const p = await browser.newPage({ viewport: { width: f.width, height: f.height }, deviceScaleFactor: 1 });
        await p.setContent(f.html, { waitUntil: 'networkidle' });
        await p.evaluate(() => document.fonts.ready);
        await p.screenshot({ path: path.join(here, f.name), type: 'png' });
        await p.close();
        console.log(`✓ ${path.basename(f.name)} (${f.width}×${f.height})`);
    }
    await browser.close();
}

const captures = { ...(await captureExtension()), ...(await captureTestPage()) };
await render(frames(captures));
