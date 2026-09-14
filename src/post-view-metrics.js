const POST_CARD_SELECTOR = '.sauti-card[data-post-id][data-author-id]';
const ACTION_ROW_SELECTOR = '.sauti-actions';
const VIEW_METRIC_SELECTOR = '[data-sauti-metric="views"]';
const THREAD_REPLY_SELECTOR = '.thread-sauti';
const THREAD_CONTAINER_SELECTOR = '#conversation-thread';
const MEANINGFUL_VIEW_MS = 1000;
const VIEW_THRESHOLD = 0.5;

function metricIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('stroke-width', '1.85');
  svg.innerHTML = '<path d="M5 19V11"/><path d="M9.7 19V5"/><path d="M14.3 19v-7"/><path d="M19 19V8"/>';
  return svg;
}

function compactCount(value) {
  const count = Math.max(0, Number(value) || 0);
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  if (count < 1_000_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  return `${(count / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
}

function createMetricNode(postId) {
  const metric = document.createElement('span');
  metric.className = 'sauti-action sauti-view-metric';
  metric.dataset.sautiMetric = 'views';
  metric.dataset.postId = postId;
  metric.setAttribute('role', 'status');
  metric.setAttribute('aria-label', '0 views');
  metric.style.cursor = 'default';
  metric.style.userSelect = 'none';
  metric.style.pointerEvents = 'none';

  const label = document.createElement('span');
  label.className = 'sr-only';
  label.textContent = 'Views';

  const count = document.createElement('span');
  count.className = 'sauti-action-count';
  count.dataset.metricCountFor = 'views';
  count.textContent = '0';

  metric.append(metricIcon(), label, count);
  return metric;
}

function updateMetricNode(metric, value) {
  if (!(metric instanceof Element)) return;
  const numeric = Math.max(0, Number(value) || 0);
  const count = metric.querySelector('[data-metric-count-for="views"]');
  if (count) count.textContent = compactCount(numeric);
  metric.setAttribute('aria-label', `${numeric} ${numeric === 1 ? 'view' : 'views'}`);
}

function isConversationReply(card) {
  if (!(card instanceof Element)) return false;
  return card.matches(THREAD_REPLY_SELECTOR) || Boolean(card.closest(THREAD_CONTAINER_SELECTOR));
}

export function installPostViewMetrics({ supabase, getCurrentMemberId }) {
  if (!supabase || typeof getCurrentMemberId !== 'function' || typeof document === 'undefined') return;
  if (globalThis.__sautilinkPostViewMetricsInstalled) return;
  globalThis.__sautilinkPostViewMetricsInstalled = true;

  const attemptedPostIds = new Set();
  const observedCards = new WeakSet();
  const viewTimers = new WeakMap();
  const pendingCreatorPostIds = new Set();
  let metricsFlushTimer = 0;

  async function recordView(card) {
    const postId = String(card?.dataset?.postId || '').trim();
    const authorId = String(card?.dataset?.authorId || '').trim();
    const memberId = String(getCurrentMemberId() || '').trim();
    if (!postId || !memberId || !authorId || authorId === memberId || attemptedPostIds.has(postId)) return;

    attemptedPostIds.add(postId);
    const { error } = await supabase.rpc('record_social_post_view', { target_post_id: postId });
    if (error) attemptedPostIds.delete(postId);
  }

  const intersectionObserver = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const card = entry.target;
        const existingTimer = viewTimers.get(card);
        if (entry.isIntersecting && entry.intersectionRatio >= VIEW_THRESHOLD && document.visibilityState === 'visible') {
          if (existingTimer) continue;
          const timer = setTimeout(() => {
            viewTimers.delete(card);
            if (!card.isConnected || document.visibilityState !== 'visible') return;
            void recordView(card);
          }, MEANINGFUL_VIEW_MS);
          viewTimers.set(card, timer);
        } else if (existingTimer) {
          clearTimeout(existingTimer);
          viewTimers.delete(card);
        }
      }
    }, { threshold: [0, VIEW_THRESHOLD, 1] })
    : null;

  async function flushCreatorMetrics() {
    metricsFlushTimer = 0;
    const memberId = String(getCurrentMemberId() || '').trim();
    if (!memberId || !pendingCreatorPostIds.size) return;

    const postIds = [...pendingCreatorPostIds];
    pendingCreatorPostIds.clear();
    const { data, error } = await supabase
      .from('social_post_metrics')
      .select('post_id, view_count')
      .in('post_id', postIds);

    if (error) return;
    const metrics = new Map((data || []).map((row) => [String(row.post_id), Number(row.view_count) || 0]));
    for (const node of document.querySelectorAll(VIEW_METRIC_SELECTOR)) {
      const postId = String(node.dataset.postId || '');
      if (metrics.has(postId)) updateMetricNode(node, metrics.get(postId) || 0);
    }
  }

  function queueCreatorMetric(postId) {
    pendingCreatorPostIds.add(postId);
    if (metricsFlushTimer) return;
    metricsFlushTimer = setTimeout(() => void flushCreatorMetrics(), 40);
  }

  function prepareCard(card) {
    if (!(card instanceof Element) || !card.matches(POST_CARD_SELECTOR)) return;

    if (isConversationReply(card)) {
      card.querySelector(VIEW_METRIC_SELECTOR)?.remove();
      const existingTimer = viewTimers.get(card);
      if (existingTimer) {
        clearTimeout(existingTimer);
        viewTimers.delete(card);
      }
      if (intersectionObserver) intersectionObserver.unobserve(card);
      return;
    }

    const postId = String(card.dataset.postId || '').trim();
    const authorId = String(card.dataset.authorId || '').trim();
    const memberId = String(getCurrentMemberId() || '').trim();
    if (!postId || !authorId || !memberId) return;

    if (authorId === memberId) {
      const actions = card.querySelector(ACTION_ROW_SELECTOR);
      if (!actions) return;
      let metric = actions.querySelector(VIEW_METRIC_SELECTOR);
      if (!metric) {
        metric = createMetricNode(postId);
        const saveAction = actions.querySelector('[data-sauti-action="save"]');
        if (saveAction) actions.insertBefore(metric, saveAction);
        else actions.append(metric);
      }
      queueCreatorMetric(postId);
      if (intersectionObserver) intersectionObserver.unobserve(card);
      return;
    }

    card.querySelector(VIEW_METRIC_SELECTOR)?.remove();
    if (intersectionObserver && !observedCards.has(card)) {
      observedCards.add(card);
      intersectionObserver.observe(card);
    }
  }

  function scan(node = document) {
    if (node instanceof Element && node.matches(POST_CARD_SELECTOR)) prepareCard(node);
    node.querySelectorAll?.(POST_CARD_SELECTOR).forEach(prepareCard);
  }

  function start() {
    scan(document);
    const root = document.body;
    if (!root) return;
    new MutationObserver((mutations) => {
      for (const mutation of mutations) mutation.addedNodes.forEach((node) => scan(node));
    }).observe(root, { childList: true, subtree: true });

    let attempts = 0;
    const memberReady = setInterval(() => {
      attempts += 1;
      if (String(getCurrentMemberId() || '').trim()) {
        clearInterval(memberReady);
        scan(document);
      } else if (attempts >= 40) {
        clearInterval(memberReady);
      }
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else queueMicrotask(start);
}
