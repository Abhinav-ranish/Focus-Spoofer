import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLang, languageRedirect } from '../../site-proxy/src/index.js';

const req = (path, headers = {}, method = 'GET') => new Request('https://focus.oddworks.us' + path, { method, headers });

test('pickLang: first supported language ranked above English', () => {
    assert.equal(pickLang('uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7'), 'uk');
    assert.equal(pickLang('en-US,en;q=0.9,bn;q=0.8'), 'en');
    assert.equal(pickLang('bn-BD,bn;q=0.9,en-US;q=0.8'), 'bn');
    assert.equal(pickLang('pt-PT,pt;q=0.9'), 'pt-br');
    assert.equal(pickLang('de-DE,de;q=0.9'), null);
    assert.equal(pickLang('de;q=0.9,ml;q=0.95'), 'ml');
    assert.equal(pickLang('ru;q=0,en'), 'en');
    assert.equal(pickLang(''), null);
});

test('first visit: browser language picks the page; English and unknown stay put', () => {
    const r = languageRedirect(req('/', { 'accept-language': 'uk-UA,uk;q=0.9,en;q=0.5' }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/uk/');
    assert.equal(languageRedirect(req('/test', { 'accept-language': 'ml-IN,ml' })).headers.get('location'), '/ml/test');
    assert.equal(languageRedirect(req('/', { 'accept-language': 'en-GB,en' })), null);
    assert.equal(languageRedirect(req('/', { 'accept-language': 'fr-FR' })), null);
    assert.equal(languageRedirect(req('/privacy', { 'accept-language': 'uk' })), null);
    assert.equal(languageRedirect(req('/uk/', { 'accept-language': 'en' })), null);
});

test('remembered choice wins over the browser; crawlers and POSTs are never redirected', () => {
    assert.equal(languageRedirect(req('/', { 'accept-language': 'uk', cookie: 'lang=en' })), null);
    assert.equal(languageRedirect(req('/', { 'accept-language': 'en', cookie: 'a=1; lang=bn' })).headers.get('location'), '/bn/');
    assert.equal(languageRedirect(req('/', { 'accept-language': 'uk', 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' })), null);
    assert.equal(languageRedirect(req('/', { 'accept-language': 'uk' }, 'POST')), null);
});

test('?hl= from the language menu sets the cookie and cleans the URL', () => {
    const r = languageRedirect(req('/?hl=en'));
    assert.equal(r.headers.get('location'), '/');
    assert.match(r.headers.get('set-cookie'), /^lang=en; Path=\/; Max-Age=31536000/);
    const u = languageRedirect(req('/uk/test?hl=uk'));
    assert.equal(u.headers.get('location'), '/uk/test');
    assert.match(u.headers.get('set-cookie'), /^lang=uk;/);
    const bad = languageRedirect(req('/?hl=zz'));
    assert.equal(bad.headers.get('set-cookie'), null);
});

test('/en is an alias for the English root', () => {
    assert.equal(languageRedirect(req('/en')).headers.get('location'), '/');
    assert.equal(languageRedirect(req('/en/test')).headers.get('location'), '/test');
    assert.equal(languageRedirect(req('/en/')).status, 301);
});

test('Chinese splits by script/region; Hungarian, Turkish, Japanese route', () => {
    assert.equal(pickLang('zh-CN,zh;q=0.9'), 'zh-cn');
    assert.equal(pickLang('zh-TW,zh;q=0.9'), 'zh-tw');
    assert.equal(pickLang('zh-Hant-HK'), 'zh-tw');
    assert.equal(pickLang('zh'), 'zh-cn');
    assert.equal(pickLang('hu-HU,hu;q=0.9,en;q=0.8'), 'hu');
    assert.equal(pickLang('tr-TR'), 'tr');
    assert.equal(pickLang('ja,en-US;q=0.9'), 'ja');
    assert.equal(languageRedirect(req('/', { 'accept-language': 'zh-TW' })).headers.get('location'), '/zh-tw/');
});
