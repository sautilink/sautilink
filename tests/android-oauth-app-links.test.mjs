import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const configure = read('scripts/configure-android-release.mjs');
const oauthSource = read('src/social-oauth-auth.js');
const assetLinks = JSON.parse(read('.well-known/assetlinks.json'));

test('social OAuth keeps the canonical HTTPS callback used by Android App Links', () => {
  assert.match(oauthSource, /SOCIAL_OAUTH_REDIRECT = 'https:\/\/sautilink\.com\/home'/);
  assert.match(oauthSource, /redirectTo: SOCIAL_OAUTH_REDIRECT/);
});

test('Android manifest patch declares a verified SautiLink home App Link', () => {
  assert.match(configure, /android:autoVerify=\"true\"/);
  assert.match(configure, /android:scheme=\"https\"/);
  assert.match(configure, /android:host=\"sautilink\.com\"/);
  assert.match(configure, /android:pathPrefix=\"\/home\"/);
  assert.match(configure, /android\.intent\.category\.BROWSABLE/);
});

test('native callback accepts only SautiLink OAuth-result URLs before loading the WebView', () => {
  assert.match(configure, /APP_LINK_SCHEME = \"https\"/);
  assert.match(configure, /APP_LINK_HOST = \"sautilink\.com\"/);
  assert.match(configure, /OAUTH_CALLBACK_PATH = \"\/home\"/);
  assert.match(configure, /Intent\.ACTION_VIEW/);
  assert.match(configure, /getQueryParameter\(\"code\"\)/);
  assert.match(configure, /hasFragmentParameter\(uri, \"access_token\"\)/);
  assert.match(configure, /getBridge\(\)\.getWebView\(\)\.loadUrl\(target\)/);
});

test('Digital Asset Links binds sautilink.com to the production Android signing identity', () => {
  assert.ok(Array.isArray(assetLinks));
  assert.equal(assetLinks.length, 1);
  assert.deepEqual(assetLinks[0].relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(assetLinks[0].target?.namespace, 'android_app');
  assert.equal(assetLinks[0].target?.package_name, 'com.sautilink.app');
  assert.deepEqual(assetLinks[0].target?.sha256_cert_fingerprints, [
    '31:C7:73:A7:22:9A:56:3D:92:F7:04:7A:56:73:5A:D7:B0:20:27:D2:7A:6E:02:0D:89:23:DD:54:18:F4:B5:0F',
  ]);
});
