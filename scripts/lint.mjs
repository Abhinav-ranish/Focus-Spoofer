// Dependency-free checks: JS syntax, manifest validity, and that every file
// the manifest/background references actually exists in the package.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ext = path.join(root, 'extension');
const problems = [];

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out); else out.push(p);
    }
    return out;
}

const jsFiles = [...walk(ext), ...walk(path.join(root, 'server')), ...walk(path.join(root, 'test')), ...walk(path.join(root, 'scripts'))]
    .filter(f => /\.(m?js)$/.test(f));
for (const f of jsFiles) {
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
    catch (e) { problems.push(`${path.relative(root, f)}: ${e.stderr.toString().split('\n').slice(0, 4).join(' ')}`); }
}

let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')); }
catch (e) { problems.push('manifest.json: ' + e.message); }

if (manifest) {
    if (manifest.manifest_version !== 3) problems.push('manifest: manifest_version must be 3');
    if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) problems.push('manifest: bad version ' + manifest.version);
    const refs = [
        manifest.background?.service_worker,
        manifest.action?.default_popup,
        manifest.options_ui?.page,
        ...Object.values(manifest.icons || {}),
        ...Object.values(manifest.action?.default_icon || {}),
    ].filter(Boolean);
    // Files registered dynamically or loaded with importScripts from background.js.
    const bg = fs.readFileSync(path.join(ext, manifest.background.service_worker), 'utf8');
    for (const m of bg.matchAll(/['"]([\w-]+\.js)['"]/g)) refs.push(m[1]);
    for (const r of new Set(refs)) {
        if (!fs.existsSync(path.join(ext, r))) problems.push(`missing file referenced by extension: ${r}`);
    }
    // HTML pages must only load local scripts (MV3 CSP forbids remote code).
    for (const f of walk(ext).filter(f => f.endsWith('.html'))) {
        const html = fs.readFileSync(f, 'utf8');
        for (const m of html.matchAll(/<script[^>]*src=["']([^"']+)["']/g)) {
            if (/^https?:/.test(m[1])) problems.push(`${path.relative(root, f)}: remote script ${m[1]}`);
            else if (!fs.existsSync(path.join(path.dirname(f), m[1]))) problems.push(`${path.relative(root, f)}: missing ${m[1]}`);
        }
        if (/<script>(?!\s*<\/script>)/.test(html)) problems.push(`${path.relative(root, f)}: inline <script> is blocked by MV3 CSP`);
    }
}

if (problems.length) {
    console.error('lint failed:\n  ' + problems.join('\n  '));
    process.exit(1);
}
console.log(`lint ok (${jsFiles.length} JS files, manifest v${manifest.version})`);
