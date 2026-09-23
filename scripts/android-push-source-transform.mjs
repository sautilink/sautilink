const BRIDGE_MARKER = '// SAUTILINK_ANDROID_PUSH_BRIDGE';
const SIGNOUT_MARKER = '// SAUTILINK_ANDROID_PUSH_SIGNOUT';

export function transformAndroidPushSource(filePath, source) {
  if (!String(filePath || '').endsWith('app.js')) return source;

  let output = source;

  if (!output.includes(BRIDGE_MARKER)) {
    const anchor = "const byId = (id) => document.getElementById(id);";
    if (!output.includes(anchor)) {
      throw new Error('Android push transform could not find the Supabase client anchor');
    }

    const bridge = `${BRIDGE_MARKER}\nglobalThis.__sautilinkPushBridge = {\n  getSession: () => supabase.auth.getSession(),\n  onAuthStateChange: (callback) => supabase.auth.onAuthStateChange(callback),\n  rpc: (name, args) => supabase.rpc(name, args),\n};\n\n`;
    output = output.replace(anchor, `${bridge}${anchor}`);
  }

  if (!output.includes(SIGNOUT_MARKER)) {
    const signOutAnchor = "  const { error } = await supabase.auth.signOut();";
    if (!output.includes(signOutAnchor)) {
      throw new Error('Android push transform could not find the sign-out anchor');
    }

    output = output.replace(
      signOutAnchor,
      `  ${SIGNOUT_MARKER}\n  await Promise.allSettled(Array.from(globalThis.__sautilinkPushCleanupHooks || [], (cleanup) => cleanup()));\n${signOutAnchor}`,
    );
  }

  return output;
}
