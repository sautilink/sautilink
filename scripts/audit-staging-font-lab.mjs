const STAGING = 'https://test.sautilink.com';
const PRODUCTION = 'https://sautilink.com';
let pass=0, fail=0;
async function probe(name, url, check) {
  try {
    const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
    const body = url.endsWith('.woff2') ? '' : await response.text();
    const issues = response.ok ? check({ response, body }) : ['HTTP_' + response.status];
    if (issues.length) fail++; else pass++;
    console.log('FONT_LAB_LIVE ' + JSON.stringify({name,url,status:response.status,pass:!issues.length,issues,
      contentType:response.headers.get('content-type'),robots:response.headers.get('x-robots-tag')}));
  } catch (e) {
    fail++;
    console.log('FONT_LAB_LIVE ' + JSON.stringify({name,url,pass:false,issues:[String(e).slice(0,120)]}));
  }
}
await probe('preview_html', STAGING + '/preview/font-lab/', ({response,body}) => [
  ...(!body.includes('SautiLink Font Lab') ? ['WRONG_TITLE'] : []),
  ...(!body.includes('data-font="flex"') || !body.includes('data-font="compare"') ? ['FONT_CONTROLS'] : []),
  ...(!body.includes('data-screen-tab="messages"') ? ['SCREENS'] : []),
  ...(!body.includes('noindex, nofollow') ? ['HTML_ROBOTS'] : []),
  ...(!/noindex/i.test(response.headers.get('x-robots-tag') || '') ? ['HTTP_ROBOTS'] : []),
  ...(!String(response.headers.get('content-security-policy') || '').includes('https://fonts.googleapis.com') ? ['FONT_CSP'] : []),
  ...(!String(response.headers.get('content-security-policy') || '').includes('https://fonts.gstatic.com') ? ['FONT_ASSET_CSP'] : []),
]);
await probe('preview_css', STAGING + '/preview/font-lab/font-lab.css', ({body}) => [
  ...(!body.includes('Google+Sans+Flex:wght@100..900') ? ['FONT_IMPORT'] : []),
  ...(!body.includes('--font-primary: "Inter"') ? ['INTER_SWITCH'] : []),
  ...(!body.includes('--font-primary: "Google Sans Flex"') ? ['FLEX_SWITCH'] : []),
]);
await probe('preview_js', STAGING + '/preview/font-lab/font-lab.js', ({body}) => [
  ...(!body.includes('grid.replaceChildren(...surfaces)') ? ['RENDERER'] : []),
  ...(!body.includes('attachControls(') ? ['CONTROLS'] : []),
]);
await probe('staging_home', STAGING + '/', ({body}) => [
  ...(!body.includes('/preview/font-lab/') ? ['MISSING_STAGING_LINK'] : []),
]);
await probe('inter_woff2', STAGING + '/assets/fonts/inter/InterVariable.woff2', ({response}) => [
  ...(!String(response.headers.get('content-type')).includes('font') && !String(response.headers.get('content-type')).includes('octet-stream') ? ['MIME'] : []),
]);
await probe('google_font_api', 'https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@100..900&display=swap', ({body}) => [
  ...(!body.includes('Google Sans Flex') ? ['FACE_MISSING'] : []),
  ...(!body.includes('fonts.gstatic.com') ? ['FONT_BINARY_URL_MISSING'] : []),
]);
await probe('production_inter_unchanged', PRODUCTION + '/assets/brand/system.css', ({body}) => [
  ...(!body.includes('Inter is the only UI/brand font family') ? ['BRAND_CHANGED'] : []),
  ...(body.includes('Google Sans Flex') ? ['FLEX_IN_PRODUCTION_CSS'] : []),
]);
console.log('FONT_LAB_LIVE_SUMMARY ' + JSON.stringify({passed:pass,failed:fail,total:pass+fail}));
if (fail) process.exitCode = 1;
