import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformVerificationCaseFlowSource } from '../scripts/verification-case-flow-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('production app build replaces legacy verification email submission with case RPCs', async () => {
  const source = await read('src/app.js');
  const transformed = transformVerificationCaseFlowSource('src/app.js', source);
  const submit = transformed.match(/async function submitVerificationRequest\(event\) \{[\s\S]*?\n\}\n\nfunction updateVerificationRequestState/)?.[0] || '';

  assert.match(submit, /supabase\.rpc\('submit_verification_case'/);
  assert.match(submit, /p_legal_name:/);
  assert.match(submit, /p_public_name:/);
  assert.match(submit, /p_account_category:/);
  assert.match(submit, /p_country:/);
  assert.match(submit, /p_social_links:/);
  assert.match(submit, /p_article_links:/);
  assert.match(submit, /p_reason:/);
  assert.match(submit, /p_terms_accepted:/);
  assert.doesNotMatch(submit, /mailto:team@sautilink\.com/);
});

test('member verification status reads the Phase 2 case and exposes staff feedback states', async () => {
  const source = await read('src/app.js');
  const transformed = transformVerificationCaseFlowSource('src/app.js', source);

  assert.match(transformed, /supabase\.rpc\('get_my_verification_case'\)/);
  assert.match(transformed, /Verification pending/);
  assert.match(transformed, /Under review/);
  assert.match(transformed, /More information needed/);
  assert.match(transformed, /Request verification again/);
  assert.match(transformed, /Update verification request/);
  assert.match(transformed, /staff_message/);
  assert.match(transformed, /refreshVerifiedProfileFromCase/);
});

test('verification case bridge stays browser-safe and is wired into the canonical build', async () => {
  const [source, build] = await Promise.all([
    read('src/app.js'),
    read('scripts/build-app.mjs'),
  ]);
  const transformed = transformVerificationCaseFlowSource('src/app.js', source);

  assert.match(build, /transformVerificationCaseFlowSource/);
  assert.match(build, /verification-case-flow-source-transform\.mjs/);
  assert.doesNotMatch(transformed, /SUPABASE_SERVICE_ROLE_KEY|sb_secret_|service_role/i);
  assert.doesNotMatch(transformed, /government[_-]?id[^\n]*(upload|file)/i);
});

test('production release builder cannot bypass the Phase 2 verification bridge', async () => {
  const productionBuild = await read('scripts/build-production-release.mjs');

  assert.match(productionBuild, /import \{ transformVerificationCaseFlowSource \} from '\.\/verification-case-flow-source-transform\.mjs';/);
  assert.match(productionBuild, /if \(file === productionAppSource\) \{\s*output = transformVerificationCaseFlowSource\(file, output\);\s*\}/s);
  assert.match(productionBuild, /APP_JS_FEATURE_RELEASE = '20260919-mobilesettings1'/);
});
