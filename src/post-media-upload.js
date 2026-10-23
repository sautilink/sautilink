// Large videos cross the Worker body limit in independently authenticated parts.
// The server owns every part URL and joins bytes before the normal finalizer.
export async function uploadPostMedia(begin, file, authorization, onProgress, send, canContinue = () => true) {
  const token = async () => {
    if (!canContinue()) throw new Error('Media upload was cancelled.');
    const value = typeof authorization === 'function' ? await authorization() : authorization;
    if (!canContinue() || !value) throw new Error('Sign in again before uploading media.');
    return value;
  };
  const chunk = begin.chunk_upload;
  if (!chunk) return send(begin.upload_url, file, await token(), onProgress);
  const partSize = Number(chunk.part_size_bytes);
  const count = Number(chunk.part_count);
  if (file.type !== 'video/mp4' || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 250 * 1024 * 1024
    || partSize !== 8 * 1024 * 1024 || !Number.isInteger(count)
    || count !== Math.ceil(file.size / partSize) || count < 1 || count > 32
    || !/^\/api\/sauti-media\/upload\/[0-9a-f-]{36}\?part=\{part\}$/i.test(chunk.part_url || '')
    || !/^\/api\/sauti-media\/upload\/[0-9a-f-]{36}\?complete=1$/i.test(chunk.complete_url || '')
    || chunk.part_url.split('?')[0] !== chunk.complete_url.split('?')[0]
    || chunk.part_url.split('?')[0] !== begin.upload_url) {
    throw new Error('The video upload session is invalid. Try again.');
  }
  for (let part = 1; part <= count; part += 1) {
    const start = (part - 1) * partSize;
    const bytes = file.slice(start, Math.min(file.size, start + partSize), file.type);
    await send(chunk.part_url.replace('{part}', String(part)), bytes, await token(),
      (progress) => onProgress(Math.min(100, ((start + bytes.size * progress / 100) / file.size) * 100)));
  }
  const result = await send(chunk.complete_url, new Blob([], { type: file.type }), await token(), () => {});
  onProgress(100);
  return result;
}
