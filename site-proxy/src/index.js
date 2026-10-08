// Edge front for https://focus.oddworks.us → Cloudflare Pages (focus-toggle).
//
// - Proxies every request to the Pages origin, keeping path and query.
// - Rewrites redirect Locations from the origin host to the canonical host
//   (Pages 308s /test.html → /test, for example).
// - Drops the X-Robots-Tag: noindex that webpage/_headers puts on the
//   pages.dev host, so only the canonical host gets indexed.
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = new URL(env.ORIGIN);
        const upstream = new URL(url.pathname + url.search, origin);

        const res = await fetch(upstream, {
            method: request.method,
            headers: request.headers,
            body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
            redirect: 'manual',
        });

        const headers = new Headers(res.headers);
        headers.delete('x-robots-tag');
        const location = headers.get('location');
        if (location) {
            const loc = new URL(location, origin);
            if (loc.host === origin.host) {
                loc.protocol = url.protocol;
                loc.host = url.host;
                headers.set('location', loc.toString());
            }
        }
        headers.set('strict-transport-security', 'max-age=31536000');
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    },
};
