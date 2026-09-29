function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Room open performance transform could not find ${label}.`);
  }
  return source.replace(search, replacement);
}

function normalizedPath(filePath) {
  return String(filePath || '').replaceAll('\\', '/');
}

function transformAppSource(source) {
  let output = source;

  output = replaceRequired(
    output,
    `async function loadSautiMediaRows(postId) {
  const { data, error } = await supabase
    .from('social_post_media')
    .select('id,media_kind,content_type,width,height,duration_ms,alt_text,position')
    .eq('post_id', postId)
    .eq('upload_status', 'attached')
    .order('position', { ascending: true });
  if (error) return [];
  return Array.isArray(data) ? data.slice(0, 4) : [];
}`,
    `const ROOM_MEDIA_ROWS_CACHE_TTL_MS = 60 * 1000;
const ROOM_MEDIA_ROWS_CACHE_LIMIT = 300;
const roomMediaRowsCache = new Map();

function cachedRoomMediaRows(postId) {
  const entry = roomMediaRowsCache.get(postId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    roomMediaRowsCache.delete(postId);
    return null;
  }
  return entry.rows;
}

function rememberRoomMediaRows(postId, rows) {
  if (!postId) return;
  roomMediaRowsCache.delete(postId);
  roomMediaRowsCache.set(postId, {
    rows: Array.isArray(rows) ? rows.slice(0, 4) : [],
    expiresAt: Date.now() + ROOM_MEDIA_ROWS_CACHE_TTL_MS,
  });
  while (roomMediaRowsCache.size > ROOM_MEDIA_ROWS_CACHE_LIMIT) {
    const oldest = roomMediaRowsCache.keys().next().value;
    if (!oldest) break;
    roomMediaRowsCache.delete(oldest);
  }
}

async function primeRoomStreamMediaRows(postIds) {
  const ids = [...new Set((postIds || []).filter(Boolean))];
  const missing = ids.filter((postId) => cachedRoomMediaRows(postId) === null);
  if (!missing.length) return;

  const { data, error } = await supabase
    .from('social_post_media')
    .select('post_id,id,media_kind,content_type,width,height,duration_ms,alt_text,position')
    .in('post_id', missing)
    .eq('upload_status', 'attached')
    .order('position', { ascending: true });
  if (error) return;

  const grouped = new Map(missing.map((postId) => [postId, []]));
  (data || []).forEach((row) => {
    const rows = grouped.get(row.post_id);
    if (rows && rows.length < 4) rows.push(row);
  });
  grouped.forEach((rows, postId) => rememberRoomMediaRows(postId, rows));
}

