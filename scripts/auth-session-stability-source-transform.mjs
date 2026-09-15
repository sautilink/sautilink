export function transformAuthSessionStabilitySource(sourcePath, source) {
  if (!sourcePath.endsWith('app.js')) return source;

  const anchor = `    window.setTimeout(() => loadMember(session.user), 0);\n  }\n});`;
  if (!source.includes(anchor)) {
    throw new Error('Could not find the SautiLink signed-in session refresh block.');
  }

  return source.replace(anchor, `    if (currentMemberId && currentMemberId === session.user.id) {\n      currentAccountEmail = normalizeEmail(session.user.email || currentAccountEmail);\n      syncAccountSecurityEmail();\n      return;\n    }\n    window.setTimeout(() => loadMember(session.user), 0);\n  }\n});`);
}
