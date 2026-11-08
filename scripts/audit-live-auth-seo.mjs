// Read-only post-deploy SEO audit. No search submission, state changes or credentials.
const ORIGIN = 'https://sautilink.com';
function values(h, type, name) {
  return [...h.matchAll(/<meta\b[^>]*>/gi)].map(x => x[0])
    .filter(t => t.includes(type + '="' + name + '"'))
    .map(t => t.match(/content="([^"]*)"/i)?.[1] || '');
}
function canonicals(h) {
  return [...h.matchAll(/<link\b[^>]*>/gi)].map(x => x[0])
    .filter(t => t.includes('rel="canonical"'))
    .map(t => t.match(/href="([^"]*)"/i)?.[1] || '');
}
async function probe(mode, source, suffix, method) {
  const url = source + '/' + mode + suffix;
  const issues = [];
  let status = 'ERROR', resolved = '';
  try {
    const r = await fetch(url, { method, redirect: 'follow',
      signal: AbortSignal.timeout(18000),
      headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'SautiLink-Auth-SEO-Verifier/1.0' } });
    status = r.status;
    resolved = r.url;
    if (status !== 200) issues.push('HTTP_' + status);
    if (!/noindex/i.test(r.headers.get('x-robots-tag') || '')) issues.push('NO_HTTP_NOINDEX');
    if (!/no-store/i.test(r.headers.get('cache-control') || '')) issues.push('NOT_NO_STORE');
    if (method === 'GET') {
      const html = await r.text();
      const h = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
      const canonical = ORIGIN + '/' + mode;
      if (canonicals(h).length !== 1 || canonicals(h)[0] !== canonical) issues.push('CANONICAL');
      if (!/<title>[^<]+<\/title>/.test(h) || !h.includes(mode === 'login' ? 'Log in to SautiLink' : 'Create your SautiLink account')) issues.push('TITLE');
      if (values(h, 'name', 'description').length !== 1) issues.push('DESCRIPTION');
      if (values(h, 'name', 'robots').length !== 1 || !values(h, 'name', 'robots')[0].includes('noindex')) issues.push('META_NOINDEX');
      if (values(h, 'property', 'og:url')[0] !== canonical) issues.push('OG_CANONICAL');
      for (const tag of ['og:title','og:description','og:type','og:site_name','og:locale','og:image','og:image:secure_url','og:image:alt']) {
        if (values(h, 'property', tag).length !== 1) issues.push('BAD_OG_' + tag);
      }
      for (const tag of ['twitter:card','twitter:title','twitter:description','twitter:image','twitter:image:alt','twitter:site']) {
        if (values(h, 'name', tag).length !== 1) issues.push('BAD_TWITTER_' + tag);
      }
      const match = h.match(/<script type="application\/ld\+json" data-seo="SEO_AUTH_ROUTES_20261108">([\s\S]*?)<\/script>/i);
      if (!match) issues.push('MISSING_AUTH_JSON_LD');
      else {
        try {
          const graph = JSON.parse(match[1])['@graph'];
          if (graph?.find(x=>x['@type']==='WebPage')?.url !== canonical) issues.push('BAD_SCHEMA_WEBPAGE');
        } catch (e) { issues.push('INVALID_JSON_LD'); }
      }
      if (!html.includes('data-sautilink-auth-entry="' + mode + '"')) issues.push('AUTH_MODE');
      for (const form of ['login-form', 'signup-form']) {
        if (!html.includes('id="' + form + '"')) issues.push('MISSING_FORM_' + form);
      }
    }
  } catch (e) { issues.push('REQUEST_' + String(e).slice(0,120)); }
  return { url, method, status, resolved, result: issues.length ? 'FAIL' : 'PASS', issues };
}
const jobs = [];
for (const mode of ['login', 'signup']) {
  for (const origin of [ORIGIN, 'https://www.sautilink.com']) {
    jobs.push(probe(mode, origin, '', 'GET'));
    jobs.push(probe(mode, origin, '/', 'GET'));
    jobs.push(probe(mode, origin, '?next=%2Fhome', 'GET'));
    jobs.push(probe(mode, origin, '', 'HEAD'));
  }
}
const results = await Promise.all(jobs);
let sitemapResult = { url: ORIGIN + '/sitemap-static.xml', result: 'FAIL', issues: [] };
try {
  const r = await fetch(sitemapResult.url, { signal: AbortSignal.timeout(18000) });
  const xml = await r.text();
  if (!r.ok) sitemapResult.issues.push('HTTP_' + r.status);
  if (/<loc>https:\/\/sautilink\.com\/(?:login|signup)<\/loc>/.test(xml)) sitemapResult.issues.push('PRIVATE_AUTH_IN_SITEMAP');
  sitemapResult.result = sitemapResult.issues.length ? 'FAIL' : 'PASS';
} catch (e) { sitemapResult.issues.push('REQUEST_' + String(e).slice(0,120)); }
for (const item of [...results, sitemapResult]) console.log('LIVE_AUTH_SEO ' + JSON.stringify(item));
const passed = [...results, sitemapResult].filter(x => x.result === 'PASS').length;
console.log('LIVE_AUTH_SEO_SUMMARY ' + JSON.stringify({ passed, total: results.length + 1, failed: results.length + 1 - passed }));
if (passed !== results.length + 1) process.exitCode = 1;
