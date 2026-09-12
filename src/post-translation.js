const POST_TRANSLATION_STYLESHEET = '/app/assets/post-translation.css';
const TRANSLATABLE_LANGUAGES = new Set(['sw', 'fr']);
const translationMemory = new Map();
const cardStates = new WeakMap();

const LANGUAGE_PROFILES = Object.freeze({
  sw: {
    strong: new Set([
      'habari', 'asante', 'karibu', 'tafadhali', 'sana', 'sasa', 'bado', 'leo', 'kesho', 'jana',
      'kwenye', 'katika', 'kutoka', 'kuhusu', 'lakini', 'hivyo', 'ndiyo', 'siyo', 'niko', 'upo', 'yuko',
      'tuko', 'wako', 'nina', 'una', 'ana', 'tuna', 'wana', 'nataka', 'tunataka', 'unaweza', 'tunaweza',
      'mtu', 'watu', 'watoto', 'maisha', 'kazi', 'shule', 'serikali', 'uchaguzi', 'maendeleo', 'nzuri',
      'vizuri', 'hapa', 'pale', 'huko', 'huyu', 'hiyo', 'hili', 'hiki', 'hawa', 'hizi', 'kila', 'mimi',
      'wewe', 'sisi', 'wao', 'ambayo', 'ambaye', 'kwamba', 'kama', 'pia', 'kabisa', 'maana', 'bora',
    ]),
    common: new Set(['na', 'ni', 'ya', 'wa', 'la', 'za', 'cha', 'kwa', 'si', 'au', 'ila', 'tu', 'je', 'ipo', 'iko', 'kuwa']),
  },
  fr: {
    strong: new Set([
      'bonjour', 'merci', 'salut', 'aujourd’hui', 'aujourdhui', 'demain', 'hier', 'français', 'francais',
      'suis', 'êtes', 'etes', 'sommes', 'sont', 'avec', 'sans', 'dans', 'pour', 'mais', 'parce', 'comme',
      'cette', 'ces', 'mon', 'mes', 'notre', 'votre', 'leurs', 'très', 'tres', 'bien', 'ici', 'maintenant',
      'encore', 'toujours', 'jamais', 'quelque', 'beaucoup', 'personne', 'gens', 'enfants', 'travail',
      'école', 'ecole', 'gouvernement', 'élection', 'election', 'développement', 'developpement', 'peux',
      'pouvez', 'veux', 'voulons', 'cela', 'celui', 'celle', 'ainsi', 'aussi', 'vraiment',
    ]),
    common: new Set(['je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'est', 'que', 'qui', 'pas', 'sur', 'ce']),
  },
  en: {
    strong: new Set([
      'hello', 'thanks', 'thank', 'please', 'today', 'tomorrow', 'yesterday', 'here', 'there', 'people',
      'children', 'work', 'school', 'government', 'election', 'development', 'because', 'really', 'still',
      'always', 'never', 'want', 'need', 'can', 'could', 'should', 'would', 'this', 'that', 'these', 'those',
      'with', 'without', 'from', 'about', 'very', 'good', 'well', 'now', 'also', 'more', 'before', 'after',
    ]),
    common: new Set(['i', 'you', 'he', 'she', 'we', 'they', 'the', 'a', 'an', 'and', 'or', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'for', 'not', 'but']),
  },
});

function ensurePostTranslationStylesheet() {
  if (document.querySelector(`link[href="${POST_TRANSLATION_STYLESHEET}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = POST_TRANSLATION_STYLESHEET;
  link.dataset.sautilinkPostTranslation = 'true';
  document.head.append(link);
}

function wordsFromText(value) {
  const cleaned = String(value || '')
    .normalize('NFC')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/@[a-z0-9._]+/gi, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .toLocaleLowerCase();
  return cleaned.match(/[\p{L}’']+/gu) || [];
}

function scoreLanguage(words, profile) {
  let score = 0;
  let strongHits = 0;
  for (const word of words) {
    if (profile.strong.has(word)) {
      score += 3;
      strongHits += 1;
    } else if (profile.common.has(word)) {
      score += 1;
    }
  }
  return { score, strongHits };
}

export function detectSupportedPostLanguage(value) {
  const words = wordsFromText(value);
  if (!words.length) return '';

  const scores = Object.fromEntries(
    Object.entries(LANGUAGE_PROFILES).map(([language, profile]) => [language, scoreLanguage(words, profile)]),
  );
  const ranked = Object.entries(scores).sort((left, right) => right[1].score - left[1].score);
  const [bestLanguage, best] = ranked[0];
  const second = ranked[1]?.[1]?.score || 0;

  if (bestLanguage === 'en' && best.score >= 2 && best.score >= second) return 'en';
  if (!TRANSLATABLE_LANGUAGES.has(bestLanguage)) return '';

  const hasFrenchAccent = bestLanguage === 'fr' && /[àâçéèêëîïôûùüÿœæ]/i.test(String(value || ''));
  const shortText = words.length <= 2;
  if (shortText && best.strongHits < 1 && !hasFrenchAccent) return '';
  if (best.score < 3 && !hasFrenchAccent) return '';
  if (best.score <= second) return '';
  return bestLanguage;
}

export function accessTokenFromStoredSession(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.('sautilink.auth.session');
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    const candidates = [
      parsed,
      parsed?.currentSession,
      parsed?.session,
      parsed?.data?.session,
    ];
    const session = candidates.find((item) => item && typeof item === 'object' && item.access_token);
    return String(session?.access_token || '').trim();
  } catch {
    return '';
  }
}

function visibleOriginalCaption(text, toggle) {
  const full = String(text.dataset.fullCaption || text.textContent || '');
  const preview = String(text.dataset.previewCaption || full);
  const expanded = toggle?.getAttribute('aria-expanded') === 'true';
  return expanded ? full : preview;
}

async function requestTranslation(postId, sourceLanguage, body) {
  const memoryKey = `${postId}:${sourceLanguage}:${body}`;
  if (translationMemory.has(memoryKey)) return translationMemory.get(memoryKey);

  const token = accessTokenFromStoredSession();
  if (!token) throw new Error('AUTH_REQUIRED');

  const response = await fetch(`/api/post-translations/${encodeURIComponent(postId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ source_language: sourceLanguage }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(payload?.error?.code || 'TRANSLATION_FAILED'));

  const translated = String(payload?.data?.translated_text || '').trim();
  if (!translated) throw new Error('TRANSLATION_EMPTY');
  translationMemory.set(memoryKey, translated);
  return translated;
}

function removeTranslationControl(state) {
  state?.button?.remove();
  if (state?.text?.dataset.translationActive === 'true') {
    const toggle = state.caption?.querySelector('[data-caption-toggle]');
    state.text.textContent = visibleOriginalCaption(state.text, toggle);
    delete state.text.dataset.translationActive;
    if (toggle) toggle.hidden = false;
  }
}

function enhancePostTranslation(article) {
  if (!(article instanceof HTMLElement)) return;
  const postId = String(article.dataset.postId || '').trim();
  const caption = article.querySelector('.sauti-caption');
  const text = caption?.querySelector('.sauti-caption-text');
  if (!postId || !caption || !text) return;

  const body = String(text.dataset.fullCaption || text.textContent || '').trim();
  const previous = cardStates.get(article);
  if (previous?.body === body) return;
  if (previous) removeTranslationControl(previous);

  const sourceLanguage = detectSupportedPostLanguage(body);
  const state = { article, caption, text, body, sourceLanguage, button: null, translatedText: '' };
  cardStates.set(article, state);
  if (!TRANSLATABLE_LANGUAGES.has(sourceLanguage)) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sauti-post-translation-toggle';
  button.dataset.postTranslate = 'true';
  button.dataset.languageNoTranslate = 'true';
  button.textContent = 'Translate this post';
  state.button = button;
  caption.after(button);

  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (text.dataset.translationActive === 'true') {
      const toggle = caption.querySelector('[data-caption-toggle]');
      text.textContent = visibleOriginalCaption(text, toggle);
      delete text.dataset.translationActive;
      if (toggle) toggle.hidden = false;
      button.textContent = 'Translate this post';
      button.setAttribute('aria-pressed', 'false');
      return;
    }

    if (state.translatedText) {
      const toggle = caption.querySelector('[data-caption-toggle]');
      text.textContent = state.translatedText;
      text.dataset.translationActive = 'true';
      if (toggle) toggle.hidden = true;
      button.textContent = 'See Original Post';
      button.setAttribute('aria-pressed', 'true');
      return;
    }

    button.disabled = true;
    button.textContent = 'Translating…';
    button.setAttribute('aria-busy', 'true');
    try {
      state.translatedText = await requestTranslation(postId, sourceLanguage, body);
      const toggle = caption.querySelector('[data-caption-toggle]');
      text.textContent = state.translatedText;
      text.dataset.translationActive = 'true';
      if (toggle) toggle.hidden = true;
      button.textContent = 'See Original Post';
      button.setAttribute('aria-pressed', 'true');
    } catch {
      button.textContent = 'Translate this post';
      button.setAttribute('aria-pressed', 'false');
    } finally {
      button.disabled = false;
      button.setAttribute('aria-busy', 'false');
    }
  });
}

function scanPostTranslations(root = document) {
  root.querySelectorAll?.('.sauti-card').forEach(enhancePostTranslation);
  if (root.matches?.('.sauti-card')) enhancePostTranslation(root);
  const parentCard = root.closest?.('.sauti-card');
  if (parentCard) enhancePostTranslation(parentCard);
}

function installPostTranslations() {
  ensurePostTranslationStylesheet();
  scanPostTranslations();
  const observer = new MutationObserver((mutations) => {
    const cards = new Set();
    for (const mutation of mutations) {
      const targetCard = mutation.target?.closest?.('.sauti-card');
      if (targetCard) cards.add(targetCard);
      for (const node of mutation.addedNodes || []) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        scanPostTranslations(node);
      }
    }
    cards.forEach(enhancePostTranslation);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPostTranslations, { once: true });
  } else {
    installPostTranslations();
  }
}
