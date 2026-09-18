const ANALYTICS_TABLE = 'social_creator_daily_metrics';
const DASHBOARD_ID = 'professional-dashboard-surface';
const OWNER_ACTIONS_ID = 'profile-owner-dashboard-actions';
const DASHBOARD_BUTTON_ID = 'profile-dashboard-button';
const CSS_ID = 'sautilink-professional-dashboard-css';
const POLL_MS = 15000;
const VALID_WINDOWS = new Set([7, 28, 90]);

let installed = false;
let analyticsClient = null;
let getCurrentMemberId = () => '';
let activeWindow = 28;
let activeMetric = 'content_views';
let dashboardOpen = false;
let realtimeChannel = null;
let realtimeUserId = '';
let pollTimer = 0;
let refreshTimer = 0;
let lastSeries = [];
const recordedProfiles = new Set();

function byId(id) {
  return document.getElementById(id);
}

function ensureStylesheet() {
  if (document.getElementById(CSS_ID)) return;
  const link = document.createElement('link');
  link.id = CSS_ID;
  link.rel = 'stylesheet';
  link.href = '/app/assets/professional-dashboard.css?v=20260918-dashboard1';
  document.head.append(link);
}

function icon(paths, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function button(label, className = '') {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  return node;
}

function number(value) {
  return Math.max(0, Number(value) || 0);
}

function compact(value) {
  const amount = Math.abs(Number(value) || 0);
  if (amount < 1000) return new Intl.NumberFormat().format(amount);
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(amount);
}

function signedCompact(value) {
  const amount = Number(value) || 0;
  return `${amount < 0 ? '−' : ''}${compact(amount)}`;
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function dayStart(daysAgo) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return isoDay(date);
}

function formatShortDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function profileIsOwner() {
  const surface = byId('profile-surface');
  const edit = byId('profile-edit-button');
  return Boolean(surface && !surface.hidden && edit && !edit.hidden);
}

function profileUsername() {
  return String(byId('profile-username')?.textContent || '').trim().replace(/^@/, '').toLowerCase();
}

async function recordProfileViewIfNeeded() {
  const surface = byId('profile-surface');
  const edit = byId('profile-edit-button');
  if (!analyticsClient || !surface || surface.hidden || !edit || !edit.hidden) return;
  const username = profileUsername();
  if (!username || recordedProfiles.has(username)) return;
  recordedProfiles.add(username);
  const { error } = await analyticsClient.rpc('record_social_profile_view', { target_username: username });
  if (error) recordedProfiles.delete(username);
}

function ensureOwnerActions() {
  const surface = byId('profile-surface');
  const card = byId('profile-card');
  const edit = byId('profile-edit-button');
  if (!surface || !card || !edit) return null;

  let row = byId(OWNER_ACTIONS_ID);
  if (!row) {
    row = document.createElement('div');
    row.id = OWNER_ACTIONS_ID;
    row.className = 'profile-owner-dashboard-actions';
    row.hidden = true;

    const dashboard = button('Dashboard', 'profile-dashboard-button');
    dashboard.id = DASHBOARD_BUTTON_ID;
    dashboard.prepend(icon(['M4 19V10', 'M10 19V5', 'M16 19v-7', 'M22 19V8']));
    dashboard.addEventListener('click', () => void openDashboard());

    const activity = byId('profile-activity-shell');
    if (activity?.parentNode === card.parentNode) card.parentNode.insertBefore(row, activity);
    else card.insertAdjacentElement('afterend', row);
    row.append(edit, dashboard);
  } else if (!row.contains(edit)) {
    row.prepend(edit);
  }

  edit.classList.add('profile-owner-action-button');
  const dashboard = byId(DASHBOARD_BUTTON_ID);
  if (dashboard) dashboard.hidden = edit.hidden;
  row.hidden = edit.hidden;
  return row;
}

function keepOwnerActionsBeforeActivity() {
  const row = byId(OWNER_ACTIONS_ID);
  const activity = byId('profile-activity-shell');
  if (row && activity && row.nextElementSibling !== activity && row.parentNode === activity.parentNode) {
    activity.parentNode.insertBefore(row, activity);
  }
}

function syncOwnerActions() {
  ensureOwnerActions();
  keepOwnerActionsBeforeActivity();
  const edit = byId('profile-edit-button');
  const row = byId(OWNER_ACTIONS_ID);
  const dashboard = byId(DASHBOARD_BUTTON_ID);
  if (!edit || !row || !dashboard) return;
  const owner = !edit.hidden;
  row.hidden = !owner;
  dashboard.hidden = !owner;
}

function createMetricCard(key, label, help, iconPaths) {
  const card = button('', 'professional-metric-card');
  card.dataset.metric = key;
  card.setAttribute('aria-pressed', key === activeMetric ? 'true' : 'false');

  const top = document.createElement('div');
  top.className = 'professional-metric-card-top';
  top.append(icon(iconPaths));
  const title = document.createElement('span');
  title.textContent = label;
  top.append(title);

  const value = document.createElement('strong');
  value.dataset.metricValue = key;
  value.textContent = '—';

  const delta = document.createElement('span');
  delta.className = 'professional-metric-delta';
  delta.dataset.metricDelta = key;
  delta.textContent = '—';

  const note = document.createElement('small');
  note.textContent = help;

  card.append(top, value, delta, note);
  card.addEventListener('click', () => {
    activeMetric = key;
    document.querySelectorAll('.professional-metric-card').forEach((item) => {
      item.setAttribute('aria-pressed', String(item.dataset.metric === activeMetric));
    });
    renderChart(lastSeries);
  });
  return card;
}

function createEarningsBlock(className = 'professional-earnings-card') {
  const block = document.createElement(className === 'professional-zero-earnings' ? 'div' : 'article');
  block.className = className;

  if (className === 'professional-zero-earnings') {
    const label = document.createElement('span');
    label.textContent = 'Estimated earnings';
    const value = document.createElement('strong');
    value.textContent = '$0.00';
    const state = document.createElement('small');
    state.textContent = 'Monetisation inactive';
    block.append(label, value, state);
    return block;
  }

  const top = document.createElement('div');
  const label = document.createElement('span');
  label.textContent = 'Estimated earnings';
  const value = document.createElement('strong');
  value.textContent = '$0.00';
  top.append(label, value);
  const note = document.createElement('p');
  note.textContent = 'Monetisation is not yet available. No earnings or payout balance is being accrued.';
  block.append(top, note);
  return block;
}

function createDashboardSurface() {
  let surface = byId(DASHBOARD_ID);
  if (surface) return surface;

  const profileSurface = byId('profile-surface');
  if (!profileSurface?.parentNode) return null;

  surface = document.createElement('section');
  surface.id = DASHBOARD_ID;
  surface.className = 'professional-dashboard-surface';
  surface.hidden = true;
  surface.setAttribute('aria-label', 'Professional dashboard');

  const header = document.createElement('header');
  header.className = 'professional-dashboard-header';
  const back = button('', 'professional-dashboard-back');
  back.setAttribute('aria-label', 'Back to profile');
  back.append(icon(['m15 18-6-6 6-6']));
  back.addEventListener('click', closeDashboard);
  const heading = document.createElement('div');
  const eyebrow = document.createElement('span');
  eyebrow.className = 'professional-dashboard-eyebrow';
  eyebrow.textContent = 'Profile performance';
  const title = document.createElement('h2');
  title.textContent = 'Dashboard';
  heading.append(eyebrow, title);
  header.append(back, heading);

  const tabs = document.createElement('div');
  tabs.className = 'professional-dashboard-tabs';
  tabs.setAttribute('role', 'tablist');
  const insightsTab = button('Insights', 'professional-dashboard-tab active');
  insightsTab.dataset.dashboardTab = 'insights';
  insightsTab.setAttribute('role', 'tab');
  insightsTab.setAttribute('aria-selected', 'true');
  const moneyTab = button('Monetisation', 'professional-dashboard-tab');
  moneyTab.dataset.dashboardTab = 'monetisation';
  moneyTab.setAttribute('role', 'tab');
  moneyTab.setAttribute('aria-selected', 'false');
  const soon = document.createElement('span');
  soon.className = 'professional-coming-soon-pill';
  soon.textContent = 'Coming soon';
  moneyTab.append(soon);
  tabs.append(insightsTab, moneyTab);

  const insights = document.createElement('div');
  insights.className = 'professional-dashboard-panel';
  insights.dataset.dashboardPanel = 'insights';

  const summaryHead = document.createElement('div');
  summaryHead.className = 'professional-insights-heading';
  const copy = document.createElement('div');
  const h3 = document.createElement('h3');
  h3.textContent = 'Insights';
  const intro = document.createElement('p');
  intro.textContent = 'See how your profile and content are performing with live SautiLink data.';
  const trackingNote = document.createElement('small');
  trackingNote.className = 'professional-tracking-note';
  trackingNote.textContent = 'Profile visits and follow-change history start from the launch of this analytics dashboard; older values are not estimated.';
  copy.append(h3, intro, trackingNote);

  const controls = document.createElement('div');
  controls.className = 'professional-insights-controls';
  const live = document.createElement('span');
  live.className = 'professional-live-indicator';
  const liveDot = document.createElement('span');
  liveDot.setAttribute('aria-hidden', 'true');
  live.append(liveDot, document.createTextNode('Live'));
  const select = document.createElement('select');
  select.id = 'professional-dashboard-window';
  select.setAttribute('aria-label', 'Analytics date range');
  for (const [days, label] of [[7, 'Last 7 days'], [28, 'Last 28 days'], [90, 'Last 90 days']]) {
    const option = document.createElement('option');
    option.value = String(days);
    option.textContent = label;
    option.selected = days === activeWindow;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const next = Number(select.value);
    activeWindow = VALID_WINDOWS.has(next) ? next : 28;
    void refreshDashboard();
  });
  controls.append(live, select);
  summaryHead.append(copy, controls);

  const cards = document.createElement('div');
  cards.className = 'professional-metric-grid';
  cards.append(
    createMetricCard('content_views', 'Views', 'Unique meaningful views of your posts.', ['M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z', 'M9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0Z']),
    createMetricCard('engagements', 'Engagement', 'Reactions, reposts and replies to your content.', ['M4 5h16v11H8l-4 3V5Z', 'M8 9h8M8 12h5']),
    createMetricCard('net_follows', 'Net follows', 'Follows gained minus follows lost.', ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M19 8v6M16 11h6']),
    createMetricCard('profile_views', 'Profile visits', 'Unique signed-in visitors per day.', ['M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z', 'M9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0Z']),
  );

  const chartCard = document.createElement('section');
  chartCard.className = 'professional-chart-card';
  const chartHead = document.createElement('div');
  chartHead.className = 'professional-chart-heading';
  const chartTitle = document.createElement('strong');
  chartTitle.id = 'professional-chart-title';
  chartTitle.textContent = 'Views';
  const updated = document.createElement('span');
  updated.id = 'professional-dashboard-updated';
  updated.textContent = 'Loading live data…';
  chartHead.append(chartTitle, updated);
  const chart = document.createElement('div');
  chart.id = 'professional-dashboard-chart';
  chart.className = 'professional-dashboard-chart';
  chartCard.append(chartHead, chart);

  const content = document.createElement('section');
  content.className = 'professional-top-content';
  const contentHead = document.createElement('div');
  const contentTitle = document.createElement('h3');
  contentTitle.textContent = 'Top content';
  const contentHelp = document.createElement('p');
  contentHelp.textContent = 'Your posts ranked by genuine view and engagement totals.';
  contentHead.append(contentTitle, contentHelp);
  const contentList = document.createElement('div');
  contentList.id = 'professional-top-content-list';
  contentList.className = 'professional-top-content-list';
  content.append(contentHead, contentList);

  const status = document.createElement('p');
  status.id = 'professional-dashboard-status';
  status.className = 'professional-dashboard-status';
  status.hidden = true;

  insights.append(summaryHead, cards, createEarningsBlock(), chartCard, content, status);

  const monetisation = document.createElement('div');
  monetisation.className = 'professional-dashboard-panel professional-monetisation-panel';
  monetisation.dataset.dashboardPanel = 'monetisation';
  monetisation.hidden = true;
  const moneyIcon = document.createElement('div');
  moneyIcon.className = 'professional-monetisation-icon';
  moneyIcon.append(icon(['M12 2v20', 'M17 6.5c-1-1-2.5-1.5-4.5-1.5C9.5 5 7 6.4 7 8.5s2 3 5 3.5 5 1.4 5 3.5S14.5 19 11.5 19C9.4 19 7.7 18.4 6.5 17']));
  const moneyTitle = document.createElement('h3');
  moneyTitle.textContent = 'Monetisation is coming soon';
  const moneyCopy = document.createElement('p');
  moneyCopy.textContent = 'We are preparing creator monetisation for SautiLink. Eligibility, payouts and earning tools are not active yet.';
  monetisation.append(moneyIcon, moneyTitle, moneyCopy, createEarningsBlock('professional-zero-earnings'));

  for (const tab of [insightsTab, moneyTab]) {
    tab.addEventListener('click', () => {
      const target = tab.dataset.dashboardTab;
      for (const candidate of tabs.querySelectorAll('[data-dashboard-tab]')) {
        const active = candidate.dataset.dashboardTab === target;
        candidate.classList.toggle('active', active);
        candidate.setAttribute('aria-selected', String(active));
      }
      surface.querySelectorAll('[data-dashboard-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.dashboardPanel !== target;
      });
    });
  }

  surface.append(header, tabs, insights, monetisation);
  profileSurface.parentNode.insertBefore(surface, profileSurface.nextSibling);
  return surface;
}

