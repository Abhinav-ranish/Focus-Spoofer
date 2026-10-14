// Builds the translated website from the English pages.
//
//   node scripts/site-i18n.mjs            regenerate webpage/<lang>/ pages, hreflang tags,
//                                         language menus and sitemap.xml
//   node scripts/site-i18n.mjs --extract  rewrite i18n/site/en.json from the English pages
//
// The English pages (webpage/index.html, webpage/test.html) are the source.
// i18n/site/<lang>.json maps each English string to its translation; a
// string with no translation stays in English and is reported. Pages are
// static files, so the output is committed and served by Cloudflare Pages.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(root, 'webpage');
const I18N = path.join(root, 'i18n', 'site');
const ORIGIN = 'https://focus.oddworks.us';
const PAGES = [{ file: 'index.html', path: '/' }, { file: 'test.html', path: '/test' }];

// dir = URL prefix, hreflang = BCP 47 tag, label = name in its own language.
export const LANGS = [
    { code: 'en', dir: '', hreflang: 'en', label: 'English', og: 'en_US' },
    { code: 'bn', dir: 'bn', hreflang: 'bn', label: 'বাংলা', og: 'bn_BD', script: 'Bengali' },
    { code: 'hi', dir: 'hi', hreflang: 'hi', label: 'हिन्दी', og: 'hi_IN', script: 'Devanagari' },
    { code: 'kn', dir: 'kn', hreflang: 'kn', label: 'ಕನ್ನಡ', og: 'kn_IN', script: 'Kannada' },
    { code: 'ml', dir: 'ml', hreflang: 'ml', label: 'മലയാളം', og: 'ml_IN', script: 'Malayalam' },
    { code: 'vi', dir: 'vi', hreflang: 'vi', label: 'Tiếng Việt', og: 'vi_VN', script: 'Display' },
    { code: 'id', dir: 'id', hreflang: 'id', label: 'Bahasa Indonesia', og: 'id_ID' },
    { code: 'es', dir: 'es', hreflang: 'es', label: 'Español', og: 'es_ES' },
    { code: 'pt_BR', dir: 'pt-br', hreflang: 'pt-BR', label: 'Português (Brasil)', og: 'pt_BR' },
    { code: 'uk', dir: 'uk', hreflang: 'uk', label: 'Українська', og: 'uk_UA', script: 'Display' },
    { code: 'ru', dir: 'ru', hreflang: 'ru', label: 'Русский', og: 'ru_RU', script: 'Display' },
];

const TAGS = ['title', 'h1', 'h2', 'h3', 'p', 'li', 'figcaption', 'small', 'a', 'span', 'div', 'th', 'td', 'b', 'summary', 'strong', 'button'];
const BLOCK = /<(div|p|h[1-6]|ul|ol|li|section|article|svg|canvas|details|summary|table|tr|figure|header|nav|main|footer|form|img|br\s*\/?>(?=\s*$))/i;
const ATTRS = ['alt', 'aria-label', 'title', 'placeholder', 'data-label', 'data-msg-tab', 'data-msg-window', 'data-msg-tail',
    'data-t-waiting', 'data-t-cleared', 'data-t-focused', 'data-t-blurred', 'data-t-visibility', 'data-t-system', 'data-t-focus', 'data-t-vis'];
const META = ['description', 'og:title', 'og:description', 'og:image:alt', 'twitter:title', 'twitter:description'];
const JSON_KEYS = ['name', 'text', 'description', 'featureList'];

const decode = (s) => s.replace(/&[a-z]+;|&#\d+;/g, ' ');
const hasWords = (s) => /\p{L}{2,}/u.test(decode(s.replace(/<code>.*?<\/code>/g, '').replace(/<[^>]+>/g, '')));
const skipText = (s) => !hasWords(s) || /^[\w.-]+\.(edu|com|us)$/.test(s) || s === 'Focus Spoofer' ||
    /^(document\.|hasFocus|lectures\.)/.test(s) || /^[a-z]+[A-Z]\w*(\(\))?$/.test(s);
// Elements that hold other elements (beyond an arrow or dot glyph) are containers, not strings.
const CONTAINER = /<(div|span(?! class="(arrow|dot)")|button|li|p|ol|ul)\b/;

// Every element whose content is inline-only text: [start, end, tag, inner].
function leaves(html) {
    const out = [];
    const masked = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, (m) => ' '.repeat(m.length))
        .replace(/<svg\b[\s\S]*?<\/svg>/g, (m) => ' '.repeat(m.length));
    const open = new RegExp(`<(${TAGS.join('|')})\\b[^>]*>`, 'g');
    let m;
    while ((m = open.exec(masked))) {
        const tag = m[1], start = m.index + m[0].length;
        const end = masked.indexOf(`</${tag}>`, start);
        if (end < 0) continue;
        const inner = html.slice(start, end);
        if (CONTAINER.test(inner) || (tag === 'div' && /<a\b/.test(inner)) || BLOCK.test(inner.replace(/<br\s*\/?>/g, ''))) continue;
        const t = inner.trim();
        if (!t || skipText(t)) continue;
        out.push([start, end, tag, inner]);
    }
    // Keep only outermost strings (a link inside a translated paragraph goes with it).
    return out.filter(([s, e]) => !out.some(([s2, e2]) => s2 < s && e <= e2));
}

