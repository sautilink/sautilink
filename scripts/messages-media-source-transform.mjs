const AUTH_HELPER_MARKER = `async function currentAuthorizationHeader() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) return {};
  return { Authorization: \`Bearer \${session.access_token}\` };
}
`;

const MESSAGES_AUTH_BRIDGE = `${AUTH_HELPER_MARKER}\nwindow.__sautilinkMessagesAuthorizationHeaders = currentAuthorizationHeader;\nwindow.__sautilinkDmRealtimeAuthHeaders = currentAuthorizationHeader;\nwindow.__sautilinkDmRealtimeContext = () => ({\n  conversationId: String(activeConversation?.id || ''),\n  activityEnabled: Boolean(activityStatusEnabled()),\n  blocked: Boolean(activeConversation?.blockedByYou),\n});\n`;

export function transformMessagesMediaSource(file, source) {
  if (!String(file).endsWith('app.js')) return source;
  if (source.includes('window.__sautilinkMessagesAuthorizationHeaders = currentAuthorizationHeader;')) return source;
  if (!source.includes(AUTH_HELPER_MARKER)) {
    throw new Error('Messages media source transform could not find the authorization helper marker.');
  }
  return source.replace(AUTH_HELPER_MARKER, MESSAGES_AUTH_BRIDGE);
}
