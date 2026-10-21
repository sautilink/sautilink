import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/rooms-invitations.js', import.meta.url), 'utf8');
const VIEWER = 'e1000000-0000-4000-8000-000000000001';
const TARGET = 'e1000000-0000-4000-8000-000000000002';
const ROOM = 'e2000000-0000-4000-8000-000000000001';
const ENDED = '2026-10-21T01:02:03.456789+00:00';
const CREATED = '2026-10-20T01:02:03.123456+00:00';
const receipt = (overrides = {}) => ({ room_id:ROOM, invited_user_id:TARGET, invited_by:VIEWER,
  created_at:CREATED, status:'accepted', membership_ended_at:ENDED, ...overrides });

async function browser(options = {}) {
  const ids = new Map();
  const elements = [];
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.listeners = new Map(); this.hidden = false; elements.push(this); }
    set id(value) { this._id = value; ids.set(value, this); }
    get id() { return this._id; }
    append(...children) { this.children.push(...children); }
    insertBefore(child) { this.append(child); }
    setAttribute() {}
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    remove() { ids.delete(this.id); }
  }
  const detail = new Element('section');
  detail.id = 'circle-detail';
  const state = { current:options.previous ? structuredClone(options.previous) : null,
    member:Boolean(options.member), calls:[] };
  let beforeDelete = options.beforeDelete;
  let beforePost = options.beforePost;
  const matches = (row, params) => {
    if (!row) return false;
    for (const [key, value] of Object.entries(params)) {
      if (key === 'and') {
        const match = value.match(/^\(membership_ended_at\.not\.is\.null,membership_ended_at\.eq\.(".*")\)$/);
        assert.ok(match, 'DELETE must constrain a nonnull, exact observed end marker');
        if (row.membership_ended_at == null || row.membership_ended_at !== JSON.parse(match[1])) return false;
      } else {
        assert.ok(value.startsWith('eq.'), 'Only explicit equality filters are expected');
        if (row[key] !== value.slice(3)) return false;
      }
    }
    return true;
  };
  const fetch = async (input, init = {}) => {
    const url = new URL(input);
    const call = { method:init.method || 'GET', path:url.pathname, params:Object.fromEntries(url.searchParams),
      body:init.body ? JSON.parse(init.body) : null, headers:init.headers };
    state.calls.push(call);
    if (url.pathname === '/auth/v1/user') return Response.json({ id:VIEWER });
    if (url.pathname === '/rest/v1/social_circles') {
      return Response.json([{ id:ROOM, slug:'builders', name:'Builders', invite_permission:'staff' }]);
    }
    if (url.pathname === '/rest/v1/social_profiles') return Response.json([{ id:TARGET, username:'member', display_name:'Member' }]);
    if (url.pathname === '/rest/v1/social_circle_members') {
      return Response.json(call.params.select === 'member_role' ? [{ member_role:'owner' }] : state.member ? [{ member_id:TARGET }] : []);
    }
    assert.equal(url.pathname, '/rest/v1/social_room_invitations');
    if (call.method === 'GET') return Response.json(state.current ? [state.current] : []);
    if (call.method === 'DELETE') {
      beforeDelete?.(state, call);
      beforeDelete = null;
      if (options.deleteThrows) throw new Error('Synthetic offline transport');
      if (options.deleteStatus) return Response.json({ message:'Invitation deletion denied' }, { status:options.deleteStatus });
      if (options.deletePayload !== undefined) return Response.json(options.deletePayload);
      // Model filtered DELETE and the actual policy's current-membership guard.
      if (!matches(state.current, call.params) || (state.current.status === 'accepted' && state.member)) return Response.json([]);
      const removed = state.current;
      state.current = null;
      return Response.json([removed]);
    }
    assert.equal(call.method, 'POST');
    beforePost?.(state, call);
    beforePost = null;
    if (state.current) return Response.json({ message:'A fresh invitation already exists' }, { status:409 });
    if (state.member) return Response.json({ message:'That person is already a Room member' }, { status:403 });
    state.current = { ...call.body, created_at:'2026-10-21T05:00:00+00:00', membership_ended_at:null };
    return Response.json([state.current], { status:201 });
  };
  const context = vm.createContext({ URL, fetch, console,
    localStorage:{ getItem:() => JSON.stringify({ access_token:'synthetic-test-session' }) },
    location:{ pathname:'/rooms/builders' },
    document:{ body:new Element('body'), getElementById:id => ids.get(id) || null, createElement:tag => new Element(tag) },
    window:{ clearTimeout() {}, setTimeout:() => 1, addEventListener() {} },
    MutationObserver:class { observe() {} },
  });
  vm.runInContext(source, context, { filename:'rooms-invitations.js' });
  await vm.runInContext('ensureRoomInvitePanel()', context);
  const form = elements.find(element => element.tagName === 'form');
  const input = elements.find(element => element.tagName === 'input');
  const button = elements.find(element => element.tagName === 'button');
  const message = ids.get('room-invite-panel').children.at(-1);
  input.value = 'member';
  return { state, input, button, message,
    writes:() => state.calls.filter(call => ['DELETE','POST'].includes(call.method)),
    async submit() { await form.listeners.get('submit')({ preventDefault() {} }); },
  };
}

