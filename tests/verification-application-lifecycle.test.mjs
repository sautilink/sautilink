import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformVerificationCaseFlowSource } from '../scripts/verification-case-flow-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('verification UI locks rejected reapplications for the server-provided 30-day cooldown', async () => {
  const source = await read('src/app.js');
  const transformed = transformVerificationCaseFlowSource('src/app.js', source);

  assert.match(transformed, /reapply_available_at/);
  assert.match(transformed, /cooldown_days_remaining/);
  assert.match(transformed, /can_reapply/);
  assert.match(transformed, /verificationReapplyLocked/);
  assert.match(transformed, /Reapply in/);
  assert.match(transformed, /30-day reapplication period/);
  assert.match(transformed, /VERIFICATION_REAPPLY_COOLDOWN/);
});

test('verification submission confirmation uses the 14-day review window and durable status guidance', async () => {
  const source = await read('src/app.js');
  const transformed = transformVerificationCaseFlowSource('src/app.js', source);

  assert.match(transformed, /We've received your verification request/);
  assert.match(transformed, /usually completed within 14 days/);
  assert.match(transformed, /verification requests are usually reviewed within 14 days/);
  assert.match(transformed, /spam folder/);
  assert.match(transformed, /Verification request received/);
  assert.match(transformed, /normalizeVerificationDialogReviewCopy/);
  assert.match(transformed, /closeVerificationRequestDialog\(\)/);
  assert.match(transformed, /await loadVerificationCaseStatus\(currentMember\)/);
  assert.doesNotMatch(transformed, /72 hours/i);
});

test('social ownership signal appears only with a supplied social handle and remains optional', async () => {
  const source = await read('src/app.js');
  const transformed = transformVerificationCaseFlowSource('src/app.js', source);

  assert.match(transformed, /verification-social-proof-prompt/);
  assert.match(transformed, /sautilink\.com\/verify/);
  assert.match(transformed, /Bio, About or Links section/);
  assert.match(transformed, /does not guarantee approval/);
  assert.match(transformed, /hasSocialHandle = VERIFICATION_SOCIAL_FIELDS\.some/);
  assert.match(transformed, /prompt\.hidden = !hasSocialHandle/);
  assert.match(transformed, /p_social_proof_confirmed: verificationSocialProofSelected\(\)/);
  assert.doesNotMatch(transformed, /verification-social-proof-confirmed[^\n]*required/);
});

test('database migration enforces cooldown, evidence and social-proof priority server-side', async () => {
  const migration = await read('supabase/migrations/20260915235500_verification_application_lifecycle.sql');
  const compatibility = await read('supabase/migrations/20260915235700_fix_verification_social_link_count.sql');
  const combined = `${migration}\n${compatibility}`;

  assert.match(combined, /interval '30 days'/);
  assert.match(combined, /VERIFICATION_REAPPLY_COOLDOWN/);
  assert.match(combined, /VERIFICATION_EVIDENCE_REQUIRED/);
  assert.match(combined, /p_social_proof_confirmed boolean default false/);
  assert.match(combined, /social_proof_link_placed/);
  assert.match(combined, /https:\/\/sautilink\.com\/verify/);
  assert.match(combined, /requested_priority := case when social_proof_confirmed then 'high' else 'normal' end/);
  assert.match(combined, /reapply_available_at/);
  assert.match(combined, /cooldown_days_remaining/);
  assert.match(combined, /can_reapply/);
  assert.match(compatibility, /jsonb_object_keys\(social_links\)/);
});

test('public verification ownership URL has a real explanatory page', async () => {
  const page = await read('verify.html');
  assert.match(page, /<link rel="canonical" href="https:\/\/sautilink\.com\/verify">/);
  assert.match(page, /public ownership signal/i);
  assert.match(page, /sautilink\.com\/verify/);
  assert.match(page, /not a guarantee of verification/i);
  assert.match(page, /usually completed within 14 days/i);
});
