export function normalizeOtpPhone(value) {
  const phone = String(value || '').trim().replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return '';
  // Tanzanian mobile numbers have exactly nine digits after +255.
  if (phone.startsWith('+255') && !/^\+255[67]\d{8}$/.test(phone)) return '';
  return phone;
}

export function otpPhoneError(value) {
  const phone = String(value || '').trim().replace(/[\s()-]/g, '');
  if (phone.startsWith('+255') && !/^\+255[67]\d{8}$/.test(phone)) {
    return 'For Tanzania, enter +255 followed by exactly 9 mobile digits (for example +255712345678). Check the number and try again.';
  }
  return 'Enter a valid phone number including the + country code.';
}
