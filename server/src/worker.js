// Focus Spoofer feedback & usage backend (Cloudflare Worker + D1).
//
// Routes
//   GET  /uninstall               survey page (static asset, public/uninstall.html)
//   POST /api/uninstall-feedback  store one anonymous survey response
//   POST /api/report              fold one opt-in daily usage report into aggregates
//   GET  /api/stats               aggregated numbers for the dashboard (Bearer DASHBOARD_TOKEN)
//   GET  /dashboard               dashboard page (static asset; asks for the token)
//   GET  /opensource              logs the visit, then 302s to the GitHub repo
//
// Public address: https://focus.oddworks.us fronts these routes through the
// site-proxy Worker (site-proxy/). It forwards the visitor's IP in
// x-client-ip, authenticated by the shared PROXY_SECRET, and its origin is
// listed in PUBLIC_ORIGINS so the survey page there may post here.
//
// Privacy: the client address is only used as an ephemeral rate-limit key and
// is never written to D1 or logged. Usage reports are never stored
// individually — each one is added into per-day/per-week counters.
// Exception: /opensource is a tracked short link on the website (not the
// extension) and does store the visitor's IP, location, browser and referrer,
// kept for CLICK_RETENTION_DAYS (disclosed in webpage/privacy.html).

export const REASONS = [
    'didnt_work',        // Didn't work on a website
    'broke_sites',       // Caused issues with other websites
    'temporary',         // Only needed it temporarily
    'not_using',         // Wasn't using it anymore
    'privacy',           // Privacy/security concerns
    'other',
];

// Must match ERROR_CATEGORIES in extension/telemetry.js.
export const ERROR_CATEGORIES = [
    'register_session_script',
    'register_always_on',
    'always_on_bad_pattern',
    'inject_flag',
    'state_storage',
    'sync_storage',
    'report_send',
    'unknown',
];

const MAX_BODY = 4096;
const MAX_DETAILS = 1000;
const MAX_SITE = 200;
const MIN_OTHER_DETAILS = 3; // "Other" must say something
export const SITE_REASONS = ['didnt_work', 'broke_sites'];
const MAX_COUNTER = 10000;
const MIN_FILL_MS = 1500; // humans take longer than this to pick a reason
const VERSION_RE = /^\d{1,4}(\.\d{1,5}){0,3}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_RE = /^\d{4}-W\d{2}$/;

export function utcDay(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function cleanVersion(v) {
    return typeof v === 'string' && VERSION_RE.test(v) ? v : 'unknown';
}

// Strip control characters (keep newlines/tabs) and clamp length.
export function cleanText(s, max = MAX_DETAILS) {
    if (typeof s !== 'string') return null;
    const t = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    return t ? t.slice(0, max) : null;
}

// The site a user typed in ("which website?"). Keep it to a host when it
// parses as one, so a pasted URL doesn't carry its path or query along.
export function cleanSite(s) {
    const t = cleanText(s, MAX_SITE);
    if (!t) return null;
    const one = t.split(/\s+/)[0];
    try {
        const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(one) ? one : 'https://' + one);
        if (u.hostname.includes('.')) return u.hostname.toLowerCase().replace(/^www\./, '');
    } catch (e) { }
    return t;
}

// Returns { ok: true, row } or { ok: false, status, error }. `silent` means
// "pretend success" (honeypot/too-fast) so bots get no signal.
export function validateFeedback(body) {
    if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'bad_body' };
    if (body.website) return { ok: false, silent: true, error: 'honeypot' };
    const elapsed = Number(body.t);
    if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) return { ok: false, silent: true, error: 'too_fast' };
    if (!REASONS.includes(body.reason)) return { ok: false, status: 400, error: 'bad_reason' };
    const details = cleanText(body.details);
    if (body.reason === 'other' && (!details || details.length < MIN_OTHER_DETAILS)) {
        return { ok: false, status: 400, error: 'details_required' };
    }
    return {
        ok: true,
        row: {
            reason: body.reason,
            site: SITE_REASONS.includes(body.reason) ? cleanSite(body.site) : null,
            details,
            version: cleanVersion(body.v),
        },
    };
}

function counter(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) return 0;
    return Math.min(n, MAX_COUNTER);
}