function attrs(html) {
    const out = [];
    const masked = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, (m) => ' '.repeat(m.length));
    const re = new RegExp(`\\s(${ATTRS.join('|')})="([^"]*)"`, 'g');
    let m;
    while ((m = re.exec(masked))) if (hasWords(m[2]) && m[2] !== 'Focus Spoofer') out.push([m.index, m[0].length, m[1], m[2]]);
    const meta = /<meta\s+(?:name|property)="([^"]+)"\s+content="([^"]*)"/g;
    while ((m = meta.exec(masked))) if (META.includes(m[1])) out.push([m.index + m[0].indexOf('content="') + 8, m[2].length + 2, 'content', m[2]]);
    return out;
}

function jsonLdStrings(html) {
    const out = [];
    for (const [, body] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        (function walk(v, key) {
            if (Array.isArray(v)) v.forEach((x) => walk(x, key));
            else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, k));
            else if (typeof v === 'string' && JSON_KEYS.includes(key) && hasWords(v) && v !== 'Focus Spoofer' && v !== 'oddworks') out.push(v);
        })(JSON.parse(body));
    }
    return out;
}

function extract() {
    const seen = new Map();
    for (const p of PAGES) {
        const html = fs.readFileSync(path.join(WEB, p.file), 'utf8');
        for (const [, , , inner] of leaves(html)) seen.set(inner.trim(), inner.trim());
        for (const [, , , v] of attrs(html)) seen.set(v, v);
        for (const v of jsonLdStrings(html)) seen.set(v, v);
    }
    fs.mkdirSync(I18N, { recursive: true });
    fs.writeFileSync(path.join(I18N, 'en.json'), JSON.stringify(Object.fromEntries(seen), null, 2) + '\n');
    console.log(`i18n/site/en.json: ${seen.size} strings`);
}

