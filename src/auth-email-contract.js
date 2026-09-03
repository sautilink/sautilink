export const EMAIL_OTP_LENGTH = 8;
export const EMAIL_OTP_MIN_LENGTH = EMAIL_OTP_LENGTH;
export const EMAIL_OTP_MAX_LENGTH = EMAIL_OTP_LENGTH;

export const AUTH_EMAIL_FLOWS = Object.freeze({
  signupConfirmation: Object.freeze({
    template: 'confirmation',
    delivery: 'otp',
    websiteAction: 'enter_otp',
    verifyType: 'email',
    otpLength: EMAIL_OTP_LENGTH,
  }),
  magicLinkOrOtp: Object.freeze({
    template: 'magic_link',
    delivery: 'otp',
    websiteAction: 'enter_otp',
    verifyType: 'email',
    otpLength: EMAIL_OTP_LENGTH,
  }),
  emailChange: Object.freeze({
    template: 'email_change',
    delivery: 'link',
    websiteAction: 'follow_email_change_link',
    verifyType: 'email_change',
  }),
  passwordRecovery: Object.freeze({
    template: 'recovery',
    delivery: 'link',
    websiteAction: 'follow_recovery_link',
    verifyType: 'recovery',
  }),
  reauthentication: Object.freeze({
    template: 'reauthentication',
    delivery: 'otp',
    websiteAction: 'enter_reauthentication_otp',
    otpLength: EMAIL_OTP_LENGTH,
  }),
  invite: Object.freeze({
    template: 'invite',
    delivery: 'link',
    websiteAction: 'follow_invitation_link',
    verifyType: 'invite',
  }),
});

export function normalizeEmailOtp(value) {
  return String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, EMAIL_OTP_LENGTH);
}

export function isValidEmailOtp(value) {
  return new RegExp(`^\\d{${EMAIL_OTP_LENGTH}}$`).test(String(value ?? ''));
}
