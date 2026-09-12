const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function imageStream() {
  const binary = atob(PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' }).stream();
}

async function runCase(env, name, transformOptions, outputOptions) {
  const startedAt = performance.now();
  try {
    const output = await env.IMAGES
      .input(imageStream())
      .transform(transformOptions)
      .output(outputOptions);
    const response = output.response();
    const body = response.ok ? '' : (await response.clone().text().catch(() => '')).slice(0, 1000);
    return {
      name,
      ok: response.ok,
      status: response.status,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      contentType: response.headers.get('content-type'),
      cfResized: response.headers.get('cf-resized'),
      body,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: 0,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      exception: error instanceof Error ? error.message : String(error),
    };
  }
}

export default {
  async fetch(_request, env) {
    const results = [];
    results.push(await runCase(env, 'basic-webp', { width: 1 }, { format: 'image/webp' }));
    results.push(await runCase(env, 'quality-high', { width: 1 }, { format: 'image/webp', quality: 'high' }));
    results.push(await runCase(env, 'quality-85', { width: 1 }, { format: 'image/webp', quality: 85 }));
    results.push(await runCase(env, 'quality-90', { width: 1 }, { format: 'image/webp', quality: 90 }));
    results.push(await runCase(env, 'anim-true', { width: 1 }, { format: 'image/webp', anim: true }));
    results.push(await runCase(env, 'full-quality-85', { width: 1, fit: 'scale-down' }, { format: 'image/webp', quality: 85, anim: true }));
    results.push(await runCase(env, 'full-quality-90', { width: 1, fit: 'scale-down' }, { format: 'image/webp', quality: 90, anim: true }));
    return Response.json({ results });
  },
};
