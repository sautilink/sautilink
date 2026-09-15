const FLOW_MARKER = 'PHASE2_VERIFICATION_CASE_FLOW';

const SUBMIT_PATTERN = /function submitVerificationRequest\(event\) \{[\s\S]*?\n\}\n\nfunction updateVerificationRequestState/;

const STATUS_ANCHOR = "  if (verified) applyVerificationBadgeAsset(badge, profile?.verification_badge_type);";
const HELPER_ANCHOR = 'function verificationRequestEmailBody() {';

const helperSource = `// PHASE2_VERIFICATION_CASE_FLOW
let currentVerificationCase = null;
let verificationCaseRequest = 0;

function normalizedVerificationCase(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    ...value,
    status: String(value.status || value.case_status || '').trim().toLowerCase(),
    case_number: String(value.case_number || '').trim(),
    staff_message: String(value.staff_message || '').trim(),
  };
}

function verificationCaseStatusCopy(caseItem) {
  const state = caseItem?.status || '';
  if (state === 'submitted') return 'Verification pending';
  if (state === 'reviewing') return 'Under review';
  if (state === 'action_required') return 'More information needed';
  if (state === 'rejected') return 'Not approved';
  if (state === 'approved') return 'Approved';
  return 'Unverified';
}

function verificationCaseNote(caseItem) {
  const state = caseItem?.status || '';
  const message = caseItem?.staff_message || '';
  if (state === 'submitted') return 'Your verification request has been received and is waiting for review.';
  if (state === 'reviewing') return 'Your verification request is currently being reviewed by the SautiLink team.';
  if (state === 'action_required') return message
    ? 'More information is required: ' + message
    : 'More information is required before we can continue reviewing your request.';
  if (state === 'rejected') return message
    ? 'Verification was not approved: ' + message
    : 'Your latest verification request was not approved. You can submit a new request with stronger public evidence.';
  if (state === 'approved') return message || 'Your verification request was approved. Your badge is being applied to your account.';
  return 'You can request review below. We return feedback within 72 hours.';
}

function renderVerificationCaseStatus(profile = currentMember, caseValue = currentVerificationCase) {
  const status = byId('settings-verification-status');
  const badge = byId('settings-verification-badge');
  const request = byId('settings-verification-request');
  const note = byId('settings-verification-note');
  if (!status || !badge || !request || !note) return;

  const caseItem = normalizedVerificationCase(caseValue);
  const verified = Boolean(profile?.is_verified) || caseItem?.status === 'approved';
  status.textContent = verified ? 'Verified' : verificationCaseStatusCopy(caseItem);
  status.classList.toggle('verified', verified);
  badge.hidden = !Boolean(profile?.is_verified);
  if (profile?.is_verified) applyVerificationBadgeAsset(badge, profile?.verification_badge_type);

  if (verified) {
    request.hidden = true;
    note.textContent = caseItem?.staff_message || 'Your account currently has an active SautiLink verification badge.';
    return;
  }

  if (caseItem?.status === 'submitted' || caseItem?.status === 'reviewing') {
    request.hidden = true;
  } else {
    request.hidden = false;
    request.textContent = caseItem?.status === 'action_required'
      ? 'Update verification request'
      : caseItem?.status === 'rejected'
        ? 'Request verification again'
        : 'Request verification';
  }
  note.textContent = verificationCaseNote(caseItem);
}

async function refreshVerifiedProfileFromCase(caseItem) {
  if (caseItem?.status !== 'approved' || !currentMemberId) return null;
  const { data, error } = await supabase
    .from('social_profiles')
    .select('id, username, display_name, avatar_key, updated_at, is_verified, verification_badge_type')
    .eq('id', currentMemberId)
    .maybeSingle();
  if (error || !data) return null;
  currentMember = { ...currentMember, ...data };
  return currentMember;
}

async function loadVerificationCaseStatus(profile = currentMember) {
  if (!currentMemberId) return null;
  if (profile?.is_verified) {
    currentVerificationCase = null;
    renderVerificationCaseStatus(profile, null);
    return null;
  }

  const requestId = ++verificationCaseRequest;
  const { data, error } = await supabase.rpc('get_my_verification_case');
  if (requestId !== verificationCaseRequest) return null;
  if (error) {
    renderVerificationCaseStatus(profile, currentVerificationCase);
    return null;
  }

  currentVerificationCase = normalizedVerificationCase(data);
  const refreshedProfile = await refreshVerifiedProfileFromCase(currentVerificationCase);
  if (requestId !== verificationCaseRequest) return currentVerificationCase;
  renderVerificationCaseStatus(refreshedProfile || profile, currentVerificationCase);
  return currentVerificationCase;
}

function verificationSubmissionError(error) {
  const message = String(error?.message || '');
  if (message.includes('ALREADY_VERIFIED')) return 'This account is already verified.';
  if (message.includes('AUTH_REQUIRED')) return 'Sign in again before sending a verification request.';
  if (message.includes('PROFILE_UNAVAILABLE')) return 'Your SautiLink profile is unavailable. Refresh and try again.';
  if (message.includes('VERIFICATION_REASON_INVALID')) return 'Add a verification reason between 20 and 2,000 characters.';
  if (message.includes('ARTICLE_LINKS_INVALID')) return 'Use up to five complete http:// or https:// article links.';
  if (message.includes('VERIFICATION_CONSENT_REQUIRED')) return 'Accept the Privacy Policy and Terms before sending your request.';
  return 'Your verification request could not be sent. Please try again.';
}

window.addEventListener('focus', () => {
  if (currentMemberId && !currentMember?.is_verified) void loadVerificationCaseStatus(currentMember);
});
`;

