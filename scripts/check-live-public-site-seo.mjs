// Diagnostic-only public checks: no writes, credentials or indexing submissions.
const ORIGIN = 'https://sautilink.com';
const localized = ['sw', 'fr', 'es', 'nb'];
const pages = ['', 'sautinote', 'download', ...localized, 'no'];
function value(head, type, name) {
 const tags=[...head.matchAll(/<meta\b[^>]*>/gi)].map(x=>x[0]);
 const selected=tags.filter(tag=>tag.includes(type+'="'+name+'"'));
 return selected.map(tag=>tag.match(/content="([^"]*)"/i)?.[1]||'');
}
function canonical(head) {
 return [...head.matchAll(/<link\b[^>]*>/gi)].map(x=>x[0])
 .filter(x=>x.includes('rel="canonical"'))
 .map(x=>x.match(/href="([^"]*)"/i)?.[1]||'');
}
async function checkPage(slug){
 const url=ORIGIN+'/'+slug, findings=[];
 try {
  const r=await fetch(url+'?seo_audit=20261108',{
   signal: AbortSignal.timeout(20000),redirect:'follow',
   headers:{'Cache-Control':'no-cache','User-Agent':'SautiLink-SEO-PostDeploy-Verification/1.0'}
  });
  const body=await r.text();
  const h=body.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]||'';
  const expected=slug==='no' ? ORIGIN+'/nb' : url;
  if(r.status!==200) findings.push('HTTP_'+r.status);
  if(!h) findings.push('NO_HEAD');
  if(canonical(h).length!==1||canonical(h)[0]!==expected) findings.push('CANONICAL:'+canonical(h));
  if(value(h,'property','og:url')[0]!==expected) findings.push('OG_URL');
  for(const key of ['og:site_name','og:locale','og:image','og:image:secure_url','og:image:alt']){
   if(value(h,'property',key).length!==1) findings.push('OG_'+key);
  }
  for(const key of ['twitter:card','twitter:title','twitter:description','twitter:image','twitter:image:alt','twitter:site']){
   if(value(h,'name',key).length!==1) findings.push('TWITTER_'+key);
  }
  const robots=value(h,'name','robots')[0]||'';
  if(slug===''&&!robots.includes('noindex'))findings.push('GATEWAY_SHOULD_BE_NOINDEX');
  if(slug!==''&&!robots.includes('index, follow'))findings.push('PUBLIC_ROBOTS');
  if(slug!=='no'){
    const match=h.match(/<script type="application\/ld\+json" data-seo="SEO_PUBLIC_SITE_20261108">([\s\S]*?)<\/script>/i);
    if(!match)findings.push('SCHEMA_NOT_DEPLOYED');
    else {
     try {
      const graph=JSON.parse(match[1])['@graph'];
      if(graph?.find(x=>x['@type']==='WebPage')?.url!==expected) findings.push('SCHEMA_WEBPAGE_URL');
     } catch(e){findings.push('SCHEMA_INVALID_JSON')}
    }
  }
  if(localized.includes(slug)){
    for(const lang of localized){
      const expectedHref=ORIGIN+'/'+lang;
      if(!h.includes('hreflang="'+lang+'" href="'+expectedHref+'"')) findings.push('HREFLANG_'+lang);
    }
  }
  if(slug==='no'&&h.includes('hreflang='))findings.push('NORWEGIAN_ALIAS_NOT_CANONICAL_CLUSTER');
 }catch(e){findings.push('REQUEST:'+String(e).slice(0,130))}
 return {url,status:findings.length?'FAIL':'PASS',findings};
}
const results=await Promise.all(pages.map(checkPage));
let sitemap={url:ORIGIN+'/sitemap-static.xml',status:'FAIL',findings:[]};
try{
 const r=await fetch(sitemap.url,{signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}});
 const body=await r.text();
 if(!r.ok)sitemap.findings.push('HTTP_'+r.status);
 for(const key of ['/nb','/download'])if(!body.includes('<loc>'+ORIGIN+key+'</loc>'))sitemap.findings.push('MISSING_'+key);
 if(body.includes('<loc>'+ORIGIN+'/no</loc>'))sitemap.findings.push('DUPLICATE_ALIAS_IN_SITEMAP');
 if(body.includes('<loc>'+ORIGIN+'/</loc>'))sitemap.findings.push('NONINDEXABLE_ROOT_IN_SITEMAP');
 sitemap.status=sitemap.findings.length?'FAIL':'PASS';
}catch(e){sitemap.findings.push('REQUEST:'+e)}
for(const item of [...results,sitemap])console.log('LIVE_PUBLIC_SEO '+JSON.stringify(item));
const passed=[...results,sitemap].filter(x=>x.status==='PASS').length;
console.log('LIVE_PUBLIC_SEO_SUMMARY '+JSON.stringify({passed,total:results.length+1,failed:results.length+1-passed}));
if(passed!==results.length+1)process.exitCode=1;