function aggregate(rows, startIndex, endIndex) {
  const totals = { content_views: 0, engagements: 0, follows_gained: 0, follows_lost: 0, profile_views: 0, net_follows: 0 };
  for (let index = startIndex; index < endIndex; index += 1) {
    const row = rows[index];
    if (!row) continue;
    totals.content_views += number(row.content_views);
    totals.engagements += number(row.engagements);
    totals.follows_gained += number(row.follows_gained);
    totals.follows_lost += number(row.follows_lost);
    totals.profile_views += number(row.profile_views);
  }
  totals.net_follows = totals.follows_gained - totals.follows_lost;
  return totals;
}

function trend(current, previous) {
  if (previous === 0) return current === 0 ? { text: '0%', direction: 'neutral' } : { text: 'New', direction: current > 0 ? 'up' : 'down' };
  const percentage = Math.round(((current - previous) / Math.abs(previous)) * 100);
  return {
    text: `${percentage > 0 ? '+' : ''}${percentage}%`,
    direction: percentage > 0 ? 'up' : percentage < 0 ? 'down' : 'neutral',
  };
}

function fillSeries(rows) {
  const byDate = new Map((rows || []).map((row) => [String(row.metric_date), row]));
  const result = [];
  const totalDays = activeWindow * 2;
  for (let offset = totalDays - 1; offset >= 0; offset -= 1) {
    const date = dayStart(offset);
    const row = byDate.get(date) || {};
    result.push({
      metric_date: date,
      content_views: number(row.content_views),
      engagements: number(row.engagements),
      profile_views: number(row.profile_views),
      follows_gained: number(row.follows_gained),
      follows_lost: number(row.follows_lost),
      net_follows: number(row.follows_gained) - number(row.follows_lost),
    });
  }
  return result;
}

