import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformPostMediaSource } from './post-media-source-transform.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appSourcePath = resolve(projectRoot, 'src/app.js');
const appSource = transformPostMediaSource(appSourcePath, await readFile(appSourcePath, 'utf8'));

await build({
  stdin: {
    contents: appSource,
    resolveDir: resolve(projectRoot, 'src'),
    sourcefile: 'src/app.js',
    loader: 'js',
  },
  inject: [
    resolve(projectRoot, 'src/caption-entities.js'),
    resolve(projectRoot, 'src/composer-formats.js'),
    resolve(projectRoot, 'src/username-login.js'),
    resolve(projectRoot, 'src/verified-identity-controls.js'),
    resolve(projectRoot, 'src/profile-activity.js'),
    resolve(projectRoot, 'src/profile-route-states.js'),
    resolve(projectRoot, 'src/professional-profile-category.js'),
    resolve(projectRoot, 'src/profile-media-upload-icons.js'),
    resolve(projectRoot, 'src/post-media-carousel.js'),
  ],
  outfile: resolve(projectRoot, 'app/assets/app.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'info',
});
