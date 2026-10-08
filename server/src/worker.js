// Focus Spoofer feedback & usage backend (Cloudflare Worker + D1).
//
// Routes
//   GET  /uninstall               survey page (static asset, public/uninstall.html)
//   POST /api/uninstall-feedback  store one anonymous survey response
//   POST /api/report              fold one opt-in daily usage report into aggregates
//   GET  /api/stats               aggregated numbers for the dashboard (Bearer DASHBOARD_TOKEN)
//   GET  /dashboard               dashboard page (static asset; asks for the token)
//
// Privacy: the client address is only used as an ephemeral rate-limit key and
// is never written to D1 or logged. Usage reports are never stored
// individually — each one is added into per-day/per-week counters.

export const REASONS = [
    'didnt_work',        // Didn't work on my website
    'temporary',         // Only needed it temporarily
    'not_using',         // Wasn't using it anymore
    'broke_sites',       // Caused issues with other websites
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
export function cleanText(s) {
    if (typeof s !== 'string') return null;
    const t = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    return t ? t.slice(0, MAX_DETAILS) : null;
}

// Returns { ok: true, row } or { ok: false, status, error }. `silent` means
// "pretend success" (honeypot/too-fast) so bots get no signal.
export function validateFeedback(body) {
    if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'bad_body' };
    if (body.website) return { ok: false, silent: true, error: 'honeypot' };
    const elapsed = Number(body.t);
    if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) return { ok: false, silent: true, error: 'too_fast' };
    if (!REASONS.includes(body.reason)) return { ok: false, status: 400, error: 'bad_reason' };
    return {
        ok: true,
        row: { reason: body.reason, details: cleanText(body.details), version: cleanVersion(body.v) },
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

async function limited(limiter, request) {
    if (!limiter) return false;
    const key = request.headers.get('cf-connecting-ip') || 'unknown';
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

// Reports come from the extension service worker (chrome-extension:// origin,
// or no Origin at all); survey posts come from our own page.
const REPORT_CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
};

function sameOrigin(request) {
    const origin = request.headers.get('origin');
    return !origin || origin === new URL(request.url).origin;
}

export async function handleFeedback(request, env) {
    if (!sameOrigin(request)) return json({ ok: false, error: 'origin' }, 403);
    if (await limited(env.SURVEY_LIMITER, request)) return json({ ok: false, error: 'rate_limited' }, 429);
    const body = await readBody(request);
    const v = validateFeedback(body);
    if (!v.ok) return v.silent ? json({ ok: true }) : json({ ok: false, error: v.error }, v.status || 400);
    await env.DB.prepare('INSERT INTO uninstall_feedback (day, reason, details, version) VALUES (?, ?, ?, ?)')
        .bind(utcDay(), v.row.reason, v.row.details, v.row.version).run();
    return json({ ok: true });
}

export async function handleReport(request, env) {
    if (await limited(env.REPORT_LIMITER, request)) return json({ ok: false, error: 'rate_limited' }, 429, REPORT_CORS);
    const body = await readBody(request);
    const v = validateReport(body);
    if (!v.ok) return json({ ok: false, error: v.error }, 400, REPORT_CORS);
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
    return json({ ok: true }, 200, REPORT_CORS);
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
    const [daily, weekly, versions, errors, reasons, comments] = await Promise.all([
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
           WHERE day >= date('now', '-90 days') GROUP BY reason ORDER BY n DESC`),
        q(`SELECT day, reason, version, details FROM uninstall_feedback
           WHERE details IS NOT NULL ORDER BY id DESC LIMIT 50`),
    ]);
    return json({ ok: true, daily, weekly, versions, errors, reasons, comments });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        try {
            if (url.pathname === '/api/report') {
                if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: REPORT_CORS });
                if (request.method === 'POST') return await handleReport(request, env);
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
