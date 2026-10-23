// Edge front for https://focus.oddworks.us.
//
// - Feedback routes (/uninstall, /dashboard, /api/*) go to the feedback Worker
//   (server/), with the visitor's IP passed in x-client-ip and authenticated
//   by the shared PROXY_SECRET, so its rate limits stay per visitor.
// - Everything else goes to the Cloudflare Pages origin, keeping path and query.
// - Redirect Locations on either origin host are rewritten to this host
//   (Pages 308s /test.html → /test, for example).
// - Drops the X-Robots-Tag: noindex that webpage/_headers puts on the
//   pages.dev host, so only the canonical host gets indexed.
const FEEDBACK_PATHS = new Set([
    '/uninstall', '/uninstall.html', '/dashboard', '/dashboard.html',
    '/api/uninstall-visit', '/api/uninstall-feedback', '/api/report', '/api/stats',
]);

// Translated pages live at /<dir>/ (built by scripts/site-i18n.mjs).
export const LANG_DIRS = ['bn', 'hi', 'kn', 'ml', 'vi', 'id', 'es', 'pt-br', 'uk', 'ru'];
const ENGLISH_PAGES = new Set(['/', '/test']);
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|whatsapp|telegram|discord|slack|lighthouse|headless/i;

// First supported language in the visitor's Accept-Language that they rank
// above English. 'en' means English wins; null means nothing usable.
export function pickLang(header) {
    if (!header) return null;
    const prefs = header.split(',').map((part, i) => {
        const [tag, ...params] = part.trim().toLowerCase().split(';');
        const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
        return { tag, q: q ? Number(q.slice(2)) : 1, i };
    }).filter(p => p.tag && p.q > 0).sort((a, b) => b.q - a.q || a.i - b.i);
    for (const { tag } of prefs) {
        const base = tag.split('-')[0];
        if (base === 'en') return 'en';
        if (base === 'pt') return 'pt-br';
        if (base === 'in') return 'id';
        if (LANG_DIRS.includes(base)) return base;
    }
    return null;
}

function cookieLang(request) {
    const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)lang=([a-z-]+)/);
    return m && (m[1] === 'en' || LANG_DIRS.includes(m[1])) ? m[1] : null;
}

// Language routing for the English pages:
// - ?hl=<lang> (from the language menu) remembers the choice in a cookie and
//   drops the parameter;
// - otherwise a remembered choice, or for first visits the browser's language,
//   sends / and /test to the translated page. Crawlers are never redirected,
//   so every language stays indexable through hreflang.
export function languageRedirect(request) {
    if (!['GET', 'HEAD'].includes(request.method)) return null;
    const url = new URL(request.url);
    // /en and /en/... are English, which lives at the root.
    if (url.pathname === '/en' || url.pathname.startsWith('/en/')) {
        const res = new Response(null, { status: 301, headers: { location: (url.pathname.slice(3) || '/') + url.search } });
        res.headers.append('set-cookie', 'lang=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
        return res;
    }
    const hl = url.searchParams.get('hl');
    if (hl !== null) {
        const choice = hl === 'en' || LANG_DIRS.includes(hl) ? hl : null;
        url.searchParams.delete('hl');
        const res = new Response(null, { status: 302, headers: { location: url.pathname + url.search + url.hash, 'cache-control': 'no-store' } });
        if (choice) res.headers.append('set-cookie', `lang=${choice}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
        return res;
    }
    if (!ENGLISH_PAGES.has(url.pathname) || BOT.test(request.headers.get('user-agent') || '')) return null;
    const lang = cookieLang(request) || pickLang(request.headers.get('accept-language'));
    if (!lang || lang === 'en') return null;
    const to = '/' + lang + (url.pathname === '/' ? '/' : url.pathname) + url.search;
    return new Response(null, { status: 302, headers: { location: to, 'cache-control': 'private, no-store', vary: 'Accept-Language, Cookie' } });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const redirect = languageRedirect(request);
        if (redirect) return redirect;
        const toFeedback = FEEDBACK_PATHS.has(url.pathname);
        const origin = new URL(toFeedback ? env.FEEDBACK_ORIGIN : env.ORIGIN);
        const upstream = new URL(url.pathname + url.search, origin);

        const headers = new Headers(request.headers);
        headers.delete('x-proxy-auth');
        headers.delete('x-client-ip');
        if (toFeedback) {
            headers.set('x-proxy-auth', env.PROXY_SECRET || '');
            headers.set('x-client-ip', request.headers.get('cf-connecting-ip') || '');
        }

        const res = await fetch(upstream, {
            method: request.method,
            headers,
            body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
            redirect: 'manual',
        });

        const out = new Headers(res.headers);
        out.delete('x-robots-tag');
        const location = out.get('location');
        if (location) {
            const loc = new URL(location, origin);
            if (loc.host === origin.host) {
                loc.protocol = url.protocol;
                loc.host = url.host;
                out.set('location', loc.toString());
            }
        }
        if (toFeedback) out.set('x-robots-tag', 'noindex');
        if (ENGLISH_PAGES.has(url.pathname)) out.set('vary', 'Accept-Language, Cookie');
        out.set('strict-transport-security', 'max-age=31536000');
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
    },
};