// A report covers exactly one past UTC day within the last week.
export function validateReport(body, now = new Date()) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'bad_body' };
    if (body.schema !== 1) return { ok: false, error: 'bad_schema' };
    if (typeof body.day !== 'string' || !DAY_RE.test(body.day)) return { ok: false, error: 'bad_day' };
    const dayMs = Date.parse(body.day + 'T00:00:00Z');
    const todayMs = Date.parse(utcDay(now) + 'T00:00:00Z');
    if (!Number.isFinite(dayMs) || dayMs > todayMs || todayMs - dayMs > 8 * 86400000) {
        return { ok: false, error: 'day_out_of_range' };
    }
    if (body.week !== undefined && (typeof body.week !== 'string' || !WEEK_RE.test(body.week))) {
        return { ok: false, error: 'bad_week' };
    }
    const c = body.counts || {};
    const errors = [];
    if (body.errors && typeof body.errors === 'object') {
        for (const [cat, n] of Object.entries(body.errors)) {
            const k = ERROR_CATEGORIES.includes(cat) ? cat : 'unknown';
            const v = counter(n);
            if (v) errors.push([k, v]);
        }
    }
    const activations = counter(c.activations);
    return {
        ok: true,
        report: {
            day: body.day,
            week: body.week || null,
            version: cleanVersion(body.v),
            activations,
            deactivations: counter(c.deactivations),
            always_on_added: counter(c.alwaysOnAdded),
            always_on_removed: counter(c.alwaysOnRemoved),
            first_activation: body.firstActivation === true ? 1 : 0,
            uses_always_on: body.usesAlwaysOn === true ? 1 : 0,
            active: activations > 0 ? 1 : 0,
            errors: errors.slice(0, ERROR_CATEGORIES.length),
        },
    };
}

async function readBody(request) {
    const len = Number(request.headers.get('content-length') || 0);
    if (len > MAX_BODY) return null;
    const text = await request.text();
    if (text.length > MAX_BODY) return null;
    const type = request.headers.get('content-type') || '';
    try {
        if (type.includes('application/json')) return JSON.parse(text);
        if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
    } catch (e) { }
    return null;
}

function fromProxy(request, env) {
    return !!env.PROXY_SECRET && timingSafeEqual(request.headers.get('x-proxy-auth') || '', env.PROXY_SECRET);
}

export function clientKey(request, env = {}) {
    if (fromProxy(request, env)) return request.headers.get('x-client-ip') || 'unknown';
    return request.headers.get('cf-connecting-ip') || 'unknown';
}

async function limited(limiter, request, env) {
    if (!limiter) return false;
    const key = clientKey(request, env);
    try {
        const { success } = await limiter.limit({ key });
        return !success;
    } catch (e) {
        return false; // fail open: the limiter is a cost guard, not a security boundary
    }
}

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
});

// Survey posts come from our own page. Reports come from the extension's
// service worker, which has host permission for this origin and so needs no
// CORS; browsers stamp it with Origin: chrome-extension://<id>, which page
// scripts cannot forge, so websites can't inject fake reports. (Non-browser
// clients can still send anything — there is deliberately no identity to
// check — so treat the numbers as indicative, bounded by validation and rate
// limits.) Set EXTENSION_ORIGINS="chrome-extension://<id>,..." to pin IDs.
export function sameOrigin(request, env = {}) {
    const origin = request.headers.get('origin');
    if (!origin || origin === new URL(request.url).origin) return true;
    return (env.PUBLIC_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean).includes(origin);
}

