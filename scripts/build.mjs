// Packages extension/ into dist/focus-spoofer-<version>.zip for the Chrome Web
// Store. Runs lint-level sanity checks first and refuses to package a build
// that would ship a placeholder backend URL.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ext = path.join(root, 'extension');
const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));

const config = fs.existsSync(path.join(ext, 'config.js')) ? fs.readFileSync(path.join(ext, 'config.js'), 'utf8') : '';
const origin = (config.match(/BACKEND_ORIGIN\s*[:=]\s*['"]([^'"]*)['"]/) || [])[1];
if (origin === undefined && config) {
    console.error('build: could not read BACKEND_ORIGIN from extension/config.js');
    process.exit(1);
}
if (origin !== undefined && origin !== '' && !/^https:\/\/[a-z0-9.-]+$/.test(origin)) {
    console.error(`build: BACKEND_ORIGIN must be '' or an https origin without a trailing slash (got ${origin})`);
    process.exit(1);
}
if (origin === '') {
    console.warn('build: BACKEND_ORIGIN is empty — uninstall survey and usage reports are disabled in this build.');
}

// Never ship dev/test leftovers.
const files = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p); else files.push(path.relative(ext, p));
    }
})(ext);
const unexpected = files.filter(f => !/\.(js|json|html|css|png)$/.test(f) && !f.endsWith('.svg'));
if (unexpected.length) {
    console.error('build: unexpected files in extension/: ' + unexpected.join(', '));
    process.exit(1);
}

fs.mkdirSync(dist, { recursive: true });
const out = path.join(dist, `focus-spoofer-${manifest.version}.zip`);
fs.rmSync(out, { force: true });
execFileSync('zip', ['-q', '-X', '-r', out, '.', '-x', '.*', '-x', 'icons/*.svg'], { cwd: ext, stdio: 'inherit' });
const size = fs.statSync(out).size;
console.log(`build ok: ${path.relative(root, out)} (${(size / 1024).toFixed(1)} KB, ${files.filter(f => !f.endsWith('.svg')).length} files)`);
