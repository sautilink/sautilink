import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = (await readFile(new URL('../src/guest-entry-gate.js', import.meta.url), 'utf8'))
  .replace(/^import .+;\r?\n/gm, '').replace(/^export /gm, '')
  .split('if (document.readyState')[0];

class Surface {
  constructor() { this.attrs = new Map(); this.hidden = true; this.inert = false; this.children = []; this.dataset = {}; }
  classList = { values: new Set(), add(value) { this.values.add(value); }, remove(value) { this.values.delete(value); }, contains(value) { return this.values.has(value); } };
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  removeAttribute(key) { this.attrs.delete(key); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener() {}
}

function fixture() {
  const body = new Surface(), html = new Surface(), member = new Surface(), auth = new Surface();
  body.classList.add('auth-entry');
  const nodes = new Map([['member-view', member], ['auth-view', auth]]);
  let stored = null;
  let memberId = '';
  let observer;
  const formatted = [];
  const document = {
    body, documentElement: html, getElementById: id => nodes.get(id),
    createElement: () => new Surface(), createElementNS: () => new Surface(),
  };
  const context = {
    document, Intl, URL, URLSearchParams,
    window: { localStorage: { getItem: () => stored }, __sautilinkMessagesUserId: () => memberId },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    appendFormattedPostText: (parent, value) => { formatted.push({ parent, value }); },
  };
  const api = runInNewContext(`${source}\n({parseStoredSession,lockUnderlyingApp,watchGuestMemberSurface,memberSurfaceReady,renderGuestPost});`, context);
  return {api,body,html,member,auth,nodes,formatted,setStored(value){stored=value;},setMemberId(value){memberId=value;},get observer(){return observer;}};
}

test('guest presentation recognizes every stored-session envelope already supported by member bootstrap', () => {
  const f = fixture();
  const session = { access_token: 'fixture-only', user: { id: 'fixture-member' } };
  for (const shape of [session, { currentSession: session }, { session }]) {
    f.setStored(JSON.stringify(shape));
    assert.equal(f.api.parseStoredSession()?.user.id, session.user.id);
  }
  for (const shape of [null, '{}', '{broken', JSON.stringify({session:{user:{id:'no-token'}}}), JSON.stringify({access_token:'no-user'})]) {
    f.setStored(shape);
    assert.equal(f.api.parseStoredSession(), null);
  }
});

test('late member readiness removes the guest overlay and restores only its presentation locks', () => {
  const f = fixture();
  f.auth.inert = true;
  f.auth.setAttribute('aria-hidden', 'false');
  const removed = [];
  for (const id of ['sautilink-guest-post-gate','sautilink-guest-profile-gate','sautilink-guest-action-dialog']) {
    f.nodes.set(id, {remove(){removed.push(id);f.nodes.delete(id);}});
  }
  f.api.lockUnderlyingApp();
  f.api.watchGuestMemberSurface();
  assert.equal(f.member.inert, true);
  assert.equal(f.member.getAttribute('aria-hidden'), 'true');
  assert.equal(f.html.classList.contains('sautilink-guest-profile-locked'), true);
  // A local-storage write alone must never grant access or unlock the app.
  f.setStored(JSON.stringify({access_token:'fixture',user:{id:'fixture-member'}}));
  f.observer.callback();
  assert.equal(removed.length, 0);
  f.member.hidden = false;
  f.observer.callback();
  assert.equal(removed.length, 0, 'The auth surface is still active');
  f.body.classList.remove('auth-entry');
  f.observer.callback();
  assert.equal(removed.length, 0, 'A signed-out profile may also show member-view; it must remain gated');
  f.setMemberId('fixture-member');
  f.observer.callback();
  assert.equal(removed.length, 2);
  assert.ok(f.nodes.has('sautilink-guest-profile-gate'), 'Existing profile teaser is outside this post-only cleanup');
  assert.equal(f.member.inert, false);
  assert.equal(f.member.getAttribute('aria-hidden'), null);
  assert.equal(f.auth.inert, true, 'An original lock owned elsewhere must survive');
  assert.equal(f.auth.getAttribute('aria-hidden'), 'false');
  assert.equal(f.html.classList.contains('sautilink-guest-profile-locked'), false);
  assert.equal(f.observer.disconnected, true);
});

test('public post rendering delegates raw caption to the shared rich-text renderer and keeps all gated actions', () => {
  const f = fixture(), card = new Surface();
  const body = '**SautiLink**\n*Karibu* __leo__ ~~sasa~~ #sautilink';
  f.api.renderGuestPost(card, {body,author:{username:'benlinker',display_name:'BenLinker'},counts:{likes:3,comments:1,reposts:2},media:[]}, {destination:'/post/fixture?view=post'});
  assert.equal(f.formatted.length, 1);
  assert.equal(f.formatted[0].value, body);
  assert.equal(f.formatted[0].parent.className, 'guest-post-body');
  const actions = card.children.find(node=>node.className==='guest-post-actions');
  assert.deepEqual(actions.children.map(node=>node.dataset.guestPostAction), ['like','comments','repost','share','save']);
  const join = card.children.find(node=>node.className==='guest-post-join');
  const links = join.children.at(-1).children;
  assert.equal(links[0].href, '/login?next=%2Fpost%2Ffixture%3Fview%3Dpost');
  assert.equal(links[1].href, '/signup?next=%2Fpost%2Ffixture%3Fview%3Dpost');
});
