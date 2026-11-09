// Standalone staging font evaluation. No auth, API, cookies, or account data.
const state = { font: 'flex', theme: 'light', device: 'desktop', screen: 'home' };
const grid = document.querySelector('#preview-grid');
const template = document.querySelector('#surface-template');
const status = document.querySelector('#font-status');

const fontInfo = {
  inter: { name: 'Inter', technical: 'Variable · 100–900' },
  flex: { name: 'Google Sans Flex', technical: 'Variable · 100–900' },
};

function markSelection(containerId, attribute, activeValue) {
  document.querySelectorAll('#' + containerId + ' [' + attribute + ']').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.getAttribute(attribute) === activeValue));
  });
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  markSelection('font-choice', 'data-font', state.font);
  markSelection('theme-choice', 'data-theme', state.theme);
  markSelection('device-choice', 'data-device', state.device);
  markSelection('screen-choice', 'data-screen-tab', state.screen);

  const fonts = state.font === 'compare' ? ['inter', 'flex'] : [state.font];
  grid.className = 'preview-grid ' + (fonts.length === 2 ? 'is-compare' : 'is-single') +
    (state.device === 'mobile' ? ' is-mobile' : '');
  const surfaces = fonts.map((font) => {
    const surface = template.content.firstElementChild.cloneNode(true);
    const info = fontInfo[font];
    surface.dataset.previewFont = font;
    surface.dataset.previewScreen = state.screen;
    surface.setAttribute('aria-label', info.name + ' · ' + state.screen + ' preview');
    surface.querySelector('.font-name').textContent = info.name;
    surface.querySelector('.font-technical').textContent = info.technical;
    surface.querySelectorAll('[data-screen]').forEach((screen) => {
      screen.hidden = screen.dataset.screen !== state.screen;
    });
    return surface;
  });
  grid.replaceChildren(...surfaces);
}

function attachControls(containerId, attribute, stateKey) {
  const group = document.getElementById(containerId);
  group.addEventListener('click', (event) => {
    const button = event.target.closest('button[' + attribute + ']');
    if (!button || !group.contains(button)) return;
    state[stateKey] = button.getAttribute(attribute);
    render();
  });
}

attachControls('font-choice', 'data-font', 'font');
attachControls('theme-choice', 'data-theme', 'theme');
attachControls('device-choice', 'data-device', 'device');
attachControls('screen-choice', 'data-screen-tab', 'screen');
render();

// Confirm the preview font actually loaded instead of silently showing Inter.
(async () => {
  if (!document.fonts?.load) {
    status.textContent = 'Font loading check unavailable on this browser · Inter fallback supported';
    status.classList.add('warn');
    return;
  }
  try {
    await document.fonts.load('600 16px "Google Sans Flex"');
    const loaded = document.fonts.check('600 16px "Google Sans Flex"');
    status.textContent = loaded
      ? '✓ Google Sans Flex loaded · Switch between fonts above'
      : 'Google Sans Flex unavailable · Preview may display fallback Inter';
    status.classList.add(loaded ? 'ready' : 'warn');
  } catch {
    status.textContent = 'Google Sans Flex unavailable · Preview may display fallback Inter';
    status.classList.add('warn');
  }
})();
