/* Add a branded first step while retaining the existing device share action. */
export function transformMemberShareSource(filePath, source) {
  const path = String(filePath || '').replaceAll('\\', '/');
  if (!/(?:^|\/)(?:app|rooms-facebook-ui)\.js$/.test(path) || source.includes('const memberShareChoice =')) return source;
  let output = source;
  if (/(?:^|\/)app\.js$/.test(path)) {
    for (const [name, label] of [['shareSautiLink', 'post'], ['shareShortVideoLink', 'video']]) {
      const start = output.indexOf(`async function ${name}(`);
      if (start < 0) throw new Error(`Member share transform could not find ${name}.`);
      const end = output.indexOf('\n}\n', start);
      const body = output.slice(start, end);
      const marker = '    if (navigator.share) {';
      if (!body.includes(marker)) throw new Error(`Member share transform could not find ${name} actions.`);
      const replacement = `    const memberShareChoice = await window.SautiMemberDialogs.choose('Choose how to share this ${label}.', [
      { value: 'copy', label: 'Copy link', description: 'Paste it into a message or another app.', icon: 'attachment-0-1' },
      ...(navigator.share ? [{ value: 'device', label: 'More apps', description: 'Open sharing options on your device.', icon: 'share-0-1' }] : []),
    ], { title: 'Share ${label}' });
    if (!memberShareChoice) return;
    if (memberShareChoice === 'device' && navigator.share) {`;
      const restoreFocus = `if (button?.isConnected && !button.closest('[hidden]') && !document.body.classList.contains('auth-entry') && !document.getElementById('member-view')?.hidden) button.focus({ preventScroll: true });`;
      const updated = body.replace(marker, replacement)
        .replace(/(    (?:if \(button\) )?button\.disabled = false;)/, `$1\n    ${restoreFocus}`)
        .replace('  } catch {\n    showToast(', "  } catch (error) {\n    if (error?.name !== 'AbortError') showToast(");
      output = output.slice(0, start) + updated + output.slice(end);
    }
  } else {
    const marker = '        if (navigator.share) await navigator.share({ title, url });\n        else {';
    if (!output.includes(marker)) throw new Error('Member share transform could not find Room share actions.');
    output = output.replace(marker, `        const memberShareChoice = await window.SautiMemberDialogs.choose('Invite someone to this Room with a link.', [
          { value: 'copy', label: 'Copy link', description: 'Paste it into a message or another app.', icon: 'attachment-0-1' },
          ...(navigator.share ? [{ value: 'device', label: 'More apps', description: 'Open sharing options on your device.', icon: 'share-0-1' }] : []),
        ], { title: 'Share Room' });
        if (!memberShareChoice) return;
        if (memberShareChoice === 'device' && navigator.share) await navigator.share({ title, url });
        else {`);
  }
  return output;
}
