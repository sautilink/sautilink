/**
 * Applies to the already transformed member bootstrap source in both preview
 * and production builds. A cached member profile must never bypass MFA.
 */
export function transformTotpMfaSource(sourcePath, source) {
  if (!sourcePath.endsWith('app.js')) return source;

  const change = (before, after, label) => {
    if (source.split(before).length !== 2) throw new Error('MFA hook missing: ' + label);
    source = source.replace(before, after);
  };

  change(
    "import { mountInlineVerificationSvg, refreshClonedVerificationSvgs } from './verification-inline-svg.js';",
    "import { createTotpMfaController } from './mfa-totp.js';\nimport { mountInlineVerificationSvg, refreshClonedVerificationSvgs } from './verification-inline-svg.js';",
    'import',
  );

  change(
    "const byId = (id) => document.getElementById(id);",
    `const byId = (id) => document.getElementById(id);
const mfaController = createTotpMfaController({
  auth: supabase.auth,
  onUnlocked: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data?.user) void loadMember(data.user);
  },
});`,
    'controller',
  );

  change(
    'function renderMember(profile, userId = currentMemberId) {',
    `function renderMember(profile, userId = currentMemberId) {
  // The startup cache cannot authorize a member without a current AAL check.
  if (!mfaController.isUnlockedFor(userId || profile?.id || currentMemberId)) {
    void mfaController.guard({ id: userId || profile?.id || currentMemberId }, { resumeOnSuccess: true });
    return;
  }
  void mfaController.refreshSettings();`,
    'cached shell admission',
  );

  change(
    `async function loadMember(user) {
  const userId = String(user?.id || '');`,
    `async function loadMember(user) {
  const userId = String(user?.id || '');
  // Verify AAL before beginning feed, account or profile requests.
  if (!await mfaController.guard(user)) return;`,
    'member load admission',
  );

  change(
    "  if (event === 'SIGNED_OUT') {",
    "  if (event === 'SIGNED_OUT') {\n    mfaController.reset();",
    'signed-out reset',
  );

  return source;
}
