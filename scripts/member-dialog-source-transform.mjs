const APP_SOURCE = /(?:^|\/)app\.js$/;
const ROOM_SOURCE = /(?:^|\/)rooms-platform\.js$/;

const APP_CALLS = [
  ['prompt', '`Optional review note to ${verb} this name change:`', "{ cancelLabel: 'Skip note' }"],
  ['prompt', "action === 'appeal_reversed'\n    ? 'Reason for reversing this moderation decision:'\n    : 'Reason for upholding this moderation decision:'"],
  ['confirm', "'Delete this comment? This cannot be undone.'"],
  ['confirm', "'Delete this post? This cannot be undone.'"],
  ['confirm', '`Mute @${username}? Their posts, reposts and notifications will be hidden from you. Following and direct messages stay available.`'],
  ['confirm', "`Block @${username}? You will no longer see each other's posts or interactions, new direct messages will stop, and existing follows between you will be removed.`"],
  ['confirm', "'Delete this message for both people? This cannot be undone.'"],
  ['confirm', "'Delete this conversation from your inbox? This only hides it for you. A new message will make it appear again.'"],
  ['confirm', '`Mute @${username}? Messages will still arrive, but this conversation will not add to your unread badge and their public activity will be hidden from your feeds.`'],
  ['confirm', '`Block @${username}? Existing message history stays visible, but new messages between you will stop.`'],
  ['confirm', "'Remove this member from the Room?'"],
];
const ROOM_CALLS = [['confirm', '`Remove ${profileLabel(profile)} from this Room?`']];

export function transformMemberDialogSource(filePath, source) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  const calls = APP_SOURCE.test(normalized) ? APP_CALLS : ROOM_SOURCE.test(normalized) ? ROOM_CALLS : null;
  if (!calls) return source;
  if (!/window\.(?:confirm|prompt)\(/.test(source) && source.includes('window.SautiMemberDialogs.')) return source;
  let result = source;
  for (const [kind, argument, options] of calls) {
    const original = `window.${kind}(${argument})`;
    if (result.split(original).length !== 2) throw new Error(`Member dialog transform could not uniquely locate ${original}`);
    result = result.replace(original, `(await window.SautiMemberDialogs.${kind}(${argument}${options ? `, ${options}` : ''}))`);
  }
  if (/window\.(?:confirm|prompt)\(/.test(result)) throw new Error('Member dialog transform found an unhandled native dialog.');
  return result;
}
