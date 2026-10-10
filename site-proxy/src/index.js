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
    '/api/uninstall-feedback', '/api/report', '/api/stats',
]);

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
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
        out.set('strict-transport-security', 'max-age=31536000');
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
    },
};
