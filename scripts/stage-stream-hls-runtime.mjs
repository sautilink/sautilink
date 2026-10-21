import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function stageStreamHlsRuntime(root) {
  const metadata = JSON.parse(await readFile(resolve(root, 'node_modules/hls.js/package.json'), 'utf8'));
  if (metadata.version !== '1.7.3') throw new Error('UNPINNED_HLS_RUNTIME');
  const target = resolve(root, 'app/assets/vendor');
  await mkdir(target, { recursive: true });
  const runtime = await readFile(resolve(root, 'node_modules/hls.js/dist/hls.min.js'), 'utf8');
  // Public artifacts never ship source maps or dangling source-map references.
  await writeFile(resolve(target, 'hls-1.7.3.min.js'), runtime.replace(/^\/\/# sourceMappingURL=[^\r\n]+$/gm, ''));
  await copyFile(resolve(root, 'node_modules/hls.js/LICENSE'), resolve(target, 'hls-1.7.3.LICENSE.txt'));
}
