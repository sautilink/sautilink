// Read-only live SEO audit. This script does not submit URLs to search engines.
const pages = [
  ...['privacy', 'terms', 'community-guidelines', 'merchant-policies',
      'account-deletion', 'upload-guidelines', 'help', 'contact', 'about',
      'verify'].map(slug => ({ url: 'https://sautilink.com/' + slug, type: 'static' })),
  ...['privacy', 'terms', 'account-deletion', 'faq'].map(slug => ({
    url: 'https://cloudengine.sautilink.com/' + slug, type: 'static',
  })),
  { url: 'https://pilot.sautilink.com/privacy', type: 'pilot', lang: 'en' },
  { url: 'https://pilot.sautilink.com/privacy?lang=sw', type: 'pilot', lang: 'sw' },
];

function check(ok, message, findings) {
  if (!ok) findings.push(message);
}
function getTags(head, tagName) {
  return [...head.matchAll(new RegExp('<' + tagName + '\\b[^>]*>', 'gi'))].map(x => x[0]);
}
function attribute(tag, key) {
  return tag.match(new RegExp('\\b' + key + '=["\\x27]([^"\\x27]*)["\\x27]', 'i'))?.[1] ?? null;
}
function meta(head, key) {
  return getTags(head, 'meta')
    .filter(tag => attribute(tag, 'name') === key || attribute(tag, 'property') === key)
    .map(tag => attribute(tag, 'content'));
}
function links(head, rel) {
  return getTags(head, 'link').filter(tag => attribute(tag, 'rel') === rel);
}
function graphs(head) {
  const list = [];
  for (const match of head.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/type=["']application\/ld\+json["']/i.test(match[1])) {
      const data = JSON.parse(match[2]);
      list.push(...(data['@graph'] || [data]));
    }
  }
  return list;
}
async function get(url) {
  const response = await fetch(url, {
    redirect: 'follow', signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': 'SautiLink-Live-SEO-Verifier/1.0',
      'Cache-Control': 'no-cache', 'Accept': 'text/html,application/xhtml+xml,*/*' },
  });
  return { response, text: await response.text() };
}
async function verifyPage(p) {
  const findings = [];
  let status = 'ERROR', resolved = '', xRobots = '';
  try {
    const { response, text } = await get(p.url);
    status = response.status;
    resolved = response.url;
    xRobots = response.headers.get('x-robots-tag') || '';
    check(response.ok, 'HTTP_' + status, findings);
    check((response.headers.get('content-type') || '').includes('text/html'),
      'NOT_HTML', findings);
    check(!/noindex/i.test(xRobots), 'HEADER_NOINDEX', findings);
    const head = text.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
    check(Boolean(head), 'NO_HTML_HEAD', findings);
    if (head) {
      const canonical = links(head, 'canonical').map(tag => attribute(tag, 'href'));
      check(canonical.length === 1 && canonical[0] === p.url,
        'BAD_CANONICAL:' + JSON.stringify(canonical), findings);
      check(meta(head, 'description').length === 1, 'DESCRIPTION_COUNT', findings);
      check(meta(head, 'robots').length === 1 && /index/i.test(meta(head, 'robots')[0])
        && !/noindex/i.test(meta(head, 'robots')[0]), 'ROBOTS_META', findings);
      check(meta(head, 'og:url')[0] === p.url, 'OG_URL', findings);
      for (const key of ['og:type', 'og:title', 'og:description', 'og:site_name',
        'og:locale', 'og:image', 'og:image:alt',
        'twitter:card', 'twitter:title', 'twitter:description',
        'twitter:image', 'twitter:image:alt']) {
        check(meta(head, key).length === 1 && Boolean(meta(head, key)[0]),
          'MISSING_OR_DUPLICATE_' + key, findings);
      }
      check(meta(head, 'og:image')[0] === meta(head, 'twitter:image')[0],
        'IMAGE_MISMATCH', findings);
      const list = graphs(head);
      const page = list.find(item => item['@type'] === 'WebPage');
      const breadcrumb = list.find(item => item['@type'] === 'BreadcrumbList');
      const org = list.find(item => item['@type'] === 'Organization');
      check(page?.url === p.url, 'SCHEMA_PAGE_URL', findings);
      check(page?.breadcrumb?.['@id'] === breadcrumb?.['@id'] && Boolean(breadcrumb),
        'SCHEMA_BREADCRUMB', findings);
      check(org?.['@id'] === 'https://sautilink.com/#organization',
        'SCHEMA_ORGANIZATION', findings);
      if (p.type === 'static') {
        check(head.includes('SEO_METADATA_20261108'), 'UPDATED_SCHEMA_NOT_LIVE', findings);
      } else {
        const alt = links(head, 'alternate');
        for (const language of ['en', 'sw', 'x-default']) {
          check(alt.some(t => attribute(t, 'hreflang') === language),
            'MISSING_HREFLANG_' + language, findings);
        }
        check(page?.inLanguage === p.lang, 'SCHEMA_LANGUAGE', findings);
      }
    }
  } catch (error) { findings.push('REQUEST_OR_PARSE_ERROR:' + String(error).slice(0,160)); }
  return { url: p.url, status, resolved, xRobots, result: findings.length ? 'FAIL' : 'PASS', findings };
}
async function verifyDiscovery(origin, paths) {
  const findings = [];
  try {
    const robots = await get(origin + '/robots.txt');
    const sitemap = await get(origin + '/sitemap.xml');
    check(robots.response.ok, 'ROBOTS_HTTP_' + robots.response.status, findings);
    check(sitemap.response.ok, 'SITEMAP_HTTP_' + sitemap.response.status, findings);
    check(robots.text.includes('Sitemap: ' + origin + '/sitemap.xml'),
      'ROBOTS_SITEMAP_MISSING', findings);
    check(/<(sitemapindex|urlset)\b/.test(sitemap.text),
      'INVALID_SITEMAP_ROOT', findings);
    if (origin === 'https://sautilink.com') {
      const staticSitemap = await get(origin + '/sitemap-static.xml');
      check(staticSitemap.response.ok, 'STATIC_SITEMAP_HTTP', findings);
      for (const path of paths) check(staticSitemap.text.includes(
        '<loc>' + origin + path + '</loc>'), 'SITEMAP_MISSING_' + path, findings);
    } else if (origin.includes('cloudengine')) {
      for (const path of paths) check(sitemap.text.includes('<loc>' + origin + path + '</loc>'),
        'SITEMAP_MISSING_' + path, findings);
    } else {
      for (const path of paths) check(sitemap.text.includes(origin + path),
        'SITEMAP_MISSING_' + path, findings);
    }
  } catch (error) { findings.push('DISCOVERY_ERROR:' + String(error).slice(0,160)); }
  return { origin, result: findings.length ? 'FAIL' : 'PASS', findings };
}
const results = await Promise.all(pages.map(verifyPage));
const discovery = await Promise.all([
  verifyDiscovery('https://sautilink.com', pages.filter(p => p.type === 'static' && p.url.startsWith('https://sautilink.com/')).map(p => new URL(p.url).pathname)),
  verifyDiscovery('https://cloudengine.sautilink.com', ['/privacy', '/terms', '/account-deletion', '/faq']),
  verifyDiscovery('https://pilot.sautilink.com', ['/privacy']),
]);
for (const item of [...results, ...discovery]) console.log('SEO_LIVE_AUDIT ' + JSON.stringify(item));
const total = results.length + discovery.length;
const passed = [...results, ...discovery].filter(x => x.result === 'PASS').length;
console.log('SEO_LIVE_AUDIT_SUMMARY ' + JSON.stringify({ passed, total, failed: total - passed,
  note: 'Checks public crawlability, metadata, linked data and sitemaps; not Search Console indexing status.' }));
if (passed !== total) process.exitCode = 1;