const escAttr = (s) => s.replace(/&(?![a-z]+;|#\d+;)/g, '&amp;').replace(/"/g, '&quot;');
const url = (lang, p) => ORIGIN + '/' + (lang.dir ? lang.dir + (p === '/' ? '/' : p) : p.slice(1));
const href = (lang, p) => '/' + (lang.dir ? lang.dir + (p === '/' ? '/' : p) : p.slice(1));

function langMenu(cur, page) {
    const items = LANGS.map((l) => `<li><a href="${href(l, page.path)}?hl=${l.dir || 'en'}" hreflang="${l.hreflang}" lang="${l.hreflang}"${l === cur ? ' aria-current="true"' : ''}>${l.label}</a></li>`).join('');
    return `<!-- lang-menu --><details class="lang-menu"><summary aria-label="Language: ${cur.label}">${(cur.dir || 'en').toUpperCase()}</summary><ul>${items}</ul></details><!-- /lang-menu -->`;
}

function headBlock(cur, page) {
    const alts = LANGS.map((l) => `  <link rel="alternate" hreflang="${l.hreflang}" href="${url(l, page.path)}">`).join('\n');
    let block = `<!-- i18n -->\n${alts}\n  <link rel="alternate" hreflang="x-default" href="${url(LANGS[0], page.path)}">\n`;
    block += `  <meta property="og:locale" content="${cur.og}">\n`;
    block += LANGS.filter((l) => l !== cur).map((l) => `  <meta property="og:locale:alternate" content="${l.og}">`).join('\n') + '\n';
    if (cur.script) {
        const fam = cur.script === 'Display' ? 'Noto+Serif+Display:ital@0;1&family=Noto+Sans:wght@400;500'
            : `Noto+Serif+${cur.script}:wght@400&family=Noto+Sans+${cur.script}:wght@400;500`;
        block += `  <link href="https://fonts.googleapis.com/css2?family=${fam}&display=swap" rel="stylesheet">\n`;
    }
    return block + '  <!-- /i18n -->';
}

function localize(html, lang, page, dict, missing) {
    const tr = (s) => {
        const k = s.trim();
        if (lang.code === 'en' || !(k in dict)) {
            if (lang.code !== 'en' && hasWords(k) && !['Focus Spoofer', 'oddworks'].includes(k)) missing.add(k);
            return s;
        }
        return s.replace(k, dict[k]);
    };
    if (lang.code !== 'en') {
        // JSON-LD: translate texts, point page URLs at this language.
        html = html.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g, (m, a, body, z) => {
            const walk = (v, key) => {
                if (Array.isArray(v)) return v.map((x) => walk(x, key));
                if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
                if (typeof v !== 'string') return v;
                if (key === 'inLanguage') return lang.hreflang;
                if ((key === 'url' || key === 'item' || key === '@id') && v.startsWith(ORIGIN + '/') && !/#(organization|website)$/.test(v) && !v.includes('/assets/')) {
                    const u = new URL(v);
                    const p = PAGES.find((x) => x.path === (u.pathname === '/' ? '/' : u.pathname));
                    return p ? url(lang, p.path) + u.hash : v;
                }
                return JSON_KEYS.includes(key) ? tr(v) : v;
            };
            return a + '\n' + JSON.stringify(walk(JSON.parse(body)), null, 2) + '\n  ' + z;
        });
        // Attributes and meta content, last first so offsets stay valid.
        for (const [at, len, name, v] of attrs(html).sort((x, y) => y[0] - x[0])) {
            const t = tr(v);
            if (t === v) continue;
            html = name === 'content'
                ? html.slice(0, at) + `"${escAttr(t)}"` + html.slice(at + len)
                : html.slice(0, at) + ` ${name}="${escAttr(t)}"` + html.slice(at + len);
        }
        for (const [start, end, , inner] of leaves(html).sort((x, y) => y[0] - x[0])) {
            const t = tr(inner);
            if (t !== inner) html = html.slice(0, start) + t + html.slice(end);
        }
        // Site links stay inside this language (the privacy policy is English-only).
        html = html.replace(/href="\/(test)?(#[\w-]+)?"/g, (m, t, h) => `href="/${lang.dir}/${t || ''}${h || ''}"`)
            .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url(lang, page.path)}">`)
            .replace(/(<meta property="og:url" content=")[^"]*/, `$1${url(lang, page.path)}`)
            .replace(/<html lang="[^"]*"/, `<html lang="${lang.hreflang}"`);
    }
    html = html.replace(/<!-- i18n -->[\s\S]*?<!-- \/i18n -->\n?\s*/, '')
        .replace(/(<link rel="canonical"[^>]*>)/, `$1\n  ${headBlock(lang, page)}`);
    html = html.replace(/<!-- lang-menu -->[\s\S]*?<!-- \/lang-menu -->/, '')
        .replace(/(<a class="btn btn-ink"[^>]*href="https:\/\/chromewebstore[^"]*"[^>]*>[^<]*<\/a>\s*<\/nav>)/, (m) => langMenu(lang, page) + '\n        ' + m);
    return html;
}

function build() {
    const report = [];
    const sources = Object.fromEntries(PAGES.map((p) => [p.file, fs.readFileSync(path.join(WEB, p.file), 'utf8')]));
    for (const lang of LANGS) {
        const file = path.join(I18N, lang.code + '.json');
        const dict = lang.code === 'en' ? {} : (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
        if (!dict) { report.push(`${lang.code}: no i18n/site/${lang.code}.json, skipped`); continue; }
        const missing = new Set();
        for (const p of PAGES) {
            const html = localize(sources[p.file], lang, p, dict, missing);
            const out = lang.dir ? path.join(WEB, lang.dir, p.file) : path.join(WEB, p.file);
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, html);
        }
        report.push(`${lang.code}: ${missing.size ? missing.size + ' untranslated: ' + [...missing].slice(0, 3).map((s) => JSON.stringify(s.slice(0, 40))).join(', ') : 'complete'}`);
    }
    // Sitemap with language alternates.
    const today = new Date().toISOString().slice(0, 10);
    const alt = (p) => LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.hreflang}" href="${url(l, p.path)}"/>`).join('\n')
        + `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${url(LANGS[0], p.path)}"/>`;
    const urls = PAGES.flatMap((p) => LANGS.map((l) => `  <url>\n    <loc>${url(l, p.path)}</loc>\n    <lastmod>${today}</lastmod>\n${alt(p)}\n  </url>`));
    urls.push(`  <url>\n    <loc>${ORIGIN}/privacy</loc>\n    <lastmod>2026-10-09</lastmod>\n  </url>`);
    fs.writeFileSync(path.join(WEB, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);
    console.log(report.join('\n'));
}

if (process.argv.includes('--extract')) extract(); else build();
