export function transformMessagesDurableRealtimeSource(filePath, source) {
  if (!String(filePath || '').endsWith('app.js')) return source;
  if (source.includes('__sautilinkDmRealtimeContext')) return source;

  const marker = '\nfunction motionBehavior() {';
  if (!source.includes(marker)) {
    throw new Error('Messages Durable realtime transform could not find the app bootstrap marker.');
  }

  const bridge = `
window.__sautilinkDmRealtimeContext = () => ({
  conversationId: String(activeConversation?.id || ''),
  memberId: String(currentMemberId || ''),
  blocked: Boolean(activeConversation?.blockedByYou),
  activityEnabled: Boolean(activityStatusEnabled()),
});
window.__sautilinkDmRealtimeAuthHeaders = currentAuthorizationHeader;
`;

  return source.replace(marker, `${bridge}${marker}`);
}
