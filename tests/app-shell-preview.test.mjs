import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('preview is isolated, noindex and cannot connect to production services', async () => {
  const sourceHtml = await read('preview-src/app-shell/index.html');
  const builtHtml = await read('preview/app-shell/index.html');
  const headers = await read('_headers');

  assert.match(sourceHtml, /noindex, nofollow/);
  assert.match(sourceHtml, /connect-src 'none'/);
  assert.match(sourceHtml, /form-action 'none'/);
  assert.doesNotMatch(sourceHtml, /supabase\.co|sb_publishable_|service_role/i);
  assert.doesNotMatch(builtHtml, /<script[^>]+https?:\/\//i);
  assert.match(headers, /\/preview\/app-shell\/\*/);
  assert.match(headers, /connect-src 'none'/);
  assert.match(headers, /Cache-Control: no-store/);
});

test('preview carries the approved SautiLink product language and surfaces', async () => {
  const app = await read('preview-src/app-shell/App.jsx');
  for (const term of ['Stream', 'Discover', 'Circles', 'Messages', 'Notifications', 'Saved', 'Share a Sauti']) {
    assert.match(app, new RegExp(term));
  }
  assert.match(app, /Skip to main content/);
  assert.match(app, /aria-modal="true"/);
  assert.match(app, /role="dialog" aria-modal="true" aria-label="Account menu"/);
  assert.match(app, /prefers-color-scheme/);
});

test('preview uses restrained design tokens with no decorative gradients', async () => {
  const css = await read('preview-src/app-shell/styles.css');
  assert.match(css, /--canvas:/);
  assert.match(css, /--accent:/);
  assert.match(css, /data-theme="dark"/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /(linear|radial|conic)-gradient\(/i);
});

test('preview dependencies are pinned and build output stays inside its budget', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  for (const name of ['react', 'react-dom', 'lucide-react']) {
    assert.match(packageJson.dependencies[name], /^\d+\.\d+\.\d+$/);
  }
  for (const name of ['vite', '@vitejs/plugin-react']) {
    assert.match(packageJson.devDependencies[name], /^\d+\.\d+\.\d+$/);
  }

  const assetDirectory = new URL('../preview/app-shell/assets/', import.meta.url);
  const assets = await readdir(assetDirectory);
  const javascript = assets.find((name) => name.endsWith('.js'));
  const stylesheet = assets.find((name) => name.endsWith('.css'));
  assert.ok(javascript, 'expected a built JavaScript asset');
  assert.ok(stylesheet, 'expected a built CSS asset');
  assert.ok((await stat(new URL(javascript, assetDirectory))).size < 310_000, 'JavaScript bundle exceeds 310 kB raw');
  assert.ok((await stat(new URL(stylesheet, assetDirectory))).size < 70_000, 'CSS bundle exceeds 70 kB raw');
});

test('seeded preview contains no live account identifiers or external media', async () => {
  const data = await read('preview-src/app-shell/data.js');
  const app = await read('preview-src/app-shell/App.jsx');
  assert.match(data, /SautiLink Member/);
  assert.match(data, /Seeded|Building meaningful connections|Platform foundation/);
  assert.doesNotMatch(`${data}\n${app}`, /https?:\/\//i);
  assert.doesNotMatch(`${data}\n${app}`, /rggpyiterdbbugluejcs|sb_publishable_|service_role/i);
});

test('Cloudflare preview stage contains only allowlisted public assets', async () => {
  const root = new URL('../dist-preview-site/', import.meta.url);
  const walk = async (directory, prefix = '') => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        files.push(...await walk(new URL(`${entry.name}/`, directory), `${relative}/`));
      } else {
        files.push(relative);
      }
    }
    return files;
  };

  const files = await walk(root);
  assert.ok(files.includes('preview/app-shell/index.html'));
  assert.ok(files.includes('preview/app-shell/device-lab.html'));
  assert.ok(files.includes('preview/app-shell/device-lab.css'));
  assert.ok(files.includes('preview/identity/index.html'));
  assert.ok(files.includes('preview/identity/device-lab.html'));
  assert.ok(files.includes('preview/profiles/index.html'));
  assert.ok(files.includes('preview/profiles/device-lab.html'));
  assert.ok(files.includes('preview/share-stream/index.html'));
  assert.ok(files.includes('preview/share-stream/device-lab.html'));
  assert.ok(files.includes('preview/media/index.html'));
  assert.ok(files.includes('preview/media/device-lab.html'));
  assert.ok(files.includes('preview/conversations/index.html'));
  assert.ok(files.includes('preview/conversations/device-lab.html'));
  assert.ok(files.includes('preview/trust-safety/index.html'));
  assert.ok(files.includes('preview/trust-safety/device-lab.html'));
  assert.ok(files.includes('logo.png'));
  assert.ok(files.includes('assets/brand/system.css'));
  assert.ok(files.some((file) => /^preview\/app-shell\/assets\/index-.*\.js$/.test(file)));
  assert.ok(files.some((file) => /^preview\/app-shell\/assets\/index-.*\.css$/.test(file)));
  assert.ok(files.every((file) => (
    file === 'logo.png'
      || file === 'assets/favicon.png'
      || file === 'assets/brand/system.css'
      || file.startsWith('assets/fonts/inter/')
      || file.startsWith('preview/app-shell/')
      || file.startsWith('preview/identity/')
      || file.startsWith('preview/profiles/')
      || file.startsWith('preview/share-stream/')
      || file.startsWith('preview/media/')
      || file.startsWith('preview/conversations/')
      || file.startsWith('preview/trust-safety/')
  )), `unexpected staged file: ${files.find((file) => !(
    file === 'logo.png'
      || file === 'assets/favicon.png'
      || file === 'assets/brand/system.css'
      || file.startsWith('assets/fonts/inter/')
      || file.startsWith('preview/app-shell/')
      || file.startsWith('preview/identity/')
      || file.startsWith('preview/profiles/')
      || file.startsWith('preview/share-stream/')
      || file.startsWith('preview/media/')
      || file.startsWith('preview/conversations/')
      || file.startsWith('preview/trust-safety/')
  ))}`);
});
