import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stageRoot = resolve(projectRoot, 'dist-preview-site');

if (dirname(stageRoot) !== projectRoot || stageRoot === projectRoot) {
  throw new Error('Refusing to stage preview outside the project directory.');
}

await rm(stageRoot, { recursive: true, force: true });

const copies = [
  ['preview/app-shell', 'preview/app-shell'],
  ['preview/identity', 'preview/identity'],
  ['preview/profiles', 'preview/profiles'],
  ['preview/share-stream', 'preview/share-stream'],
  ['preview/media', 'preview/media'],
  ['preview/conversations', 'preview/conversations'],
  ['logo.png', 'logo.png'],
  ['assets/favicon.png', 'assets/favicon.png'],
  ['assets/brand/system.css', 'assets/brand/system.css'],
  ['assets/fonts/inter/InterVariable.woff2', 'assets/fonts/inter/InterVariable.woff2'],
  ['assets/fonts/inter/InterVariable-Italic.woff2', 'assets/fonts/inter/InterVariable-Italic.woff2'],
];

for (const [source, destination] of copies) {
  const destinationPath = resolve(stageRoot, destination);
  await mkdir(dirname(destinationPath), { recursive: true });
  await cp(resolve(projectRoot, source), destinationPath, { recursive: true });
}

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
  { path: 'profiles', title: 'SautiLink Profiles and Circles preview' },
  { path: 'share-stream', title: 'SautiLink Share a Sauti and Stream preview' },
  { path: 'media', title: 'SautiLink Media and R2 preview' },
  { path: 'conversations', title: 'SautiLink Conversations and Threads preview' },
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