const replacementSubmit = `async function submitVerificationRequest(event) {
  event.preventDefault();
  const form = byId('verification-request-form');
  const send = byId('verification-request-send');
  form.dataset.evidenceTouched = 'true';
  syncVerificationRequestState();
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  if (send.disabled) {
    byId('verification-evidence-message').hidden = false;
    return;
  }

  const socialLinks = {};
  VERIFICATION_SOCIAL_FIELDS.forEach(([id, label, prefix]) => {
    const handle = verificationSocialHandle(byId(id)?.value);
    if (handle) socialLinks[label.toLowerCase()] = prefix + handle;
  });

  send.disabled = true;
  send.setAttribute('aria-disabled', 'true');
  setMessage(byId('verification-request-message'), 'Sending your verification request…', '');

  try {
    const { data, error } = await supabase.rpc('submit_verification_case', {
      p_legal_name: byId('verification-legal-name').value.trim(),
      p_public_name: byId('verification-famous-name').value.trim() || null,
      p_account_category: byId('verification-category').value,
      p_country: byId('verification-country').value.trim(),
      p_social_links: socialLinks,
      p_article_links: verificationArticleLinks(),
      p_reason: byId('verification-reason').value.trim(),
      p_terms_accepted: Boolean(byId('verification-consent').checked),
    });
    if (error) throw error;

    currentVerificationCase = normalizedVerificationCase(data);
    renderVerificationCaseStatus(currentMember, currentVerificationCase);
    const caseNumber = currentVerificationCase?.case_number;
    const wasResubmitted = String(data?.status || '').toLowerCase() === 'resubmitted';
    settingsMessage(
      caseNumber
        ? (wasResubmitted ? 'Verification information updated · ' : 'Verification request sent · ') + caseNumber
        : (wasResubmitted ? 'Verification information updated.' : 'Verification request sent.'),
      'success',
    );
    closeVerificationRequestDialog();
    await loadVerificationCaseStatus(currentMember);
  } catch (error) {
    setMessage(byId('verification-request-message'), verificationSubmissionError(error), 'error');
  } finally {
    syncVerificationRequestState();
  }
}

function updateVerificationRequestState`;

export function transformVerificationCaseFlowSource(sourcePath, source) {
  if (source.includes(FLOW_MARKER)) return source;
  if (!source.includes(STATUS_ANCHOR)) {
    throw new Error(`Verification case transform could not find status anchor in ${sourcePath}`);
  }
  if (!source.includes(HELPER_ANCHOR)) {
    throw new Error(`Verification case transform could not find helper anchor in ${sourcePath}`);
  }
  if (!SUBMIT_PATTERN.test(source)) {
    throw new Error(`Verification case transform could not find submit flow in ${sourcePath}`);
  }

  let output = source.replace(
    STATUS_ANCHOR,
    `  if (verified) {\n    currentVerificationCase = null;\n    applyVerificationBadgeAsset(badge, profile?.verification_badge_type);\n  } else if (!loading) {\n    void loadVerificationCaseStatus(profile);\n  }`,
  );
  output = output.replace(HELPER_ANCHOR, `${helperSource}\n${HELPER_ANCHOR}`);
  output = output.replace(SUBMIT_PATTERN, replacementSubmit);
  return output;
}
