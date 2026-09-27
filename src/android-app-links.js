// Keep this identity in sync with /.well-known/assetlinks.json on the primary host.
export const APP_LINK_HOSTS = new Set([
  'sautilink.com',
  'www.sautilink.com',
  'router.sautilink.com',
  'cloudengine.sautilink.com',
  'www.router.sautilink.com',
  'wifi.sautilink.com',
  'business.sautilink.com',
  'tz.sautilink.com',
  'mobile.sautilink.com',
]);

export const ANDROID_ASSET_LINKS = [{
  relation: ['delegate_permission/common.handle_all_urls'],
  target: {
    namespace: 'android_app',
    package_name: 'com.sautilink.app',
    sha256_cert_fingerprints: [
      '31:C7:73:A7:22:9A:56:3D:92:F7:04:7A:56:73:5A:D7:B0:20:27:D2:7A:6E:02:0D:89:23:DD:54:18:F4:B5:0F',
    ],
  },
}];

export function androidAssetLinksResponse(request, url) {
  if (url.pathname !== '/.well-known/assetlinks.json' || !APP_LINK_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(ANDROID_ASSET_LINKS), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
