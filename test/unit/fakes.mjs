// In-memory stand-ins for chrome.storage areas and fetch.
export function fakeStorage(initial = {}) {
    const data = structuredClone(initial);
    const writes = [];
    return {
        data, writes,
        async get(keys) {
            const out = {};
            for (const k of [].concat(keys)) if (k in data) out[k] = structuredClone(data[k]);
            return out;
        },
        async set(obj) { writes.push(Object.keys(obj)); Object.assign(data, structuredClone(obj)); },
        async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
    };
}

export function fakeFetch(respond = () => ({ ok: true, status: 200 })) {
    const calls = [];
    const fn = async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body), init });
        const r = respond(url, init);
        if (r instanceof Error) throw r;
        return r;
    };
    fn.calls = calls;
    return fn;
}

export const DAY = 86400000;
export const at = (iso) => Date.parse(iso);