async function loadSautiMediaRows(postId) {
  const cached = cachedRoomMediaRows(postId);
  if (cached !== null) return cached;

  const { data, error } = await supabase
    .from('social_post_media')
    .select('id,media_kind,content_type,width,height,duration_ms,alt_text,position')
    .eq('post_id', postId)
    .eq('upload_status', 'attached')
    .order('position', { ascending: true });
  if (error) return [];
  const rows = Array.isArray(data) ? data.slice(0, 4) : [];
  rememberRoomMediaRows(postId, rows);
  return rows;
}`,
    'post media metadata loader',
  );

  output = replaceRequired(
    output,
    `    const rows = posts || [];
    const hydrated = await hydrateDirectPosts(rows);`,
    `    const rows = posts || [];
    const [hydrated] = await Promise.all([
      hydrateDirectPosts(rows),
      primeRoomStreamMediaRows(rows.map((post) => post.id)),
    ]);`,
    'Room stream hydration',
  );

  output = replaceRequired(
    output,
    `async function loadCircleDetail(slug) {
  if (!currentMemberId) return;
  const requestId = ++circlesRequest;
  activeCircle = null;
  resetCircleStreamView({ hide: true });
  showCircleRouteState('loading', slug);

  const { data: circle, error } = await supabase
    .from('social_circles')
    .select('id, owner_id, slug, name, description, join_policy, created_at')`,
    `async function loadCircleDetail(slug) {
  if (!currentMemberId) return;
  const requestId = ++circlesRequest;
  activeCircle = null;
  resetCircleStreamView({ hide: true });
  showCircleRouteState('loading', slug);

  const { data: circle, error } = await supabase
    .from('social_circles')
    .select('id, owner_id, slug, name, description, join_policy, created_at, category, privacy, cover_key, member_count, post_permission, invite_permission, updated_at')`,
    'Room detail metadata query',
  );

  output = replaceRequired(
    output,
    `  const membership = membershipResult.data || null;
  const request = requestResult.data || null;
  activeCircle = { circle, membership, request };

  resetCircleRouteViews();`,
    `  const membership = membershipResult.data || null;
  const request = requestResult.data || null;
  activeCircle = { circle, membership, request };
  window.__sautiRoomDetailSnapshot = Object.freeze({ room: circle, capturedAt: Date.now() });

  resetCircleRouteViews();`,
    'Room detail runtime snapshot',
  );

  output = replaceRequired(
    output,
    `  byId('circle-requests').hidden = true;
  byId('circle-members').hidden = true;
  if (circle.owner_id === currentMemberId) {
    await Promise.all([
      loadCircleRequests(circle.id),
      loadCircleMembers(circle.id),
    ]);
  }
}`,
    `  byId('circle-requests').hidden = true;
  byId('circle-members').hidden = true;
  if (circle.owner_id === currentMemberId) {
    const loadOwnerRoomManagement = () => Promise.all([
      loadCircleRequests(circle.id),
      loadCircleMembers(circle.id),
    ]);
    const runOwnerRoomManagement = () => {
      if (activeCircle?.circle?.id !== circle.id) return;
      void loadOwnerRoomManagement();
    };
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(runOwnerRoomManagement, { timeout: 1800 });
    } else {
      window.setTimeout(runOwnerRoomManagement, 350);
    }
  }
}`,
    'owner Room management eager load',
  );

  return output;
}

function transformRoomsPlatformSource(source) {
  let output = source;

  output = replaceRequired(
    output,
    `let roomDetailKey = '';`,
    `let roomDetailKey = '';
