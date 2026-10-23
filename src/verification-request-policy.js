export const VERIFICATION_ACCOUNT_TYPES = Object.freeze(['individual', 'business', 'brand', 'entity', 'organisation']);

export function verificationAccountType(value) {
  return VERIFICATION_ACCOUNT_TYPES.includes(value) ? value : 'individual';
}

export function verificationEvidenceReady(type, socialHandles, articleLinks) {
  return verificationAccountType(type) === 'individual'
    ? socialHandles.some(Boolean) || articleLinks.length > 0
    : articleLinks.length > 0;
}
