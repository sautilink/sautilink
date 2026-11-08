const SITE_ORIGIN = 'https://sautilink.com';
const LOGO_URL = SITE_ORIGIN + '/logo.png';

const AUTH_SEO = Object.freeze({
  login: Object.freeze({
    url: SITE_ORIGIN + '/login',
    title: 'Log in to SautiLink | SautiLink',
    description: 'Log in to your SautiLink account to connect, share and stay in touch with your community.',
  }),
  signup: Object.freeze({
    url: SITE_ORIGIN + '/signup',
    title: 'Create your SautiLink account | SautiLink',
    description: 'Create your free SautiLink account to share posts, follow people and join communities.',
  }),
});

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function structuredData(metadata) {
  const organization = SITE_ORIGIN + '/#organization';
  const website = SITE_ORIGIN + '/#website';
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organization,
        name: 'SautiLink',
        url: SITE_ORIGIN + '/',
        logo: { '@type': 'ImageObject', url: LOGO_URL },
      },
      {
        '@type': 'WebSite',
        '@id': website,
        url: SITE_ORIGIN + '/',
        name: 'SautiLink',
        publisher: { '@id': organization },
      },
      {
        '@type': 'WebPage',
        '@id': metadata.url + '#webpage',
        url: metadata.url,
        name: metadata.title,
        description: metadata.description,
        inLanguage: 'en',
        isPartOf: { '@id': website },
        publisher: { '@id': organization },
      },
    ],
  }).replaceAll('<', '\\u003c');
}

/**
 * Route-only metadata. The actual authentication UI/markup stays untouched.
 * This must not run for /app, /home, private member routes or public posts.
 */
export function applyAuthRouteSeo(html, mode) {
  const metadata = AUTH_SEO[mode];
  if (!metadata || !/<\/head>/i.test(html)) return html;

  const title = escapeAttribute(metadata.title);
  const description = escapeAttribute(metadata.description);
  const canonical = escapeAttribute(metadata.url);
  const head = [
    '<title>' + title + '</title>',
    '<meta name="description" content="' + description + '">',
    '<meta name="robots" content="noindex, follow">',
    '<link rel="canonical" href="' + canonical + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="SautiLink">',
    '<meta property="og:locale" content="en_US">',
    '<meta property="og:url" content="' + canonical + '">',
    '<meta property="og:title" content="' + title + '">',
    '<meta property="og:description" content="' + description + '">',
    '<meta property="og:image" content="' + LOGO_URL + '">',
    '<meta property="og:image:secure_url" content="' + LOGO_URL + '">',
    '<meta property="og:image:type" content="image/png">',
    '<meta property="og:image:alt" content="SautiLink logo">',
    '<meta name="twitter:card" content="summary">',
    '<meta name="twitter:title" content="' + title + '">',
    '<meta name="twitter:description" content="' + description + '">',
    '<meta name="twitter:image" content="' + LOGO_URL + '">',
    '<meta name="twitter:image:alt" content="SautiLink logo">',
    '<meta name="twitter:site" content="@sautilink">',
    '<script type="application/ld+json" data-seo="SEO_AUTH_ROUTES_20261108">' + structuredData(metadata) + '</script>',
  ].map((line) => '  ' + line).join('\n');

  return html
    // The shared app shell must not retain generic or duplicated route tags.
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>\s*/gi, '')
    .replace(/<meta\s+name=["'](?:description|robots)["'][^>]*>\s*/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, '')
    .replace(/<\/head>/i, head + '\n</head>');
}