const ROOM_DISCOVERY_CACHE_TTL_MS = 30 * 1000;
const ROOM_DETAIL_CACHE_TTL_MS = 15 * 1000;
const ROOM_ROLE_CACHE_TTL_MS = 15 * 1000;
const roomDiscoveryRuntimeCache = { rows: null, expiresAt: 0, promise: null };
const roomDetailRuntimeCache = new Map();
const roomRoleRuntimeCache = new Map();`,
    'Room runtime cache state',
  );

  output = replaceRequired(
    output,
    `async function enhanceRoomCards() {
  const cards = [...document.querySelectorAll('.circle-card[data-circle-slug]')];
  if (!cards.length) return;
  const rows = await roomSelect('social_circles', {
    select: 'id,slug,name,category,privacy,cover_key,member_count,join_policy',
    order: 'created_at.desc',
    limit: 100,
  });`,
    `async function roomDiscoveryRows() {
  const now = Date.now();
  if (roomDiscoveryRuntimeCache.rows && roomDiscoveryRuntimeCache.expiresAt > now) {
    return roomDiscoveryRuntimeCache.rows;
  }
  if (roomDiscoveryRuntimeCache.promise) return roomDiscoveryRuntimeCache.promise;

  const promise = roomSelect('social_circles', {
    select: 'id,slug,name,category,privacy,cover_key,member_count,join_policy',
    order: 'created_at.desc',
    limit: 100,
  }).then((rows) => {
    roomDiscoveryRuntimeCache.rows = rows;
    roomDiscoveryRuntimeCache.expiresAt = Date.now() + ROOM_DISCOVERY_CACHE_TTL_MS;
    return rows;
  }).finally(() => {
    if (roomDiscoveryRuntimeCache.promise === promise) roomDiscoveryRuntimeCache.promise = null;
  });
  roomDiscoveryRuntimeCache.promise = promise;
  return promise;
}

async function enhanceRoomCards() {
  const cards = [...document.querySelectorAll('.circle-card[data-circle-slug]')];
  if (!cards.length) return;
  const rows = await roomDiscoveryRows();`,
    'Room discovery metadata fetch',
  );

  output = replaceRequired(
    output,
    `async function activeRoom() {
  const slug = activeRoomSlug();
  if (!slug) return null;
  const rows = await roomSelect('social_circles', {
    slug: \`eq.\${slug}\`,
    select: 'id,owner_id,slug,name,description,join_policy,category,privacy,cover_key,member_count,post_permission,invite_permission,updated_at',
    limit: 1,
  });
  return rows[0] || null;
}

async function ownRoomRole(roomId) {
  const user = await roomCurrentUser();
  if (!user || !roomId) return '';
  const rows = await roomSelect('social_circle_members', {
    circle_id: \`eq.\${roomId}\`,
    member_id: \`eq.\${user.id}\`,
    select: 'member_role',
    limit: 1,
  });
  return String(rows[0]?.member_role || '');
}`,
    `function rememberRoomDetail(slug, room) {
  roomDetailRuntimeCache.delete(slug);
  roomDetailRuntimeCache.set(slug, {
    room,
    expiresAt: Date.now() + ROOM_DETAIL_CACHE_TTL_MS,
    promise: null,
  });
  while (roomDetailRuntimeCache.size > 24) {
    const oldest = roomDetailRuntimeCache.keys().next().value;
    if (!oldest) break;
    roomDetailRuntimeCache.delete(oldest);
  }
  return room;
}

function invalidateRoomRuntimeCaches({ slug = '', roomId = '', discovery = false, role = false } = {}) {
  if (discovery) {
    roomDiscoveryRuntimeCache.rows = null;
    roomDiscoveryRuntimeCache.expiresAt = 0;
  }
  if (slug) roomDetailRuntimeCache.delete(slug);
  if (roomId) {
    [...roomDetailRuntimeCache.entries()].forEach(([key, entry]) => {
      if (entry?.room?.id === roomId) roomDetailRuntimeCache.delete(key);
    });
  }
  if (role) roomRoleRuntimeCache.clear();
}

async function activeRoom() {
  const slug = activeRoomSlug();
  if (!slug) return null;

  const snapshot = window.__sautiRoomDetailSnapshot;
  if (snapshot?.room?.slug === slug
      && Number(snapshot.capturedAt || 0) + ROOM_DETAIL_CACHE_TTL_MS > Date.now()) {
    return rememberRoomDetail(slug, snapshot.room);
  }

  const cached = roomDetailRuntimeCache.get(slug);
  if (cached?.room && cached.expiresAt > Date.now()) return cached.room;
  if (cached?.promise) return cached.promise;

  const promise = roomSelect('social_circles', {
    slug: \`eq.\${slug}\`,
    select: 'id,owner_id,slug,name,description,join_policy,category,privacy,cover_key,member_count,post_permission,invite_permission,updated_at',
    limit: 1,
  }).then((rows) => rememberRoomDetail(slug, rows[0] || null));
  roomDetailRuntimeCache.set(slug, {
    room: cached?.room || null,
    expiresAt: cached?.expiresAt || 0,
    promise,
  });
  return promise;
}

async function ownRoomRole(roomId) {
  const user = await roomCurrentUser();
  if (!user || !roomId) return '';
  const key = \`\${user.id}:\${roomId}\`;
  const cached = roomRoleRuntimeCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.role;
  if (cached?.promise) return cached.promise;

  const promise = roomSelect('social_circle_members', {
    circle_id: \`eq.\${roomId}\`,
    member_id: \`eq.\${user.id}\`,
    select: 'member_role',
    limit: 1,
  }).then((rows) => {
    const role = String(rows[0]?.member_role || '');
    roomRoleRuntimeCache.set(key, {
      role,
      expiresAt: Date.now() + ROOM_ROLE_CACHE_TTL_MS,
      promise: null,
    });
    return role;
  });
  roomRoleRuntimeCache.set(key, { role: cached?.role || '', expiresAt: 0, promise });
  return promise;
}`,
    'active Room and role lookups',
  );

  output = replaceRequired(
    output,
    `function buildRoomAdminPanel(room, role) {`,
    `function scheduleRoomPeopleLoad(room, viewerRole, root) {
  if (!root || root.dataset.roomPeopleState) return;
  root.dataset.roomPeopleState = 'scheduled';

  const run = () => {
    if (!root.isConnected || root.dataset.roomPeopleState === 'loading' || root.dataset.roomPeopleState === 'loaded') return;
    root.dataset.roomPeopleState = 'loading';
    Promise.resolve(loadRoomPeople(room, viewerRole, root))
      .finally(() => { if (root.isConnected) root.dataset.roomPeopleState = 'loaded'; });
  };

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      run();
    }, { rootMargin: '360px 0px' });
    observer.observe(root);
    return;
  }

  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 1600 });
  else window.setTimeout(run, 250);
}

function buildRoomAdminPanel(room, role) {`,
    'lazy Room people loader',
  );

  output = replaceRequired(
    output,
    `    loadRoomPeople(room, role, people);`,
    `    scheduleRoomPeopleLoad(room, role, people);`,
    'eager Room people load',
  );

  output = replaceRequired(
    output,
    `      roomStatus(message, 'Room settings saved.', true);
      roomToast('Room settings saved.');
      roomDetailKey = '';`,
    `      roomStatus(message, 'Room settings saved.', true);
      roomToast('Room settings saved.');
      invalidateRoomRuntimeCaches({ slug: room.slug, roomId: room.id, discovery: true });
      if (nextSlug !== room.slug) roomDetailRuntimeCache.delete(nextSlug);
      roomDetailKey = '';`,
    'Room settings cache invalidation',
  );

  output = replaceRequired(
    output,
    `  const slug = payload?.data?.slug;
  if (slug && roomCoverCache.has(slug)) {`,
    `  const slug = payload?.data?.slug;
  invalidateRoomRuntimeCaches({ slug, roomId, discovery: true });
  if (slug && roomCoverCache.has(slug)) {`,
    'Room cover upload cache invalidation',
  );

  output = replaceRequired(
    output,
    `  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'Room cover removal failed.');
  if (roomCoverCache.has(slug)) {`,
    `  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'Room cover removal failed.');
  invalidateRoomRuntimeCaches({ slug, roomId, discovery: true });
  if (roomCoverCache.has(slug)) {`,
    'Room cover removal cache invalidation',
  );

  output = replaceRequired(
    output,
    `function scheduleRoomsUi() {
  window.clearTimeout(roomUiTimer);
  roomUiTimer = window.setTimeout(() => {
    brandRoomsShell();
    enhanceRoomCreateForm();
    ensureRoomDiscoveryControls();
    enhanceRoomCards();
    enhanceActiveRoom();
  }, 80);
}`,
    `function roomDetailRouteActive() {
  const detail = roomById('circle-detail');
  return Boolean(detail && !detail.hidden)
    || /^\\/rooms\\/[^/]+\\/?$/.test(location.pathname);
}

function scheduleRoomsUi() {
  window.clearTimeout(roomUiTimer);
  roomUiTimer = window.setTimeout(() => {
    brandRoomsShell();
    enhanceRoomCreateForm();
    ensureRoomDiscoveryControls();
    if (roomDetailRouteActive()) enhanceActiveRoom();
    else enhanceRoomCards();
  }, 80);
}`,
    'Room UI scoped scheduling',
  );

  return output;
}

export function transformRoomOpenPerformanceSource(filePath, source) {
  const path = normalizedPath(filePath);
  if (path.endsWith('/src/app.js') || path.endsWith('src/app.js')) return transformAppSource(source);
  if (path.endsWith('/src/rooms-platform.js') || path.endsWith('src/rooms-platform.js')) {
    return transformRoomsPlatformSource(source);
  }
  return source;
}