function updateMetricCards(series) {
  const split = activeWindow;
  const previous = aggregate(series, 0, split);
  const current = aggregate(series, split, split * 2);
  for (const key of ['content_views', 'engagements', 'net_follows', 'profile_views']) {
    const value = document.querySelector(`[data-metric-value="${key}"]`);
    const delta = document.querySelector(`[data-metric-delta="${key}"]`);
    if (value) value.textContent = key === 'net_follows' ? signedCompact(current[key]) : compact(current[key]);
    if (delta) {
      const change = trend(current[key], previous[key]);
      delta.textContent = change.text;
      delta.dataset.direction = change.direction;
    }
  }
}

function chartValues(series) {
  return series.slice(activeWindow).map((row) => ({ date: row.metric_date, value: Number(row[activeMetric]) || 0 }));
}

function metricLabel(key) {
  return ({ content_views: 'Views', engagements: 'Engagement', net_follows: 'Net follows', profile_views: 'Profile visits' })[key] || 'Views';
}

function renderChart(series) {
  const container = byId('professional-dashboard-chart');
  const title = byId('professional-chart-title');
  if (!container) return;
  if (title) title.textContent = metricLabel(activeMetric);
  container.replaceChildren();

  const values = chartValues(series);
  const width = 900;
  const height = 260;
  const pad = { left: 52, right: 18, top: 20, bottom: 38 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const minValue = Math.min(0, ...values.map((item) => item.value));
  const maxValue = Math.max(1, ...values.map((item) => item.value));
  const span = Math.max(1, maxValue - minValue);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${metricLabel(activeMetric)} over the last ${activeWindow} days`);

  for (let index = 0; index <= 4; index += 1) {
    const y = pad.top + (innerH * index / 4);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(pad.left));
    line.setAttribute('x2', String(width - pad.right));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('class', 'professional-chart-grid-line');
    svg.append(line);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(pad.left - 10));
    text.setAttribute('y', String(y + 4));
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('class', 'professional-chart-axis-label');
    const axis = Math.round(maxValue - (span * index / 4));
    text.textContent = axis < 0 ? `−${compact(axis)}` : compact(axis);
    svg.append(text);
  }

  const points = values.map((item, index) => {
    const x = pad.left + (values.length <= 1 ? 0 : innerW * index / (values.length - 1));
    const y = pad.top + innerH - (innerH * (item.value - minValue) / span);
    return { ...item, x, y };
  });

  if (points.length) {
    const zeroY = pad.top + innerH - (innerH * (0 - minValue) / span);
    const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('d', [`M ${points[0].x} ${zeroY}`, ...points.map((point) => `L ${point.x} ${point.y}`), `L ${points.at(-1).x} ${zeroY}`, 'Z'].join(' '));
    area.setAttribute('class', 'professional-chart-area');
    svg.append(area);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '));
    path.setAttribute('class', 'professional-chart-line');
    svg.append(path);
  }

  const labelCount = Math.min(6, values.length);
  for (let index = 0; index < labelCount; index += 1) {
    const sourceIndex = labelCount === 1 ? 0 : Math.round(index * (values.length - 1) / (labelCount - 1));
    const item = points[sourceIndex];
    if (!item) continue;
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(item.x));
    text.setAttribute('y', String(height - 12));
    text.setAttribute('text-anchor', sourceIndex === 0 ? 'start' : sourceIndex === values.length - 1 ? 'end' : 'middle');
    text.setAttribute('class', 'professional-chart-axis-label');
    text.textContent = formatShortDate(item.date);
    svg.append(text);
  }

  container.append(svg);
}

function stat(label, value) {
  const node = document.createElement('span');
  const strong = document.createElement('b');
  strong.textContent = compact(value);
  node.append(strong, document.createTextNode(` ${label}`));
  return node;
}

function renderTopPosts(posts) {
  const list = byId('professional-top-content-list');
  if (!list) return;
  list.replaceChildren();
  if (!posts.length) {
    const empty = document.createElement('p');
    empty.className = 'professional-dashboard-empty';
    empty.textContent = 'Publish posts to start seeing content performance here.';
    list.append(empty);
    return;
  }

  for (const post of posts) {
    const card = document.createElement('article');
    card.className = 'professional-top-post';
    const text = document.createElement('div');
    const body = document.createElement('strong');
    body.textContent = String(post.body || '').trim().slice(0, 110) || 'Media post';
    const date = document.createElement('span');
    date.textContent = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(post.created_at));
    text.append(body, date);

    const stats = document.createElement('div');
    stats.className = 'professional-top-post-stats';
    stats.append(stat('views', post.views), stat('engagements', post.engagement));
    card.append(text, stats);
    list.append(card);
  }
}

function setStatus(message, error = false) {
  const node = byId('professional-dashboard-status');
  if (!node) return;
  node.textContent = message || '';
  node.hidden = !message;
  node.dataset.error = error ? 'true' : 'false';
}

async function loadTopPosts(userId) {
  const { data: posts, error } = await analyticsClient
    .from('social_posts')
    .select('id,body,created_at,like_count,comment_count,repost_count')
    .eq('author_id', userId)
    .is('parent_post_id', null)
    .eq('post_status', 'published')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error || !posts?.length) return [];

  const ids = posts.map((post) => post.id);
  const { data: metrics } = await analyticsClient
    .from('social_post_metrics')
    .select('post_id,view_count')
    .in('post_id', ids);
  const views = new Map((metrics || []).map((row) => [String(row.post_id), number(row.view_count)]));

  return posts.map((post) => {
    const engagement = number(post.like_count) + number(post.comment_count) + number(post.repost_count);
    const viewCount = views.get(String(post.id)) || 0;
    return { ...post, views: viewCount, engagement, score: viewCount + engagement };
  }).sort((a, b) => b.score - a.score || new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
}

async function refreshDashboard() {
  if (!dashboardOpen || !analyticsClient) return;
  const userId = String(getCurrentMemberId() || '').trim();
  if (!userId) {
    setStatus('Your session could not be verified. Sign in again to view analytics.', true);
    return;
  }
  setStatus('');

  const start = dayStart(activeWindow * 2 - 1);
  const { data, error } = await analyticsClient
    .from(ANALYTICS_TABLE)
    .select('metric_date,profile_views,content_views,engagements,follows_gained,follows_lost,updated_at')
    .eq('user_id', userId)
    .gte('metric_date', start)
    .order('metric_date', { ascending: true });

  if (error) {
    setStatus('Analytics could not be loaded right now. Your statistics have not been replaced with estimates.', true);
    return;
  }

  lastSeries = fillSeries(data || []);
  updateMetricCards(lastSeries);
  renderChart(lastSeries);
  renderTopPosts(await loadTopPosts(userId));
  const updated = byId('professional-dashboard-updated');
  if (updated) updated.textContent = `Live · updated ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date())}`;
  subscribeRealtime(userId);
}

function scheduleRefresh(delay = 250) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refreshDashboard(), delay);
}

function subscribeRealtime(userId) {
  if (!dashboardOpen || !userId || !analyticsClient) return;
  if (realtimeChannel && realtimeUserId === userId) return;
  if (realtimeChannel) analyticsClient.removeChannel(realtimeChannel);
  realtimeUserId = userId;

  realtimeChannel = analyticsClient
    .channel(`creator-dashboard:${userId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: ANALYTICS_TABLE,
      filter: `user_id=eq.${userId}`,
    }, () => scheduleRefresh(120))
    .subscribe();
}