test('actual invitation form clears only the observed ended receipt before sending a fresh pending invitation', async () => {
  const page = await browser({ previous:receipt() });
  await page.submit();
  const previousRead = page.state.calls.find(call => call.path.endsWith('/social_room_invitations') && call.method === 'GET');
  assert.equal(previousRead.params.select, 'status,membership_ended_at,created_at,invited_by');
  const writes = page.writes();
  assert.deepEqual(writes.map(call => call.method), ['DELETE','POST']);
  assert.deepEqual(writes[0].params, { room_id:`eq.${ROOM}`, invited_user_id:`eq.${TARGET}`,
    status:'eq.accepted', created_at:`eq.${CREATED}`, invited_by:`eq.${VIEWER}`,
    and:`(membership_ended_at.not.is.null,membership_ended_at.eq.${JSON.stringify(ENDED)})` });
  assert.equal(writes[0].headers.Prefer, 'return=representation');
  assert.deepEqual(writes[1].body, { room_id:ROOM, invited_user_id:TARGET, invited_by:VIEWER, status:'pending' });
  assert.equal(page.input.value, '');
  assert.equal(page.button.disabled, false);
  assert.equal(page.message.hidden, true);
});

test('pending, active accepted and pre-marker accepted invitations never trigger a write', async () => {
  for (const previous of [receipt({ status:'pending', membership_ended_at:null }),
    receipt({ membership_ended_at:null }), receipt({ membership_ended_at:undefined })]) {
    const page = await browser({ previous });
    await page.submit();
    assert.deepEqual(page.writes(), []);
    assert.equal(page.message.hidden, false);
    assert.equal(page.input.value, 'member');
    assert.equal(page.button.disabled, false);
  }
});

test('new invitations and the existing declined retry retain their ordinary behavior', async () => {
  const fresh = await browser();
  await fresh.submit();
  assert.deepEqual(fresh.writes().map(call => call.method), ['POST']);
  const declined = await browser({ previous:receipt({ status:'declined', membership_ended_at:null }) });
  await declined.submit();
  assert.deepEqual(declined.writes().map(call => call.method), ['DELETE','POST']);
  assert.deepEqual(declined.writes()[0].params, { room_id:`eq.${ROOM}`, invited_user_id:`eq.${TARGET}`, status:'eq.declined' });
  assert.equal(declined.state.current.status, 'pending');
});

test('a fresh pending or active accepted invitation arriving before DELETE is preserved and stops POST', async () => {
  for (const replacement of [receipt({ status:'pending', membership_ended_at:null }), receipt({ membership_ended_at:null })]) {
    const page = await browser({ previous:receipt(), beforeDelete(state) { state.current = structuredClone(replacement); } });
    await page.submit();
    assert.deepEqual(page.writes().map(call => call.method), ['DELETE']);
    assert.deepEqual(page.state.current, replacement);
    assert.match(page.message.textContent, /invitation changed/i);
  }
});

test('a later historical receipt with a different end marker, creation time or inviter is never deleted', async () => {
  for (const changed of [{ membership_ended_at:'2026-10-21T02:00:00+00:00' },
    { created_at:'2026-10-21T01:00:00+00:00' }, { invited_by:'e1000000-0000-4000-8000-000000000003' }]) {
    const replacement = receipt(changed);
    const page = await browser({ previous:receipt(), beforeDelete(state) { state.current = replacement; } });
    await page.submit();
    assert.deepEqual(page.writes().map(call => call.method), ['DELETE']);
    assert.equal(page.state.current, replacement);
    assert.match(page.message.textContent, /invitation changed/i);
  }
});

test('current membership blocks the form and membership racing the DELETE is rejected by policy', async () => {
  const current = await browser({ previous:receipt(), member:true });
  await current.submit();
  assert.deepEqual(current.writes(), []);
  assert.match(current.message.textContent, /already a member/i);
  const raced = await browser({ previous:receipt(), beforeDelete(state) { state.member = true; } });
  await raced.submit();
  assert.deepEqual(raced.writes().map(call => call.method), ['DELETE']);
  assert.equal(raced.state.current.status, 'accepted');
});

test('denied, offline, empty or malformed DELETE replies never cause a pending invitation insert', async () => {
  for (const failure of [{ deleteStatus:403 }, { deleteThrows:true }, { deletePayload:[] }, { deletePayload:{} }]) {
    const page = await browser({ previous:receipt(), ...failure });
    await page.submit();
    assert.deepEqual(page.writes().map(call => call.method), ['DELETE']);
    assert.equal(page.message.hidden, false);
    assert.equal(page.button.disabled, false);
    assert.equal(page.input.value, 'member');
  }
});

test('a fresh invitation or membership racing the final POST is retained without upsert or destructive retry', async () => {
  for (const membership of [false,true]) {
    const replacement = receipt({ status:'pending', membership_ended_at:null });
    const page = await browser({ previous:receipt(), beforePost(state) {
      if (membership) state.member = true;
      else state.current = replacement;
    } });
    await page.submit();
    assert.deepEqual(page.writes().map(call => call.method), ['DELETE','POST']);
    assert.ok(!page.writes()[1].headers.Prefer.includes('resolution='));
    assert.equal(page.message.hidden, false);
    if (!membership) assert.equal(page.state.current, replacement);
    else assert.equal(page.state.current, null);
  }
});
