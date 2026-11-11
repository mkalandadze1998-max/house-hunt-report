// How collect-ss.mjs reaches ss.ge.
//
// home.ss.ge and api-gateway.ss.ge answer every data-centre address (GitHub, Jina, TinyFish Fetch) with a
// Cloudflare challenge, but a Georgian address is let straight through (verified 4 Nov 2026). So in the
// cloud the collector drives a remote Chrome with a Georgian exit (TinyFish Browser API, metered per
// minute from the prepaid wallet; about 1 cent a run) and makes every request from inside that page:
// the search page gives the 1-hour session token, the API and the detail pages are fetched by the page
// itself. From a normal connection (a PC in Georgia) the same code talks to ss.ge directly.
//
// Both modes expose one interface: { mode, token, pageProps, fetch(url, init), close() } where fetch()
// returns a Response-like { ok, status, text(), json() }.
export const SS_SITE = 'https://home.ss.ge';
export const SEARCH_PAGE = `${SS_SITE}/ka/udzravi-qoneba/l/bina/qiravdeba?cityIdList=95&currencyId=1&order=1`;
const BROWSER_API = 'https://api.browser.tinyfish.ai';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36 house-hunt-report/1.0';

export function nextDataOf(html) {
  const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('__NEXT_DATA__ not found');
  return JSON.parse(m[1]);
}
const sessionCookie = (response, pageProps) => {
  const cookie = response.headers.getSetCookie?.().find(v => v.startsWith('ss-session-token='));
  const token = cookie?.split(';')[0].slice('ss-session-token='.length) || pageProps?.credentialsToken;
  if (!token || /[\s\r\n]/.test(token)) throw Error('SS public session is missing; previous data retained.');
  return token;
};

/* Direct mode: plain fetch (works from a home connection in Georgia). */
async function openDirect({ fetchImpl = fetch } = {}) {
  const r = await fetchImpl(SEARCH_PAGE, { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'ka' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Error('SS search page failed: HTTP ' + r.status + '; previous data retained.');
  const pageProps = nextDataOf(await r.text()).props.pageProps;
  const token = sessionCookie(r, pageProps);
  return {
    mode: 'direct', token, pageProps,
    fetch: (url, init = {}) => fetchImpl(url, { ...init, headers: { 'User-Agent': UA, Origin: SS_SITE, Referer: SS_SITE + '/', ...(init.headers || {}) }, signal: init.signal ?? AbortSignal.timeout(30000) }),
    close: async () => {},
  };
}

/* Cloud mode: a remote Chrome with a Georgian exit; requests run inside the page. */
async function openCloudBrowser({ apiKey, country = 'GE', fetchImpl = fetch, log = () => {} }) {
  const created = await fetchImpl(BROWSER_API, {
    method: 'POST', headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: SEARCH_PAGE, proxy_config: { enabled: true, type: 'tinyfish', country_code: country }, timeout_seconds: 600 }),
    signal: AbortSignal.timeout(90000),
  });
  if (!created.ok) throw Error(`TinyFish Browser API HTTP ${created.status}; previous data retained.`);
  const { session_id, cdp_url } = await created.json();
  const closeSession = async () => { try { await fetchImpl(`${BROWSER_API}/${session_id}`, { method: 'DELETE', headers: { 'X-API-Key': apiKey }, signal: AbortSignal.timeout(30000) }); } catch { /* the inactivity timeout ends it anyway */ } };
  let browser;
  try {
    const pw = await import(process.env.PLAYWRIGHT_CORE_PATH ? (await import('node:url')).pathToFileURL(process.env.PLAYWRIGHT_CORE_PATH).href : 'playwright-core');
    const chromium = pw.chromium ?? pw.default?.chromium; // CommonJS package loaded through a file URL
    browser = await chromium.connectOverCDP(cdp_url, { timeout: 60000 });
    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = context.pages()[0] ?? await context.newPage();
    if (!page.url().startsWith(SS_SITE)) await page.goto(SEARCH_PAGE, { waitUntil: 'domcontentloaded', timeout: 90000 });
    let next = null;
    for (let i = 0; i < 45 && !next; i++) {
      next = await page.evaluate(() => { const el = document.getElementById('__NEXT_DATA__'); return el ? JSON.parse(el.textContent) : null; }).catch(() => null);
      if (!next) await page.waitForTimeout(2000);
    }
    if (!next) throw Error(`SS search page did not load in the cloud browser (title: ${await page.title().catch(() => '?')}); previous data retained.`);
    const token = (await context.cookies(SS_SITE)).find(c => c.name === 'ss-session-token')?.value;
    if (!token || /[\s\r\n]/.test(token)) throw Error('SS session cookie missing in the cloud browser; previous data retained.');
    log(`ss.ge via cloud browser (exit ${country}), session ${session_id}`);
    // fetch() runs inside the page: same Georgian exit, no forbidden headers (the browser sets UA/Origin).
    const pageFetch = async (url, init = {}) => {
      const safe = {}; for (const [k, v] of Object.entries(init.headers || {})) if (!/^(user-agent|origin|referer)$/i.test(k)) safe[k] = v;
      const r = await page.evaluate(async ({ url, init }) => {
        try { const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) }); return { ok: res.ok, status: res.status, text: await res.text() }; }
        catch (e) { return { ok: false, status: 0, text: '', error: String(e && e.message || e) }; }
      }, { url, init: { method: init.method || 'GET', headers: safe, body: init.body ?? undefined } });
      if (r.error) throw Error(`in-browser fetch failed for ${url}: ${r.error}`);
      return { ok: r.ok, status: r.status, text: async () => r.text, json: async () => JSON.parse(r.text) };
    };
    return {
      mode: `cloud browser (${country})`, token, pageProps: next.props?.pageProps ?? {}, fetch: pageFetch,
      close: async () => { try { await browser.close(); } catch { /* ignore */ } await closeSession(); },
    };
  } catch (error) {
    try { await browser?.close(); } catch { /* ignore */ }
    await closeSession();
    throw error;
  }
}

export async function openSsTransport({ apiKey = process.env.TINYFISH_API_KEY, country = process.env.SS_PROXY_COUNTRY || 'GE', fetchImpl = fetch, log = console.log } = {}) {
  if (apiKey) return openCloudBrowser({ apiKey, country, fetchImpl, log });
  log('ss.ge direct (no TINYFISH_API_KEY): works from a Georgian home connection only');
  return openDirect({ fetchImpl });
}
