/**
 * SautiLink self-XSS awareness notice.
 * Informational only: this does not prevent Developer Tools or execute a security check.
 * Keep console output intact for legitimate debugging.
 */
(() => {
  'use strict';

  if (typeof console === 'undefined' || typeof console.log !== 'function') return;

  console.log(
    '%cStop!',
    'color: #e32636; font-family: Inter, system-ui, sans-serif; font-size: 56px; font-weight: 900; line-height: 1.2;'
  );
  console.log(
    '%cProtect your SautiLink account.',
    'color: #e32636; font-family: Inter, system-ui, sans-serif; font-size: 19px; font-weight: 800;'
  );
  console.log(
    '%cThis console is intended for developers. Never paste code you do not understand, even if someone promises free features, verification, followers or account recovery.',
    'font-family: Inter, system-ui, sans-serif; font-size: 14px; line-height: 1.6;'
  );
  console.log(
    '%cUnknown scripts can compromise your account and personal information. If you were instructed to paste something here, stop and contact support: https://sautilink.com/help',
    'font-family: Inter, system-ui, sans-serif; font-size: 13px; font-weight: 600; line-height: 1.6;'
  );
})();
