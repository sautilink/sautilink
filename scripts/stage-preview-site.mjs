import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stageRoot = resolve(projectRoot, 'dist-preview-site');

const stagingHeaders = `/*
  X-Robots-Tag: noindex, nofollow, noarchive

/app/*
  Cache-Control: no-store, max-age=0
  Content-Security-Policy: default-src 'self'; connect-src 'self' https://rggpyiterdbbugluejcs.supabase.co wss://rggpyiterdbbugluejcs.supabase.co; font-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
`;

if (dirname(stageRoot) !== projectRoot || stageRoot === projectRoot) {
  throw new Error('Refusing to stage preview outside the project directory.');
}

await rm(stageRoot, { recursive: true, force: true });

const copies = [
  ['app', 'app'],
  ['_redirects', '_redirects'],
  ['sw.js', 'sw.js'],
  ['preview/app-shell', 'preview/app-shell'],
  ['preview/identity', 'preview/identity'],
  ['preview/profiles', 'preview/profiles'],
  ['preview/share-stream', 'preview/share-stream'],
  ['preview/media', 'preview/media'],
  ['preview/conversations', 'preview/conversations'],
  ['preview/trust-safety', 'preview/trust-safety'],
  ['preview/messages', 'preview/messages'],
  ['preview/settings', 'preview/settings'],
  ['preview-src/backend-foundation', 'preview/backend-foundation'],
  ['logo.png', 'logo.png'],
  ['assets/favicon.png', 'assets/favicon.png'],
  ['assets/brand/logo-compact.webp', 'assets/brand/logo-compact.webp'],
  ['assets/brand/system.css', 'assets/brand/system.css'],
  ['assets/fonts/inter/InterVariable.woff2', 'assets/fonts/inter/InterVariable.woff2'],
  ['assets/fonts/inter/InterVariable-Italic.woff2', 'assets/fonts/inter/InterVariable-Italic.woff2'],
];

for (const [source, destination] of copies) {
  const destinationPath = resolve(stageRoot, destination);
  await mkdir(dirname(destinationPath), { recursive: true });
  await cp(resolve(projectRoot, source), destinationPath, { recursive: true });
}

await writeFile(resolve(stageRoot, '_headers'), stagingHeaders);

const developmentCss = `
:root { color-scheme: light; font-family: Inter, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: #f5f6f8; color: #111318; }
      main { width: min(960px, 100%); margin: 0 auto; padding: 56px 24px 72px; }
      .brand { display: inline-flex; align-items: center; gap: 10px; color: #111318; text-decoration: none; }
      .brand img { width: 78px; height: auto; aspect-ratio: 656 / 316; object-fit: contain; }
      .brand strong { font-size: 20px; letter-spacing: -.02em; }
      .eyebrow { margin: 64px 0 12px; color: #4c5870; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
      h1 { max-width: 680px; margin: 0; font-size: clamp(36px, 7vw, 64px); line-height: .98; letter-spacing: -.06em; }
      .intro { max-width: 620px; margin: 20px 0 40px; color: #5d6675; font-size: 17px; line-height: 1.6; }
      .phase-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
      .phase { display: grid; min-height: 138px; padding: 20px; border: 1px solid #d9dde5; border-radius: 16px; background: #fff; color: inherit; text-decoration: none; transition: border-color .2s, transform .2s; }
      .phase:hover { border-color: #667085; transform: translateY(-2px); }
      .phase small { color: #687386; font-size: 12px; font-weight: 800; }
      .phase strong { align-self: end; font-size: 18px; }
      footer { margin-top: 44px; color: #7a8493; font-size: 13px; }
      @media (max-width: 560px) { main { padding-top: 32px; } .eyebrow { margin-top: 44px; } }
`.trimStart();

await writeFile(resolve(stageRoot, 'assets/development.css'), developmentCss);