function startPolling() {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    if (dashboardOpen && document.visibilityState === 'visible') void refreshDashboard();
  }, POLL_MS);
}

function stopLiveUpdates() {
  window.clearInterval(pollTimer);
  pollTimer = 0;
  window.clearTimeout(refreshTimer);
  refreshTimer = 0;
  realtimeUserId = '';
  if (realtimeChannel && analyticsClient) {
    analyticsClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

async function openDashboard() {
  if (!profileIsOwner()) return;
  const surface = createDashboardSurface();
  const profile = byId('profile-surface');
  if (!surface || !profile) return;

  dashboardOpen = true;
  profile.hidden = true;
  surface.hidden = false;
  const title = byId('view-title');
  if (title) title.hidden = true;
  window.scrollTo({ top: 0, behavior: 'auto' });
  startPolling();
  await refreshDashboard();
}

function closeDashboard() {
  const surface = byId(DASHBOARD_ID);
  const profile = byId('profile-surface');
  dashboardOpen = false;
  stopLiveUpdates();
  if (surface) surface.hidden = true;
  if (profile) profile.hidden = false;
  const title = byId('view-title');
  if (title) {
    title.hidden = false;
    title.textContent = 'Profile';
  }
  syncOwnerActions();
}

function observeProfile() {
  const surface = byId('profile-surface');
  const edit = byId('profile-edit-button');
  const username = byId('profile-username');
  const card = byId('profile-card');
  if (!surface || !edit || !card) return;

  const sync = () => {
    if (dashboardOpen) return;
    syncOwnerActions();
    void recordProfileViewIfNeeded();
  };

  new MutationObserver(sync).observe(surface, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(sync).observe(edit, { attributes: true, attributeFilter: ['hidden'] });
  if (username) new MutationObserver(sync).observe(username, { childList: true, subtree: true, characterData: true });
  new MutationObserver(sync).observe(card.parentNode, { childList: true });
  sync();
}

function installNavigationGuard() {
  document.addEventListener('click', (event) => {
    const nav = event.target.closest?.('[data-member-view]');
    if (!nav || !dashboardOpen) return;
    dashboardOpen = false;
    stopLiveUpdates();
    const surface = byId(DASHBOARD_ID);
    if (surface) surface.hidden = true;
    const title = byId('view-title');
    if (title) title.hidden = false;
  }, true);
}

export function installProfessionalDashboard(options = {}) {
  if (installed || typeof document === 'undefined' || !options.supabase) return;
  installed = true;
  analyticsClient = options.supabase;
  getCurrentMemberId = typeof options.getCurrentMemberId === 'function' ? options.getCurrentMemberId : () => '';
  ensureStylesheet();

  const start = () => {
    ensureOwnerActions();
    createDashboardSurface();
    observeProfile();
    installNavigationGuard();
    document.addEventListener('visibilitychange', () => {
      if (dashboardOpen && document.visibilityState === 'visible') scheduleRefresh(80);
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else queueMicrotask(start);
}
