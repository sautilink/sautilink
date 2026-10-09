export function createLoadingSkeleton({ label, rows = 2, heading = false } = {}) {
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.className = 'sr-only';
  text.textContent = label || 'Loading…';
  status.append(text);

  const skeleton = document.createElement('div');
  skeleton.className = 'sl-skeleton';
  skeleton.setAttribute('aria-hidden', 'true');
  const addRow = (className) => {
    const row = document.createElement('div');
    row.className = className;
    const avatar = document.createElement('i');
    const lines = document.createElement('span');
    lines.append(document.createElement('b'), document.createElement('b'));
    row.append(avatar, lines);
    if (className === 'sl-skeleton-row') row.append(document.createElement('em'));
    skeleton.append(row);
  };
  if (heading) addRow('sl-skeleton-heading');
  for (let index = 0; index < rows; index += 1) addRow('sl-skeleton-row');
  status.append(skeleton);
  return status;
}
