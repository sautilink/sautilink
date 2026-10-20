import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformRoomsStartupIsolationSource } from '../scripts/rooms-startup-isolation-source-transform.mjs';

const sourceUrl = new URL('../src/rooms-facebook-ui.js', import.meta.url);
const source = transformRoomsStartupIsolationSource(sourceUrl.pathname, await readFile(sourceUrl, 'utf8'));
const section = (start, end) => source.slice(source.indexOf(`function ${start}(`), source.indexOf(`\nfunction ${end}(`));

test('repeated Room information syncs keep the same DOM and animated icons until visible data changes', () => {
  let mutations = 0;
  const nodes = [];
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.value = ''; this.copy = ''; nodes.push(this); }
    get textContent() { return this.copy + this.children.map((node) => node.textContent).join(''); }
    set textContent(value) { this.copy = String(value); this.children = []; mutations += 1; }
    append(...children) { this.children.push(...children); mutations += 1; }
    replaceChildren(...children) { this.children = children; this.copy = ''; mutations += 1; }
    querySelector(selector) {
      const key = {
        '[data-room-fb-about-description]': 'roomFbAboutDescription',
        '[data-room-fb-privacy]': 'roomFbPrivacy',
        '[data-room-fb-members]': 'roomFbMembers',
      }[selector];
      return this.children.find((child) => Object.hasOwn(child.dataset, key)) || null;
    }
  }
  const make = (id, text) => { const node = new Element('p'); node.id = id; node.textContent = text; return node; };
  const description = make('circle-detail-description', 'A community of builders.');
  const policy = make('circle-detail-policy', 'Public Room');
  const membership = make('circle-detail-membership', 'Member');
  const count = make('test-member-count', '42 members');
  const ensure = runInNewContext(`
    ${section('roomFbPrivacyCopy', 'ensureRoomAboutCard')}
    ${section('ensureRoomAboutCard', 'ensureRoomDetailActions')}
    ensureRoomAboutCard;
  `, {
    roomFbById: (id) => nodes.find((node) => node.id === id),
    roomFbIcon: () => new Element('svg'),
    document: { createElement: (tag) => new Element(tag), querySelector: () => count },
  });

  const card = ensure();
  const privacy = card.querySelector('[data-room-fb-privacy]');
  const members = card.querySelector('[data-room-fb-members]');
  const initialPrivacyIcon = privacy.children[0];
  const initialMembersIcon = members.children[0];
  const initialMutations = mutations;
  for (let index = 0; index < 50; index += 1) assert.equal(ensure(), card);
  assert.equal(mutations, initialMutations, 'an idle Room must not keep triggering its own DOM observer');
  assert.equal(privacy.children[0], initialPrivacyIcon);
  assert.equal(members.children[0], initialMembersIcon);

  description.textContent = 'Updated description.';
  count.textContent = '43 members';
  membership.textContent = 'Admin';
  ensure();
  assert.equal(card.querySelector('[data-room-fb-about-description]').textContent, 'Updated description.');
  assert.equal(privacy.children[0], initialPrivacyIcon, 'unaffected icons keep their player and DOM state');
  assert.notEqual(members.children[0], initialMembersIcon);
  assert.match(members.textContent, /43 members · Admin/);
  const updatedMembersIcon = members.children[0];
  policy.textContent = 'Private Room';
  ensure();
  assert.notEqual(privacy.children[0], initialPrivacyIcon);
  assert.match(privacy.textContent, /PrivateOnly members can see/);
  assert.equal(members.children[0], updatedMembersIcon);
  const settledMutations = mutations;
  ensure();
  assert.equal(mutations, settledMutations);
});