await writeFile(resolve(stageRoot, 'index.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">
    <title>SautiLink Development</title>
    <link rel="icon" href="/assets/favicon.png">
    <link rel="stylesheet" href="/assets/brand/system.css">
    <link rel="stylesheet" href="/assets/development.css">
  </head>
  <body>
    <main>
      <a class="brand" href="/" aria-label="SautiLink Development home">
        <img src="/logo.png" alt="">
        <strong>SautiLink</strong>
      </a>
      <p class="eyebrow">Private development environment</p>
      <h1>Build, review, and improve SautiLink.</h1>
      <p class="intro">This is the shared staging space for approved product phases. It uses seeded preview data and is separate from the public SautiLink website.</p>
      <nav class="phase-grid" aria-label="Development phases">
        <a class="phase" href="/preview/app-shell/"><small>Phase 01</small><strong>App Shell</strong></a>
        <a class="phase" href="/preview/identity/"><small>Phase 02</small><strong>Identity &amp; Authentication</strong></a>
        <a class="phase" href="/preview/profiles/"><small>Phase 03</small><strong>Profiles &amp; Sautify</strong></a>
        <a class="phase" href="/preview/share-stream/"><small>Phase 04</small><strong>Create Post &amp; Feed</strong></a>
        <a class="phase" href="/preview/media/"><small>Phase 05</small><strong>Media Preview</strong></a>
        <a class="phase" href="/preview/conversations/"><small>Phase 06</small><strong>Conversations &amp; Threads</strong></a>
        <a class="phase" href="/preview/trust-safety/"><small>Phase 07</small><strong>Trust, Safety &amp; Admin</strong></a>
        <a class="phase" href="/preview/mvp/"><small>Phase 08</small><strong>MVP Core Integration</strong></a>
        <a class="phase" href="/preview/messages/"><small>Phase 09</small><strong>Basic Messages</strong></a>
        <a class="phase" href="/preview/settings/"><small>Phase 10</small><strong>Settings &amp; Privacy</strong></a>
        <a class="phase" href="/preview/backend-foundation/"><small>Phase 11</small><strong>Staging Backend Foundation</strong></a>
      </nav>
      <footer>Development only · Seeded data · No production accounts or messages</footer>
    </main>
  </body>
</html>
`);

const mvpDirectory = resolve(stageRoot, 'preview/mvp');
await mkdir(mvpDirectory, { recursive: true });

const mvpCss = `
:root { font-family: Inter, system-ui, sans-serif; color: #111318; background: #f5f6f8; }
      * { box-sizing: border-box; }
      body { margin: 0; }
      main { width: min(960px, 100%); margin: auto; padding: 48px 24px 72px; }
      a { color: inherit; }
      .top { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
      .brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; font-weight: 800; }
      .brand img { width: 78px; height: auto; aspect-ratio: 656 / 316; object-fit: contain; }
      .back { color: #596477; font-size: 13px; font-weight: 700; }
      .eyebrow { margin: 70px 0 12px; color: #c84f5b; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
      h1 { max-width: 700px; margin: 0; font-size: clamp(38px, 7vw, 68px); line-height: .98; letter-spacing: -.06em; }
      .intro { max-width: 650px; margin: 22px 0 40px; color: #5d6675; font-size: 17px; line-height: 1.6; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
      .item { min-height: 132px; padding: 20px; border: 1px solid #d9dde5; border-radius: 16px; background: #fff; }
      .item strong { display: block; margin-bottom: 8px; font-size: 17px; }
      .item p { margin: 0; color: #687386; font-size: 13px; line-height: 1.5; }
      .note { margin-top: 28px; padding: 18px 20px; border-left: 3px solid #c84f5b; background: #fff; color: #596477; font-size: 14px; line-height: 1.6; }
      footer { margin-top: 42px; color: #7a8493; font-size: 13px; }
`.trimStart();
await writeFile(resolve(mvpDirectory, 'mvp.css'), mvpCss);

await writeFile(resolve(mvpDirectory, 'index.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">
    <title>SautiLink MVP Core Integration</title>
    <link rel="icon" href="/assets/favicon.png">
    <link rel="stylesheet" href="/assets/brand/system.css">
    <link rel="stylesheet" href="/preview/mvp/mvp.css">
  </head>
  <body>
    <main>
      <div class="top"><a class="brand" href="/"><img src="/logo.png" alt=""><span>SautiLink</span></a><a class="back" href="/">All phases</a></div>
      <p class="eyebrow">Phase 08 · MVP core integration</p>
      <h1>The essential SautiLink experience, together.</h1>
      <p class="intro">This checkpoint brings the MUST-have public experience into one product boundary. It keeps the platform focused, lightweight and ready for real integration.</p>
      <section class="grid" aria-label="MVP capabilities">
        <article class="item"><strong>Create Post</strong><p>Create text posts with audience, reply and draft controls.</p></article>
        <article class="item"><strong>Feed &amp; Discover</strong><p>Read a focused feed and discover public SautiLink content.</p></article>
        <article class="item"><strong>Profiles &amp; Sautify</strong><p>Manage identity, follow people and participate in Sautify communities.</p></article>
        <article class="item"><strong>Public Threads</strong><p>Reply, reshare, quote, like and save in open conversations.</p></article>
        <article class="item"><strong>Safety Basics</strong><p>Mute, block, report and moderation operations remain part of the core.</p></article>
        <article class="item"><strong>Responsive Access</strong><p>Use the same essential experience on desktop and mobile.</p></article>
      </section>
      <p class="note"><strong>Scope boundary:</strong> Basic one-to-one text messages continue in Phase 09. Group chat, calls, large files, disappearing messages and other high-cost features remain deferred.</p>
      <footer>Development only · Seeded preview data · Production remains untouched</footer>
    </main>
  </body>
</html>
`);

const deviceLabCss = `
:root { color-scheme: light; font-family: Inter, system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: #e9edf3; color: #111318; }
main { display: grid; place-items: center; min-height: 100vh; padding: 32px; }
.lab { display: grid; gap: 12px; justify-items: center; }
.label { margin: 0; color: #46505e; font-size: 13px; font-weight: 700; }
.device { width: 390px; height: 844px; overflow: hidden; border: 8px solid #111318; border-radius: 34px; background: #fff; box-shadow: 0 24px 60px rgb(20 27 38 / 18%); }
iframe { width: 100%; height: 100%; border: 0; background: #fff; }
`.trimStart();

for (const preview of [
  { path: 'app-shell', title: 'SautiLink app-shell preview' },
  { path: 'identity', title: 'SautiLink Identity preview' },
  { path: 'profiles', title: 'SautiLink Profiles and Sautify preview' },
  { path: 'share-stream', title: 'SautiLink Create Post and Feed preview' },
  { path: 'media', title: 'SautiLink Media and R2 preview' },
  { path: 'conversations', title: 'SautiLink Conversations and Threads preview' },
  { path: 'trust-safety', title: 'SautiLink Trust and Safety preview' },
  { path: 'messages', title: 'SautiLink Basic Messages preview' },
  { path: 'settings', title: 'SautiLink Settings and Privacy preview' },
  { path: 'backend-foundation', title: 'SautiLink Staging Backend Foundation preview' },
]) {
  const deviceLabDirectory = resolve(stageRoot, `preview/${preview.path}`);
  await writeFile(resolve(deviceLabDirectory, 'device-lab.css'), deviceLabCss);
  await writeFile(resolve(deviceLabDirectory, 'device-lab.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; frame-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">
    <title>Mobile QA — ${preview.title}</title>
    <link rel="stylesheet" href="/assets/brand/system.css">
    <link rel="stylesheet" href="/preview/${preview.path}/device-lab.css">
  </head>
  <body>
    <main>
      <section class="lab" aria-label="390 by 844 pixel ${preview.title}">
        <p class="label">Mobile QA · 390 × 844</p>
        <div class="device">
          <iframe title="${preview.title} at mobile width" src="/preview/${preview.path}/"></iframe>
        </div>
      </section>
    </main>
  </body>
</html>
`);
}

console.log(`Staged ${copies.length} allowlisted preview assets in dist-preview-site.`);
