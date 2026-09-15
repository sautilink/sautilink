const FLOW_MARKER = 'PHASE2_VERIFICATION_CASE_FLOW';

const SUBMIT_PATTERN = /function submitVerificationRequest\(event\) \{[\s\S]*?\n\}\n\nfunction updateVerificationRequestState/;

const STATUS_ANCHOR = "  if (verified) applyVerificationBadgeAsset(badge, profile?.verification_badge_type);";
const HELPER_ANCHOR = 'function verificationRequestEmailBody() {';
const OPEN_DIALOG_ANCHOR = `function openVerificationRequestDialog() {
  if (!currentMember || currentMember.is_verified) return;`;
const SYNC_STATE_ANCHOR = `function syncVerificationRequestState() {
  const form = byId('verification-request-form');`;

const helperSource = `// PHASE2_VERIFICATION_CASE_FLOW
let currentVerificationCase = null;
let verificationCaseRequest = 0;

function normalizedVerificationCase(value) {
  if (!value || typeof value !== 'object') return null;
  const cooldownDays = Number(value.cooldown_days_remaining);
  return {
    ...value,
    status: String(value.status || value.case_status || '').trim().toLowerCase(),
    case_number: String(value.case_number || '').trim(),
    staff_message: String(value.staff_message || '').trim(),
    reapply_available_at: String(value.reapply_available_at || '').trim(),
    cooldown_days_remaining: Number.isFinite(cooldownDays) ? Math.max(0, Math.ceil(cooldownDays)) : 0,
    can_reapply: value.can_reapply === true,
  };
}

function verificationReapplyLocked(caseItem) {
  if (caseItem?.status !== 'rejected' || caseItem?.can_reapply === true) return false;
  const availableAt = Date.parse(caseItem?.reapply_available_at || '');
  if (Number.isFinite(availableAt)) return Date.now() < availableAt;
  return Number(caseItem?.cooldown_days_remaining || 0) > 0;
}

function verificationReapplyDate(caseItem) {
  const value = Date.parse(caseItem?.reapply_available_at || '');
  if (!Number.isFinite(value)) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(value));
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
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
  const reference = caseItem?.case_number ? ' Reference: ' + caseItem.case_number + '.' : '';
  if (state === 'submitted') return "We've received your verification request." + reference + ' Due to request volume, reviews are usually completed within 14 days. Return to this Verification section to check your status, or watch your email for updates — including your spam folder.';
  if (state === 'reviewing') return 'Your verification request is being reviewed.' + reference + ' Most reviews are completed within 14 days. Return here for status updates and keep an eye on your email, including your spam folder.';
  if (state === 'action_required') return message
    ? 'More information is required: ' + message
    : 'More information is required before we can continue reviewing your request.';
  if (state === 'rejected') {
    const rejectedCopy = message
      ? 'Verification was not approved: ' + message
      : 'Your latest verification request was not approved.';
    if (verificationReapplyLocked(caseItem)) {
      const availableDate = verificationReapplyDate(caseItem);
      const days = Number(caseItem?.cooldown_days_remaining || 0);
      const remaining = days > 0 ? ' ' + days + ' day' + (days === 1 ? '' : 's') + ' remaining.' : '';
      return rejectedCopy + ' You can submit a new verification request after the 30-day reapplication period' + (availableDate ? ', on ' + availableDate : '') + '.' + remaining;
    }
    return rejectedCopy + ' The 30-day reapplication period has ended, so you can submit a new request with updated or stronger public evidence.';
  }
  if (state === 'approved') return message || 'Your verification request was approved. Your badge is being applied to your account.';
  return 'You can request verification below. Due to request volume, reviews are usually completed within 14 days.';
}

function renderVerificationCaseStatus(profile = currentMember, caseValue = currentVerificationCase) {
  const status = byId('settings-verification-status');
  const badge = byId('settings-verification-badge');
  const request = byId('settings-verification-request');
  const note = byId('settings-verification-note');
  if (!status || !badge || !request || !note) return;

  const caseItem = normalizedVerificationCase(caseValue);
  const verified = Boolean(profile?.is_verified) || caseItem?.status === 'approved';
  const cooldownLocked = verificationReapplyLocked(caseItem);
  status.textContent = verified ? 'Verified' : verificationCaseStatusCopy(caseItem);
  status.classList.toggle('verified', verified);
  badge.hidden = !Boolean(profile?.is_verified);
  if (profile?.is_verified) applyVerificationBadgeAsset(badge, profile?.verification_badge_type);

  request.disabled = false;
  request.removeAttribute('aria-disabled');
  request.removeAttribute('title');

  if (verified) {
    request.hidden = true;
    note.textContent = caseItem?.staff_message || 'Your account currently has an active SautiLink verification badge.';
    return;
  }

  if (caseItem?.status === 'submitted' || caseItem?.status === 'reviewing') {
    request.hidden = true;
  } else {
    request.hidden = false;
    if (cooldownLocked) {
      const days = Number(caseItem?.cooldown_days_remaining || 0);
      const availableDate = verificationReapplyDate(caseItem);
      request.textContent = days > 0
        ? 'Reapply in ' + days + ' day' + (days === 1 ? '' : 's')
        : 'Reapplication locked';
      request.disabled = true;
      request.setAttribute('aria-disabled', 'true');
      if (availableDate) request.title = 'You can request verification again on ' + availableDate;
    } else {
      request.textContent = caseItem?.status === 'action_required'
        ? 'Update verification request'
        : caseItem?.status === 'rejected'
          ? 'Request verification again'
          : 'Request verification';
    }
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

function verificationSocialProofSelected() {
  const checkbox = byId('verification-social-proof-confirmed');
  return Boolean(checkbox?.checked && !checkbox.closest('[hidden]'));
}

function ensureVerificationSocialProofPrompt() {
  let prompt = byId('verification-social-proof-prompt');
  if (prompt) return prompt;
  const form = byId('verification-request-form');
  const grid = form?.querySelector('.verification-social-grid');
  if (!form || !grid) return null;

  prompt = document.createElement('aside');
  prompt.id = 'verification-social-proof-prompt';
  prompt.className = 'verification-id-note verification-social-proof-prompt';
  prompt.hidden = true;

  const title = document.createElement('strong');
  title.textContent = 'Speed up ownership checks (optional)';

  const copy = document.createElement('span');
  copy.textContent = 'Add sautilink.com/verify to the Bio, About or Links section of at least one social account you listed above. This gives reviewers an extra public ownership signal; requests with this signal may be reviewed sooner or prioritised in the queue, but it does not guarantee approval.';

  const confirm = document.createElement('label');
  confirm.className = 'verification-consent';
  const checkbox = document.createElement('input');
  checkbox.id = 'verification-social-proof-confirmed';
  checkbox.name = 'socialProofConfirmed';
  checkbox.type = 'checkbox';
  const confirmText = document.createElement('span');
  confirmText.textContent = 'I added sautilink.com/verify to at least one social profile listed above.';
  confirm.append(checkbox, confirmText);
  prompt.append(title, copy, confirm);
  grid.insertAdjacentElement('afterend', prompt);
  return prompt;
}

function syncVerificationSocialProofPrompt() {
  const prompt = ensureVerificationSocialProofPrompt();
  if (!prompt) return;
  const hasSocialHandle = VERIFICATION_SOCIAL_FIELDS.some(([id]) => Boolean(verificationSocialHandle(byId(id)?.value)));
  prompt.hidden = !hasSocialHandle;
  const checkbox = byId('verification-social-proof-confirmed');
  if (!hasSocialHandle && checkbox) checkbox.checked = false;
}

function verificationSubmissionError(error) {
  const message = String(error?.message || '');
  if (message.includes('ALREADY_VERIFIED')) return 'This account is already verified.';
  if (message.includes('AUTH_REQUIRED')) return 'Sign in again before sending a verification request.';
  if (message.includes('PROFILE_UNAVAILABLE')) return 'Your SautiLink profile is unavailable. Refresh and try again.';
  if (message.includes('VERIFICATION_REAPPLY_COOLDOWN')) return 'Your previous request is still in the 30-day reapplication period. Return to Verification settings to see when you can apply again.';
  if (message.includes('VERIFICATION_EVIDENCE_REQUIRED')) return 'Add at least one social profile or article link.';
  if (message.includes('VERIFICATION_REASON_INVALID')) return 'Add a verification reason between 20 and 2,000 characters.';
  if (message.includes('SOCIAL_LINKS_INVALID')) return 'Check the social profile usernames and try again.';
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
      p_social_proof_confirmed: verificationSocialProofSelected(),
    });
    if (error) throw error;

    currentVerificationCase = normalizedVerificationCase(data);
    renderVerificationCaseStatus(currentMember, currentVerificationCase);
    const caseNumber = currentVerificationCase?.case_number;
    const wasResubmitted = String(data?.status || '').toLowerCase() === 'resubmitted';
    settingsMessage(
      caseNumber
        ? (wasResubmitted ? 'Verification information updated · ' : 'Verification request received · ') + caseNumber
        : (wasResubmitted ? 'Verification information updated.' : 'Verification request received.'),
      'success',
    );
    closeVerificationRequestDialog();
    await loadVerificationCaseStatus(currentMember);
  } catch (error) {
    setMessage(byId('verification-request-message'), verificationSubmissionError(error), 'error');
    if (String(error?.message || '').includes('VERIFICATION_REAPPLY_COOLDOWN')) {
      await loadVerificationCaseStatus(currentMember);
    }
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
  if (!source.includes(OPEN_DIALOG_ANCHOR)) {
    throw new Error(`Verification case transform could not find dialog anchor in ${sourcePath}`);
  }
  if (!source.includes(SYNC_STATE_ANCHOR)) {
    throw new Error(`Verification case transform could not find state-sync anchor in ${sourcePath}`);
  }
  if (!SUBMIT_PATTERN.test(source)) {
    throw new Error(`Verification case transform could not find submit flow in ${sourcePath}`);
  }

  let output = source.replace(
    STATUS_ANCHOR,
    `  if (verified) {\n    currentVerificationCase = null;\n    applyVerificationBadgeAsset(badge, profile?.verification_badge_type);\n  } else if (!loading) {\n    void loadVerificationCaseStatus(profile);\n  }`,
  );
  output = output.replace(HELPER_ANCHOR, `${helperSource}\n${HELPER_ANCHOR}`);
  output = output.replace(
    OPEN_DIALOG_ANCHOR,
    `${OPEN_DIALOG_ANCHOR}\n  if (verificationReapplyLocked(currentVerificationCase)) {\n    renderVerificationCaseStatus(currentMember, currentVerificationCase);\n    return;\n  }`,
  );
  output = output.replace(
    SYNC_STATE_ANCHOR,
    `${SYNC_STATE_ANCHOR}\n  syncVerificationSocialProofPrompt();`,
  );
  output = output.replace(SUBMIT_PATTERN, replacementSubmit);
  return output;
}
