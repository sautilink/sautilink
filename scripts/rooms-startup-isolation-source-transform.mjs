function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Rooms startup transform could not find ${label}.`);
  }
  return source.replace(search, replacement);
}

function normalizedPath(filePath) {
  return String(filePath || '').replaceAll('\\', '/');
}

function transformRoomsPlatformSource(source) {
  let output = source;

  const observerSource = `  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => mutation.addedNodes.forEach(sanitizeRoomBrand));
    scheduleRoomsUi();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });`;

  const observerReplacement = `  const observer = new MutationObserver((mutations) => {
    let shouldSchedule = false;
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach(sanitizeRoomBrand);
      if (mutation.type === 'attributes') {
        const currentValue = mutation.target.getAttribute(mutation.attributeName);
        if (mutation.oldValue !== currentValue) shouldSchedule = true;
        return;
      }
      if (mutation.type === 'characterData') {
        shouldSchedule = true;
        return;
      }
      if (mutation.type === 'childList') {
        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        if (changedNodes.some((node) => node.nodeType === Node.ELEMENT_NODE)) shouldSchedule = true;
      }
    });
    if (shouldSchedule) scheduleRoomsUi();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['hidden'],
    attributeOldValue: true,
  });`;

  output = replaceRequired(output, observerSource, observerReplacement, 'Rooms platform mutation observer');

  const startSource = `installRoomRouteBridge();
initRoomsPlatform();`;
  const startReplacement = `installRoomRouteBridge();

let roomsPlatformInitialized = false;

function startRoomsPlatformWhenMemberReady() {
  if (roomsPlatformInitialized) return;
  const memberView = roomById('member-view');
  if (!memberView) return;
  if (!memberView.hidden) {
    roomsPlatformInitialized = true;
    initRoomsPlatform();
    return;
  }

  const memberObserver = new MutationObserver(() => {
    if (memberView.hidden || roomsPlatformInitialized) return;
    memberObserver.disconnect();
    roomsPlatformInitialized = true;
    initRoomsPlatform();
  });
  memberObserver.observe(memberView, { attributes: true, attributeFilter: ['hidden'] });
}

startRoomsPlatformWhenMemberReady();`;

  return replaceRequired(output, startSource, startReplacement, 'Rooms platform startup');
}

function transformRoomsFacebookSource(source) {
  const observerSource = `ensureRoomsFacebookStyles();
syncRoomRouteFeedback();
document.addEventListener('click', handleRoomRouteFeedbackAction, true);
const roomsFacebookObserver = new MutationObserver(() => {
  syncRoomRouteFeedback();
  scheduleRoomsFacebookUi();
});
roomsFacebookObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['hidden', 'class', 'data-state'],
});
window.addEventListener('popstate', () => {
  syncRoomRouteFeedback();
  scheduleRoomsFacebookUi();
});
window.addEventListener('resize', scheduleRoomsFacebookUi);
scheduleRoomsFacebookUi();`;

  const observerReplacement = `let roomsFacebookInitialized = false;

function roomFacebookMutationChangesUi(mutation) {
  if (mutation.type === 'attributes') {
    return mutation.oldValue !== mutation.target.getAttribute(mutation.attributeName);
  }
  if (mutation.type === 'childList') {
    return [...mutation.addedNodes, ...mutation.removedNodes]
      .some((node) => node.nodeType === Node.ELEMENT_NODE);
  }
  return true;
}

function initRoomsFacebookUi() {
  if (roomsFacebookInitialized) return;
  roomsFacebookInitialized = true;
  ensureRoomsFacebookStyles();
  syncRoomRouteFeedback();
  document.addEventListener('click', handleRoomRouteFeedbackAction, true);
  const roomsFacebookObserver = new MutationObserver((mutations) => {
    if (!mutations.some(roomFacebookMutationChangesUi)) return;
    syncRoomRouteFeedback();
    scheduleRoomsFacebookUi();
  });
  roomsFacebookObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'class', 'data-state'],
    attributeOldValue: true,
  });
  window.addEventListener('popstate', () => {
    syncRoomRouteFeedback();
    scheduleRoomsFacebookUi();
  });
  window.addEventListener('resize', scheduleRoomsFacebookUi);
  scheduleRoomsFacebookUi();
}

function startRoomsFacebookWhenMemberReady() {
  const memberView = roomFbById('member-view');
  if (!memberView) return;
  if (!memberView.hidden) {
    initRoomsFacebookUi();
    return;
  }
  const memberObserver = new MutationObserver(() => {
    if (memberView.hidden) return;
    memberObserver.disconnect();
    initRoomsFacebookUi();
  });
  memberObserver.observe(memberView, { attributes: true, attributeFilter: ['hidden'] });
}

startRoomsFacebookWhenMemberReady();`;

  return replaceRequired(source, observerSource, observerReplacement, 'Rooms Facebook startup');
}

export function transformRoomsStartupIsolationSource(filePath, source) {
  const path = normalizedPath(filePath);
  if (path.endsWith('/rooms-platform.js')) return transformRoomsPlatformSource(source);
  if (path.endsWith('/rooms-facebook-ui.js')) return transformRoomsFacebookSource(source);
  return source;
}
