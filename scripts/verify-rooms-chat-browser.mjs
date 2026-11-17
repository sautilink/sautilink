import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
const { chromium } = await import(process.env.SAUTILINK_PLAYWRIGHT_MODULE || 'playwright-core');
import { transformRoomsStartupIsolationSource } from './rooms-startup-isolation-source-transform.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const screenshots = resolve(process.env.SAUTILINK_QA_OUTPUT || 'work/rooms-chat-qa');
await mkdir(screenshots, { recursive: true });
const root = resolve(repo, 'dist-production-site');
const html = (await readFile(resolve(root, 'app/index.html'), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = 'src/rooms-facebook-ui.js';
const presentation = transformRoomsStartupIsolationSource('/' + source, await readFile(resolve(repo, source), 'utf8'));
const platform = await readFile(resolve(repo, 'src/rooms-platform.js'), 'utf8');
const invitations = await readFile(resolve(repo, 'src/rooms-invitations.js'), 'utf8');
const extract = (text, name) => text.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))?.[0] || assert.fail(name);
const fixturePlatform = `
const ROOM_CATEGORIES = [['general','General'], ['technology','Technology & AI']];
let roomDetailKey = '', roomInvitePanelKey = '';
const roomById = id => document.getElementById(id);
const fixtureRoom = { id: 'room-a', name:'East Africa Builders', slug:'east-africa-builders', description:'Planning, meetings and resources for our members.', privacy:'private', join_policy:'approval', category:'technology', post_permission:'all_members', invite_permission:'staff_only' };
window.fixtureWrites = [];
const roomPatch = async (...args) => window.fixtureWrites.push(args);
const roomDelete = async (...args) => window.fixtureWrites.push(args);
const roomToast = () => {};
const scheduleRoomsUi = () => {};
const roomStatus = (node, text, success) => { node.textContent = text; node.hidden = false; node.dataset.state = success ? 'success' : 'error'; };
const roomSelect = async table => ({social_circle_members:[{member_id:'owner',member_role:'owner'},{member_id:'member',member_role:'member'}], social_circle_join_requests:[{requester_id:'pending',status:'pending'}],social_profiles:[{id:'owner',display_name:'Amina',username:'amina'},{id:'member',display_name:'Juma',username:'juma'},{id:'pending',display_name:'Neema',username:'neema'}]})[table] || [];
const inviteUser = async () => ({id:'owner'});
const activeInviteRoom = async () => fixtureRoom;
const inviteViewerRole = async () => 'owner';
const inviteSelect = async table => table === 'social_profiles' ? [{id:'new-member',username:'baraka'}] : [];
const inviteWrite = async (...args) => {window.fixtureWrites.push(args); return [];};
const inviteToast = () => {};
${['roomOption','roomSelectControl','settingsField','buildRoomSettings','normalizeRoomSlug','buildRoomAdminPanel','loadRoomPeople','profileLabel','appendPersonIdentity','renderRoomRequests','canChangeMemberRole','canRemoveMember','renderRoomMembers'].map(name => extract(platform, name)).join('\n')}
${extract(invitations, 'canRoomInvite')}
${extract(invitations, 'ensureRoomInvitePanel')}
window.buildFixturePanels = () => { buildRoomAdminPanel(fixtureRoom,'owner'); void ensureRoomInvitePanel(); };
`;
const contentTypes = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/rooms')) return res.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
    if (pathname === '/presentation.js') return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(presentation);
    if (pathname === '/fixture-platform.js') return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(fixturePlatform);
    if (pathname === '/app/assets/rooms-chat.css') return res.writeHead(200, { 'Content-Type': 'text/css' }).end(await readFile(resolve(repo, 'app/assets/rooms-chat.css')));
    const target = resolve(pathname.startsWith('/app/assets/') ? repo : root, '.' + pathname);
    if (!target.startsWith(repo)) throw Error();
    res.writeHead(200, { 'Content-Type': contentTypes[extname(target)] || 'application/octet-stream' }).end(await readFile(target));
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const browser = await chromium.launch({
  executablePath: process.env.SAUTILINK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
try {
  for (const [width, theme] of [[1440,'dark'], [1000,'light'], [390,'dark'], [390,'light']]) {
    const page = await browser.newPage({ viewport: { width, height: 850 }, colorScheme: theme });
    const errors = [];
    page.on('pageerror', (error) => {errors.push(error.message); console.error('PAGE:', error.message);});
    await page.goto('http://127.0.0.1:' + server.address().port + '/rooms');
    await page.addScriptTag({ url: '/fixture-platform.js' });
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      document.body.classList.remove('app-booting', 'auth-entry');
      const id = (key) => document.getElementById(key);
      for (const key of ['auth-view', 'loading-view', 'home-surface', 'stream-surface']) {
        if (id(key)) id(key).hidden = true;
      }
      id('member-view').hidden = false;
      id('circles-surface').hidden = false;
      id('circles-list').hidden = false;
      id('circles-list').innerHTML = [
        ['East Africa Builders','Workshops, notes and team updates','Owner','east-africa-builders','E'],
        ['Studio Sauti','Plan shows and recordings','Joined','studio-sauti','S'],
        ['Open Learning','Find people to learn with','Open to join','open-learning','O'],
      ].map(([name, copy, state, slug, letter]) => `<button class="circle-card" data-circle-slug="${slug}"><span class="room-card-cover" aria-hidden="true">${letter}</span><span class="circle-card-main"><span class="circle-card-top"><h3>${name}</h3></span><span class="circle-card-description">${copy}</span></span><span class="circle-card-state">${state}</span></button>`).join('');
      id('circles-list').addEventListener('click', (event) => {
        const button = event.target.closest('[data-circle-slug]');
        if (!button) return;
        const slug = button.dataset.circleSlug;
        id('circle-detail').hidden = false;
        id('circle-detail-name').textContent = button.querySelector('h3').textContent;
        id('circle-detail-slug').textContent = '/rooms/' + slug;
        id('circle-detail-description').textContent = 'Planning, meetings and resources for our members.';
        id('circle-detail-membership').textContent = 'Owner';
        id('circle-detail-name').closest('.circle-detail-top').insertAdjacentHTML('afterend', '<div class="room-detail-badges"><span>Private Room</span><span>3 members</span></div>');
        id('circle-stream').hidden = false;
        id('circle-sauti-composer').hidden = false;
        id('circle-members').hidden = false;
        id('circle-members-list').innerHTML = '<div class="circle-member-row"><span class="circle-member-person"><strong>Amina</strong></span><span class="circle-member-role">Owner</span></div>';
        id('circle-stream-feed').innerHTML = '<article class="sauti-card"><div class="sauti-card-head"><strong>Amina</strong><time>10:00</time></div><p class="sauti-card-body">Welcome to the Room.</p></article><article class="sauti-card room-message-own"><div class="sauti-card-head"><strong>Baraka</strong><time>10:02</time></div><p class="sauti-card-body">Ready for the meeting!</p></article>';
        for (const card of id('circle-stream-feed').children) {
          const footer = document.createElement('div'); footer.className = 'sauti-card-footer';
          footer.innerHTML = '<div class="sauti-actions"><button type="button" data-sauti-action="like">Like</button><button type="button" data-sauti-action="comments">Comment</button></div>';
          const meta = document.createElement('div'); meta.className = 'sauti-card-meta';
          meta.innerHTML = '<button type="button">Report</button>';
          card.append(footer, meta);
        }
        window.buildFixturePanels();
      });
      id('circle-back').addEventListener('click', () => { id('circle-detail').hidden = true; });
      const directory = document.createElement('div');
      directory.id = 'room-discovery-controls';
      directory.className = 'room-discovery-controls';
      directory.innerHTML = '<input type="search" id="room-search" aria-label="Search Rooms" placeholder="Search Rooms"><select id="room-category-filter"><option value="all">All categories</option></select>';
      id('circles-surface').prepend(directory);
      const images = document.createElement('div'); images.className = 'room-post-image-tools';
      images.innerHTML = '<button type="button" id="room-post-image-add" aria-label="Add photos"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>Photo</span></button>';
      id('circle-sauti-composer').querySelector('.circle-sauti-actions').prepend(images);
      window.fixtureSends = 0;
      id('circle-sauti-composer').addEventListener('submit', event => {event.preventDefault(); window.fixtureSends++;});
    }, theme);
    await page.addScriptTag({ url: '/presentation.js' });
    const first = page.locator('#circles-list button').first();
    const search = page.getByRole('searchbox', { name: 'Search Rooms' });
    await first.waitFor({ state: 'visible' });
    await page.locator('#room-fb-landing-sidebar').waitFor();
    assert.equal(await page.locator('#circles-list button:visible').count(), 2);
    await page.locator('#room-fb-landing-sidebar').getByRole('button', { name: 'Discover' }).click();
    assert.equal(await page.locator('#circles-list button:visible').count(), 3);
    await search.fill('Open Learning');
    assert.equal(await page.locator('#circles-list button:visible').count(), 1);
    await search.fill('');
    await page.getByRole('button', { name: 'Your Rooms' }).click();
    await first.click();
    await page.getByRole('heading', { name: 'East Africa Builders' }).first().waitFor();
    await page.locator('#room-detail-toolbar').waitFor();
    const from = await page.locator('#circle-stream-feed article').first().boundingBox();
    const own = await page.locator('#circle-stream-feed .room-message-own').boundingBox();
    assert.ok(from && own && own.x > from.x, 'outgoing bubble is right aligned at ' + width);
    if (width < 761) assert.equal(await first.isVisible(), false);
    else assert.equal(await first.isVisible(), true);
    const info = page.getByRole('button', { name: 'Room information' });
    await page.getByRole('textbox', {name:'Message', exact:true}).fill('A test message');
    await page.locator('#circle-sauti-submit').evaluate(button => {button.disabled = false;});
    await page.getByRole('textbox', {name:'Message', exact:true}).press('Shift+Enter');
    assert.equal(await page.evaluate(() => window.fixtureSends), 0);
    await page.getByRole('textbox', {name:'Message', exact:true}).press('Enter');
    assert.equal(await page.evaluate(() => window.fixtureSends), 1);
    await page.locator('#circle-sauti-submit').evaluate(button => {button.setAttribute('aria-busy','true');button.textContent='Posting…';});
    await page.locator('#circle-sauti-submit').evaluate(button => {button.textContent='Send';button.removeAttribute('aria-busy');});
    await page.locator('#circle-sauti-submit svg').waitFor();
    await page.locator('#circle-stream-feed article').first().evaluate(card => card.classList.add('has-media'));
    assert.ok(await page.locator('#circle-stream-feed .sauti-card-body').first().isVisible(), 'media captions must remain visible');
    await page.getByLabel('Message options', {exact:true}).click();
    await page.getByLabel('Who can comment in this Room').selectOption('mentioned');
    await page.getByLabel('Message options', {exact:true}).click();
    await page.getByLabel('Message actions', {exact:true}).first().click();
    assert.ok(await page.getByRole('button', {name:'Like',exact:true}).first().isVisible());
    await page.getByLabel('Message actions', {exact:true}).first().press('Escape');
    assert.equal(await page.getByRole('button', {name:'Like',exact:true}).first().isVisible(), false);
    await page.screenshot({path:resolve(screenshots, `rooms-complete-${width}-${theme}-chat.png`)});
    await info.click();
    await page.locator('#room-fb-detail-aside').waitFor();
    assert.deepEqual(errors, []);
    await page.screenshot({path:resolve(screenshots, `rooms-complete-${width}-${theme}-info.png`)});
    await page.getByRole('button', { name: 'Edit group', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Room name' }).inputValue(), 'East Africa Builders');
    await page.getByRole('textbox', {name:'Room name'}).fill('Builders updated');
    await page.getByRole('button', {name:'Save Room settings'}).click();
    assert.equal(await page.evaluate(() => window.fixtureWrites.at(-1)[2].name), 'Builders updated');
    await page.screenshot({ path: resolve(screenshots, `rooms-complete-${width}-${theme}-settings.png`) });
    await page.getByRole('button', {name:'Back to group info'}).click();
    await page.getByRole('button', {name:'Members & requests'}).click();
    await page.getByLabel('Role for Juma').selectOption('moderator');
    assert.equal(await page.evaluate(() => window.fixtureWrites.at(-1)[2].member_role), 'moderator');
    await page.getByRole('button', {name:'Approve',exact:true}).click();
    assert.equal(await page.evaluate(() => window.fixtureWrites.at(-1)[2].status), 'approved');
    await page.getByRole('button', {name:'Back to group info'}).click();
    await page.locator('.room-chat-info-nav').getByRole('button', {name:'Invite members',exact:true}).click();
    await page.getByRole('textbox', {name:'SautiLink username'}).fill('baraka');
    await page.locator('#room-invite-panel').getByRole('button', {name:'Invite',exact:true}).click();
    await page.waitForFunction(() => window.fixtureWrites.some(row => row[0] === 'social_room_invitations'));
    await page.getByRole('button', {name:'Back to group info'}).click();
    await page.getByRole('button', {name:'Photos',exact:true}).click();
    await page.getByRole('button', {name:'Close group info'}).click();
    await page.getByRole('button', {name:'Show all messages',exact:true}).click();
    assert.equal(await page.locator('#circle-stream-feed article:visible').count(), 2);
    if (width < 761) {
      await page.getByRole('button', { name: 'Back to Rooms' }).click();
      await first.waitFor({ state: 'visible' });
    await page.locator('#room-fb-landing-sidebar').waitFor();
    }
    if (width >= 761) {
      await page.getByRole('button', {name:'SautiLink menu',exact:true}).click();
      assert.ok(await page.locator('.primary-rail').isVisible());
      await page.getByRole('button', {name:'Close menu',exact:true}).click();
      assert.equal(await page.locator('.primary-rail').isVisible(), false);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${width}px ${theme}: directory, search, chat alignment, Enter/Shift+Enter, actions, permissions, settings save, member role, approval, invitation and media reset.`);
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
}