export function extensionOrigin(request, env = {}) {
    const origin = request.headers.get('origin') || '';
    if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return false;
    const allowed = (env.EXTENSION_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    return allowed.length === 0 || allowed.includes(origin);
}

export async function handleFeedback(request, env) {
    if (!sameOrigin(request, env)) return json({ ok: false, error: 'origin' }, 403);
    if (await limited(env.SURVEY_LIMITER, request, env)) return json({ ok: false, error: 'rate_limited' }, 429);
    const body = await readBody(request);
    const v = validateFeedback(body);
    if (!v.ok) return v.silent ? json({ ok: true }) : json({ ok: false, error: v.error }, v.status || 400);
    await env.DB.prepare('INSERT INTO uninstall_feedback (day, reason, site, details, version) VALUES (?, ?, ?, ?, ?)')
        .bind(utcDay(), v.row.reason, v.row.site, v.row.details, v.row.version).run();
    return json({ ok: true });
}

export async function handleReport(request, env) {
    if (!extensionOrigin(request, env)) return json({ ok: false, error: 'origin' }, 403);
    if (await limited(env.REPORT_LIMITER, request, env)) return json({ ok: false, error: 'rate_limited' }, 429);
    const body = await readBody(request);
    const v = validateReport(body);
    if (!v.ok) return json({ ok: false, error: v.error }, 400);
    const r = v.report;
    const stmts = [
        env.DB.prepare(
            `INSERT INTO usage_daily (day, version, reports, active_reports, activations, deactivations,
                always_on_added, always_on_removed, first_activations, always_on_reports)
             VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(day, version) DO UPDATE SET
                reports = reports + 1,
                active_reports = active_reports + ?3,
                activations = activations + ?4,
                deactivations = deactivations + ?5,
                always_on_added = always_on_added + ?6,
                always_on_removed = always_on_removed + ?7,
                first_activations = first_activations + ?8,
                always_on_reports = always_on_reports + ?9`
        ).bind(r.day, r.version, r.active, r.activations, r.deactivations, r.always_on_added, r.always_on_removed,
            r.first_activation, r.uses_always_on),
    ];
    if (r.week) {
        stmts.push(env.DB.prepare(
            `INSERT INTO usage_weekly (week, version, reports, active_reports) VALUES (?1, ?2, 1, ?3)
             ON CONFLICT(week, version) DO UPDATE SET reports = reports + 1, active_reports = active_reports + ?3`
        ).bind(r.week, r.version, r.active));
    }
    for (const [category, count] of r.errors) {
        stmts.push(env.DB.prepare(
            `INSERT INTO errors_daily (day, version, category, count) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(day, version, category) DO UPDATE SET count = count + ?4`
        ).bind(r.day, r.version, category, count));
    }
    await env.DB.batch(stmts);
    return json({ ok: true });
}

// --- /opensource tracked short link -------------------------------------

export const OPENSOURCE_URL = 'https://github.com/Abhinav-ranish/Focus-Spoofer/';
const CLICK_RETENTION_DAYS = 180;
const MAX_UA = 400;
const MAX_REFERER = 500;
const GEO_FIELDS = ['country', 'region', 'city', 'timezone', 'asn', 'asOrganization', 'colo'];

// Referrer hosts (and in-app browser UA markers) mapped to a short source name.
const SOURCES = [
    [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'],
    [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'x'],
    [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, 'facebook'],
    [/(^|\.)instagram\.com$/, 'instagram'],
    [/(^|\.)(reddit\.com|redd\.it)$/, 'reddit'],
    [/(^|\.)news\.ycombinator\.com$/, 'hackernews'],
    [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
    [/(^|\.)github\.com$/, 'github'],
    [/(^|\.)google\.[a-z.]+$/, 'google'],
    [/(^|\.)bing\.com$/, 'bing'],
    [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
    [/(^|\.)(chromewebstore\.google\.com|chrome\.google\.com)$/, 'chrome-web-store'],
];
const IN_APP = [
    [/LinkedInApp/i, 'linkedin'], [/FBAN|FBAV|FB_IAB/, 'facebook'], [/Instagram/, 'instagram'],
    [/Twitter/i, 'x'], [/Snapchat/i, 'snapchat'], [/Discord/i, 'discord'], [/Slack/i, 'slack'],
];
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|whatsapp|telegram|discord|slack|lighthouse|headless|curl|wget|python-requests|go-http-client/i;

// Browser, OS and device class from a User-Agent. Order matters: Edge, Opera,
// Samsung and in-app browsers all also claim to be Chrome/Safari.
export function parseUA(ua = '') {
    const bot = BOT_UA.test(ua) && !/LinkedInApp/.test(ua);
    const pick = (pairs) => { for (const [re, name] of pairs) { const m = ua.match(re); const v = m && (m[1] || m[2]); if (m) return v ? name + ' ' + v.split(/[._]/)[0] : name; } return 'other'; };
    const browser = bot ? (ua.match(/([A-Za-z-]*bot|facebookexternalhit|curl|wget)/i) || ['', 'bot'])[1] : pick([
        [/LinkedInApp/, 'LinkedIn app'], [/FBAN|FBAV/, 'Facebook app'], [/Instagram/, 'Instagram app'],
        [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'], [/OPR\/([\d.]+)/, 'Opera'], [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
        [/Brave\/([\d.]+)/, 'Brave'], [/Vivaldi\/([\d.]+)/, 'Vivaldi'], [/Firefox\/([\d.]+)|FxiOS\/([\d.]+)/, 'Firefox'],
        [/CriOS\/([\d.]+)/, 'Chrome'], [/Chrome\/([\d.]+)/, 'Chrome'], [/Version\/([\d.]+).*Safari/, 'Safari'],
    ]);
    const os = pick([
        [/Windows NT 10/, 'Windows 10/11'], [/Windows/, 'Windows'], [/iPhone OS ([\d_]+)/, 'iOS'], [/iPad.*OS ([\d_]+)/, 'iPadOS'],
        [/Mac OS X/, 'macOS'], [/Android ([\d.]+)/, 'Android'], [/CrOS/, 'ChromeOS'], [/Linux/, 'Linux'],
    ]);
    const device = bot ? 'bot' : /iPad|Tablet|(Android(?!.*Mobile))/.test(ua) ? 'tablet' : /Mobi|iPhone|Android/.test(ua) ? 'mobile' : 'desktop';
    return { browser, os, device, bot };
}

// Where the visit came from: an explicit ?ref= / ?utm_source= tag wins, then
// the Referer host, then an in-app browser marker; nothing at all is "direct"
// (typed in, bookmarked, or an app that strips the referrer).
export function classifySource(referer, ua = '', tag = '') {
    const t = cleanText(tag, 40);
    if (t) return t.toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (referer) {
        try {
            const host = new URL(referer).hostname.toLowerCase().replace(/^www\./, '');
            for (const [re, name] of SOURCES) if (re.test(host)) return name;
            if (host) return host;
        } catch (e) { }
    }
    for (const [re, name] of IN_APP) if (re.test(ua)) return name;
    return 'direct';
}

// Visitor IP and Cloudflare geo data. Via site-proxy they arrive in headers
// (this Worker's own request.cf would describe the proxy, not the visitor).
export function visitorInfo(request, env = {}) {
    if (fromProxy(request, env)) {
        let geo = {};
        try { geo = JSON.parse(decodeURIComponent(request.headers.get('x-client-geo') || '')) || {}; } catch (e) { }
        return { ip: request.headers.get('x-client-ip') || null, geo };
    }
    return { ip: request.headers.get('cf-connecting-ip') || null, geo: request.cf || {} };
}

export async function handleOpensource(request, env, ctx) {
    const target = env.OPENSOURCE_URL || OPENSOURCE_URL;
    const redirect = new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer-when-downgrade' } });
    if (request.method !== 'GET' || !env.DB) return redirect;
    if (await limited(env.CLICK_LIMITER, request, env)) return redirect;

    const url = new URL(request.url);
    const ua = cleanText(request.headers.get('user-agent') || '', MAX_UA) || '';
    const referer = cleanText(request.headers.get('referer') || '', MAX_REFERER);
    const tag = url.searchParams.get('ref') || url.searchParams.get('utm_source') || '';
    const { ip, geo } = visitorInfo(request, env);
    const g = Object.fromEntries(GEO_FIELDS.map(k => [k, geo[k] === undefined || geo[k] === null ? null : cleanText(String(geo[k]), 100)]));
    const { browser, os, device, bot } = parseUA(ua);
    const now = new Date();

    const write = env.DB.batch([
        env.DB.prepare(
            `INSERT INTO link_clicks (ts, day, link, ip, country, region, city, timezone, asn, as_org, colo,
                browser, os, device, user_agent, referer, source, is_bot)
             VALUES (?, ?, 'opensource', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(now.toISOString(), utcDay(now), ip, g.country, g.region, g.city, g.timezone, g.asn, g.asOrganization, g.colo,
            browser, os, device, ua, referer, classifySource(referer, ua, tag), bot ? 1 : 0),
        env.DB.prepare(`DELETE FROM link_clicks WHERE day < date('now', '-${CLICK_RETENTION_DAYS} days')`),
    ]).catch(() => { }); // never let logging break the redirect
    if (ctx && ctx.waitUntil) ctx.waitUntil(write); else await write;
    return redirect;
}

function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export async function handleStats(request, env) {
    const auth = request.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!env.DASHBOARD_TOKEN || !timingSafeEqual(token, env.DASHBOARD_TOKEN)) {
        return json({ ok: false, error: 'unauthorized' }, 401);
    }
    const q = (sql) => env.DB.prepare(sql).all().then(r => r.results);
    const [daily, weekly, versions, errors, reasons, comments, clickSources, clickPlaces, clicks] = await Promise.all([
        q(`SELECT day, SUM(reports) AS reports, SUM(active_reports) AS active_reports,
                  SUM(activations) AS activations, SUM(deactivations) AS deactivations,
                  SUM(always_on_added) AS always_on_added, SUM(always_on_removed) AS always_on_removed,
                  SUM(first_activations) AS first_activations, SUM(always_on_reports) AS always_on_reports
           FROM usage_daily WHERE day >= date('now', '-60 days') GROUP BY day ORDER BY day`),
        q(`SELECT week, SUM(reports) AS reports, SUM(active_reports) AS active_reports
           FROM usage_weekly GROUP BY week ORDER BY week DESC LIMIT 12`),
        q(`SELECT version, SUM(reports) AS reports FROM usage_daily
           WHERE day >= date('now', '-7 days') GROUP BY version ORDER BY reports DESC`),
        q(`SELECT category, version, SUM(count) AS count FROM errors_daily
           WHERE day >= date('now', '-30 days') GROUP BY category, version ORDER BY count DESC`),
        q(`SELECT reason, COUNT(*) AS n FROM uninstall_feedback
           WHERE day >= date('now', '-90 days') GROUP BY reason ORDER BY n DESC, reason`),
        q(`SELECT day, reason, version, site, details FROM uninstall_feedback
           WHERE details IS NOT NULL OR site IS NOT NULL ORDER BY id DESC LIMIT 50`),
        q(`SELECT source, COUNT(*) AS n, COUNT(DISTINCT ip) AS visitors FROM link_clicks
           WHERE is_bot = 0 AND day >= date('now', '-90 days') GROUP BY source ORDER BY n DESC, source`),
        q(`SELECT country, region, city, COUNT(*) AS n FROM link_clicks
           WHERE is_bot = 0 AND day >= date('now', '-90 days') GROUP BY country, region, city ORDER BY n DESC LIMIT 50`),
        q(`SELECT ts, ip, country, region, city, as_org, browser, os, device, source, referer, is_bot, user_agent
           FROM link_clicks ORDER BY id DESC LIMIT 200`),
    ]);
    return json({ ok: true, daily, weekly, versions, errors, reasons, comments, clickSources, clickPlaces, clicks });
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        try {
            if (url.pathname === '/opensource' || url.pathname === '/opensource/') {
                return await handleOpensource(request, env, ctx);
            } else if (url.pathname === '/api/report' && request.method === 'POST') {
                return await handleReport(request, env);
            } else if (url.pathname === '/api/uninstall-feedback' && request.method === 'POST') {
                return await handleFeedback(request, env);
            } else if (url.pathname === '/api/stats' && request.method === 'GET') {
                return await handleStats(request, env);
            } else if (url.pathname === '/' || url.pathname === '/uninstall' || url.pathname === '/dashboard') {
                // Static assets normally answer these before the Worker runs
                // (html_handling serves /uninstall from uninstall.html); this
                // covers `/` and any setup where assets aren't matched first.
                const page = url.pathname === '/dashboard' ? '/dashboard' : '/uninstall';
                return env.ASSETS.fetch(new Request(new URL(page + url.search, url), request));
            }
        } catch (e) {
            return json({ ok: false, error: 'server_error' }, 500);
        }
        return new Response('Not found', { status: 404 });
    },
};
