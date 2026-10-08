// telemetry.js — opt-in, aggregate-only usage statistics.
//
// Off by default. While off, nothing is counted, stored, or sent. When the
// user opts in (Settings → Anonymous usage statistics) the service worker keeps
// a handful of per-day counters in chrome.storage.local and, at most once per
// UTC day, sends each finished day as one small report:
//
//   { schema, v, day, week?, counts: { activations, deactivations,
//     alwaysOnAdded, alwaysOnRemoved }, usesAlwaysOn, firstActivation, errors }
//
// usesAlwaysOn is "has at least one Always-On site" (never which ones);
// errors is { category: count } over a fixed list of categories (never messages).
//
// There is no install ID, no URL/domain/title, and no per-event stream. The
// server adds each report into daily/weekly totals and discards it. `week` is
// only present on an install's first report of each ISO week, so the server can
// count weekly reporting installs without being able to link reports.
(function (root) {
    'use strict';

    var COUNTERS = ['activations', 'deactivations', 'alwaysOnAdded', 'alwaysOnRemoved'];
    // Must match ERROR_CATEGORIES in server/src/worker.js.
    var ERROR_CATEGORIES = [
        'register_session_script',
        'register_always_on',
        'always_on_bad_pattern',
        'inject_flag',
        'state_storage',
        'sync_storage',
        'report_send',
        'unknown'
    ];
    var KEY = 'telemetry';
    var ENABLED_KEY = 'analyticsEnabled';
    var EVER_ACTIVATED_KEY = 'everActivated';
    var MAX_AGE_DAYS = 7;
    var FLUSH_INTERVAL_MS = 60 * 60 * 1000;

    function utcDay(ms) {
        return new Date(ms).toISOString().slice(0, 10);
    }

    // ISO-8601 week, e.g. "2026-W41".
    function isoWeek(day) {
        var d = new Date(day + 'T00:00:00Z');
        var dow = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dow);
        var yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
        var week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
        return d.getUTCFullYear() + '-W' + (week < 10 ? '0' : '') + week;
    }

    function emptyDay() {
        return { counts: {}, errors: {}, firstActivation: false };
    }

    // deps: { storage (chrome.storage.local-like, promise API), fetch, now(),
    //         endpoint (origin or ''), version, alwaysOnCount() }
    function createTelemetry(deps) {
        var queue = Promise.resolve();
        var lastFlushAttempt = 0;

        function serial(fn) {
            var run = queue.then(fn, fn);
            queue = run.catch(function () { });
            return run;
        }

        function today() { return utcDay(deps.now()); }

        async function isEnabled() {
            var r = await deps.storage.get([ENABLED_KEY]);
            return r[ENABLED_KEY] === true;
        }

        async function load() {
            var r = await deps.storage.get([KEY]);
            var t = r[KEY];
            if (!t || typeof t !== 'object') t = {};
            if (!t.days || typeof t.days !== 'object') t.days = {};
            return t;
        }

        function bucket(t, day) {
            if (!t.days[day]) t.days[day] = emptyDay();
            return t.days[day];
        }

        // Apply `fn(dayBucket, t)` to today's bucket — only when enabled.
        function update(fn) {
            return serial(async function () {
                if (!(await isEnabled())) return;
                var t = await load();
                fn(bucket(t, today()), t);
                var o = {}; o[KEY] = t;
                await deps.storage.set(o);
            });
        }

        function count(name, n) {
            if (COUNTERS.indexOf(name) === -1) return Promise.resolve();
            return update(function (b) {
                b.counts[name] = (b.counts[name] || 0) + (n === undefined ? 1 : n);
            });
        }

        function error(category) {
            var c = ERROR_CATEGORIES.indexOf(category) === -1 ? 'unknown' : category;
            return update(function (b) {
                b.errors[c] = Math.min((b.errors[c] || 0) + 1, 10000);
            });
        }

        // Marks today as a day the extension was running (presence).
        function touch() {
            return update(function () { });
        }

        // Counts an activation and flags the install's first-ever one. The
        // "ever activated" bit is kept locally even while stats are off (it is
        // never sent unless the user opts in) so opting in later can't produce
        // a false "first activation".
        function activation() {
            return serial(async function () {
                var r = await deps.storage.get([EVER_ACTIVATED_KEY]);
                var first = !r[EVER_ACTIVATED_KEY];
                if (first) {
                    var o = {}; o[EVER_ACTIVATED_KEY] = true;
                    await deps.storage.set(o);
                }
                return first;
            }).then(function (first) {
                return update(function (b) {
                    b.counts.activations = (b.counts.activations || 0) + 1;
                    if (first) b.firstActivation = true;
                });
            });
        }

        // Existing installs updating to this version have already activated
        // at some point; don't let their next activation count as "first".
        function markExistingInstall() {
            var o = {}; o[EVER_ACTIVATED_KEY] = true;
            return serial(function () { return deps.storage.set(o); });
        }

        function buildReport(day, b, t, usesAlwaysOn) {
            var report = {
                schema: 1,
                v: deps.version,
                day: day,
                counts: {},
                usesAlwaysOn: !!usesAlwaysOn,
                firstActivation: !!b.firstActivation,
                errors: {}
            };
            COUNTERS.forEach(function (k) { report.counts[k] = b.counts[k] || 0; });
            Object.keys(b.errors || {}).forEach(function (k) { report.errors[k] = b.errors[k]; });
            var week = isoWeek(day);
            if (t.lastWeekReported !== week) report.week = week;
            return report;
        }

        // Reports that would be sent next, oldest first (for the settings page).
        async function pending() {
            if (!(await isEnabled())) return [];
            var t = await load();
            var td = today();
            var days = Object.keys(t.days).filter(function (d) { return d < td; }).sort();
            var lastWeek = t.lastWeekReported;
            var ao = deps.alwaysOnCount ? (await deps.alwaysOnCount()) > 0 : false;
            return days.map(function (d) {
                var r = buildReport(d, t.days[d], { lastWeekReported: lastWeek }, ao);
                if (r.week) lastWeek = r.week;
                return r;
            });
        }

        // Send finished days. Throttled; safe to call on every wake-up.
        function flush(force) {
            var nowMs = deps.now();
            if (!force && nowMs - lastFlushAttempt < FLUSH_INTERVAL_MS) return Promise.resolve(0);
            lastFlushAttempt = nowMs;
            return serial(async function () {
                if (!deps.endpoint || !(await isEnabled())) return 0;
                var t = await load();
                var td = today();
                var cutoff = utcDay(nowMs - MAX_AGE_DAYS * 86400000);
                var sent = 0;
                var ao = deps.alwaysOnCount ? (await deps.alwaysOnCount()) > 0 : false;
                var days = Object.keys(t.days).sort();
                for (var i = 0; i < days.length; i++) {
                    var day = days[i];
                    if (day < cutoff) { delete t.days[day]; continue; }
                    if (day >= td) continue;
                    var report = buildReport(day, t.days[day], t, ao);
                    var ok = false;
                    try {
                        var res = await deps.fetch(deps.endpoint + '/api/report', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify(report),
                            credentials: 'omit',
                            cache: 'no-store',
                            referrerPolicy: 'no-referrer'
                        });
                        // 4xx means the server rejected this report for good.
                        ok = res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429);
                    } catch (e) { ok = false; }
                    if (!ok) {
                        var b = bucket(t, td);
                        b.errors.report_send = Math.min((b.errors.report_send || 0) + 1, 10000);
                        break; // retry on a later wake-up
                    }
                    if (report.week) t.lastWeekReported = report.week;
                    delete t.days[day];
                    sent++;
                }
                var o = {}; o[KEY] = t;
                await deps.storage.set(o);
                return sent;
            });
        }

        // Turning stats off deletes everything not yet sent.
        function setEnabled(on) {
            return serial(async function () {
                var o = {}; o[ENABLED_KEY] = !!on;
                await deps.storage.set(o);
                if (!on) await deps.storage.remove(KEY);
            });
        }

        return {
            count: count,
            error: error,
            touch: touch,
            activation: activation,
            markExistingInstall: markExistingInstall,
            flush: flush,
            pending: pending,
            setEnabled: setEnabled,
            isEnabled: isEnabled
        };
    }

    var api = {
        createTelemetry: createTelemetry,
        isoWeek: isoWeek,
        utcDay: utcDay,
        COUNTERS: COUNTERS,
        ERROR_CATEGORIES: ERROR_CATEGORIES,
        ENABLED_KEY: ENABLED_KEY
    };
    root.FocusTelemetry = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