test('switching Your Rooms back to Discover restores matching cards without dropping search or category filters', () => {
  const search = { value: '' };
  const category = { value: 'all' };
  const makeCard = (state, query, roomCategory) => ({
    hidden: false, dataset: { roomSearch: query, roomCategory }, textContent: query,
    querySelector: () => ({ textContent: state }),
  });
  const joined = makeCard('Joined', 'Developers building software', 'technology');
  const publicRoom = makeCard('Open', 'Designers building products', 'technology');
  const otherCategory = makeCard('Owner', 'Musicians making music', 'music');
  const cards = [joined, publicRoom, otherCategory];
  const api = runInNewContext(`
    let roomsFacebookFilter = 'discover';
    ${section('syncRoomLandingFilter', 'selectRoomDetailSection')}
    (filter) => { roomsFacebookFilter = filter; syncRoomLandingFilter(); };
  `, {
    roomFbById: (id) => id === 'room-search' ? search : id === 'room-category-filter' ? category : null,
    document: { querySelectorAll: () => cards },
  });

  api('joined');
  assert.deepEqual(cards.map((card) => card.hidden), [false, true, false]);
  api('discover');
  assert.deepEqual(cards.map((card) => card.hidden), [false, false, false]);
  search.value = 'building';
  category.value = 'technology';
  api('joined');
  assert.deepEqual(cards.map((card) => card.hidden), [false, true, true]);
  api('discover');
  assert.deepEqual(cards.map((card) => card.hidden), [false, false, true]);
});

const platformSource = await readFile(new URL('../src/rooms-platform.js', import.meta.url), 'utf8');
const detailPresentation = platformSource.slice(platformSource.indexOf('function enhanceRoomDetail('), platformSource.indexOf('\nfunction settingsField('));

test('Room metadata rows remain inert on repeated presentation and still refresh changed or reset content', () => {
  let mutations = 0;
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.copy = ''; }
    get childElementCount() { return this.children.filter((node) => node.element !== false).length; }
    get textContent() { return this.copy + this.children.map((node) => node.textContent).join(''); }
    set textContent(value) { this.copy = String(value); this.children = []; mutations += 1; }
    append(...children) { this.children.push(...children); mutations += 1; }
    replaceChildren(...children) { this.children = children; this.copy = ''; mutations += 1; }
  }
  const badges = new Element();
  const permissions = new Element();
  const cover = new Element();
  const card = { querySelector: (selector) => ({
    '.room-detail-cover': cover, '.room-detail-badges': badges, '.room-permissions-summary': permissions,
  })[selector] };
  const present = runInNewContext(`${detailPresentation}\nenhanceRoomDetail;`, {
    roomById: (id) => id === 'circle-detail' ? { querySelector: () => card } : null,
    ROOM_CATEGORY_LABELS: new Map([['technology', 'Technology'], ['music', 'Music']]),
    document: {
      createElement: () => new Element(),
      createTextNode: (text) => ({ element: false, textContent: text }),
    },
    attachRoomCover() { assert.fail('Metadata presentation must not request a cover without its existing key'); },
  });
  const room = { category: 'technology', privacy: 'public', member_count: 42, post_permission: 'all_members', invite_permission: 'all_members' };
  present(room, 'member');
  const initialBadge = badges.children[0];
  const initialPermission = permissions.children[0];
  const initialMutations = mutations;
  for (let index = 0; index < 50; index += 1) present(room, 'member');
  assert.equal(mutations, initialMutations, 'unchanged metadata must not restart the global Room observers');
  assert.equal(badges.children[0], initialBadge);
  assert.equal(permissions.children[0], initialPermission);

  present({ ...room, category: 'music', privacy: 'private', member_count: 1 }, 'admin');
  assert.equal(badges.textContent, 'MusicPrivate Room1 member');
  assert.notEqual(badges.children[0], initialBadge);
  assert.equal(permissions.children[0], initialPermission);
  const changedBadge = badges.children[0];
  const restrictedRoom = { ...room, category: 'music', privacy: 'private', member_count: 1, post_permission: 'staff_only' };
  present(restrictedRoom, 'admin');
  assert.equal(badges.children[0], changedBadge);
  assert.notEqual(permissions.children[0], initialPermission);
  assert.match(permissions.textContent, /PostingAdmins & moderatorsInvitesAll members/);

  // The existing route loader clears rows while reserving their containers.
  // An identical next Room must not leave those containers blank due to a cache hit.
  badges.replaceChildren();
  permissions.replaceChildren();
  present(restrictedRoom, 'admin');
  assert.equal(badges.childElementCount, 3);
  assert.equal(permissions.childElementCount, 2);
  assert.equal(badges.textContent, 'MusicPrivate Room1 member');
  const settledMutations = mutations;
  present(restrictedRoom, 'admin');
  assert.equal(mutations, settledMutations);
});
