// Runs the Worker against real SQLite (node:sqlite) through a minimal D1
// adapter, so schema.sql, the upserts and the dashboard queries are executed
// for real rather than against a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../../server/src/worker.js';

function d1() {
    const db = new DatabaseSync(':memory:');
    db.exec(fs.readFileSync(new URL('../../server/schema.sql', import.meta.url), 'utf8'));
    const wrap = (sql) => ({
        sql, args: [],
        bind(...a) { this.args = a; return this; },
        async run() { db.prepare(sql).run(...this.args); return { success: true }; },
        async all() { return { results: db.prepare(sql).all(...this.args).map(r => ({ ...r })) }; },
    });
    return {
        raw: db,
        prepare: wrap,
        async batch(stmts) {
            db.exec('BEGIN');
            try { for (const s of stmts) db.prepare(s.sql).run(...s.args); db.exec('COMMIT'); }
            catch (e) { db.exec('ROLLBACK'); throw e; }
            return [];
        },
    };
}

const post = (path, body) => new Request('https://fb.example' + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test('reports aggregate correctly in SQLite and the dashboard queries run', async () => {
    const DB = d1();
    const env = { DB, DASHBOARD_TOKEN: 'tok' };
    const reports = [
        { schema: 1, v: '1.8', day: day(1), week: '2026-W41', counts: { activations: 2, deactivations: 1 }, usesAlwaysOn: true, firstActivation: true, errors: { inject_flag: 2 } },
        { schema: 1, v: '1.8', day: day(1), counts: { activations: 0 }, errors: { inject_flag: 1, register_always_on: 1 } },
        { schema: 1, v: '1.7', day: day(1), week: '2026-W41', counts: { activations: 5, alwaysOnAdded: 1 } },
        { schema: 1, v: '1.8', day: day(2), counts: { activations: 1 } },
    ];
    for (const r of reports) assert.equal((await worker.fetch(post('/api/report', r), env)).status, 200);
    for (const reason of ['didnt_work', 'didnt_work', 'temporary']) {
        await worker.fetch(post('/api/uninstall-feedback', { reason, details: reason === 'temporary' ? 'done with course' : '', t: 3000, v: '1.8' }), env);
    }

    const rows = DB.raw.prepare('SELECT * FROM usage_daily WHERE day = ? ORDER BY version').all(day(1)).map(r => ({ ...r }));
    assert.deepEqual(rows, [
        { day: day(1), version: '1.7', reports: 1, active_reports: 1, activations: 5, deactivations: 0, always_on_added: 1, always_on_removed: 0, first_activations: 0, always_on_reports: 0 },
        { day: day(1), version: '1.8', reports: 2, active_reports: 1, activations: 2, deactivations: 1, always_on_added: 0, always_on_removed: 0, first_activations: 1, always_on_reports: 1 },
    ]);
    const errs = DB.raw.prepare('SELECT category, SUM(count) AS n FROM errors_daily GROUP BY category ORDER BY category').all().map(r => ({ ...r }));
    assert.deepEqual(errs, [{ category: 'inject_flag', n: 3 }, { category: 'register_always_on', n: 1 }]);
    const weekly = DB.raw.prepare('SELECT SUM(reports) AS n FROM usage_weekly WHERE week = ?').get('2026-W41');
    assert.equal(weekly.n, 2);

    const res = await worker.fetch(new Request('https://fb.example/api/stats', { headers: { authorization: 'Bearer tok' } }), env);
    assert.equal(res.status, 200);
    const stats = await res.json();
    assert.equal(stats.daily.length, 2);
    assert.equal(stats.daily.find(d => d.day === day(1)).reports, 3);
    assert.deepEqual(stats.reasons, [{ reason: 'didnt_work', n: 2 }, { reason: 'temporary', n: 1 }]);
    assert.deepEqual(stats.comments.map(c => c.details), ['done with course']);
    assert.equal(stats.versions[0].version, '1.8');
});

test('documented queries in docs/DEPLOY.md run against the schema', () => {
    const DB = d1();
    const md = fs.readFileSync(new URL('../../docs/DEPLOY.md', import.meta.url), 'utf8');
    const queries = [...md.matchAll(/```sql\n([\s\S]*?)```/g)].map(m => m[1].trim());
    assert.ok(queries.length >= 5, 'expected documented queries');
    for (const q of queries) {
        for (const stmt of q.split(/;\s*\n/).map(s => s.trim()).filter(Boolean)) {
            assert.doesNotThrow(() => DB.raw.prepare(stmt).all(), stmt);
        }
    }
});
