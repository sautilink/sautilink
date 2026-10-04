// Each label describes the shorter edge of an actual downscaled video.
// Cloudflare Media Transformations can output video for at most one minute
// and accepts output dimensions from 10 to 2000 pixels.
export const VIDEO_VARIANT_QUALITIES = Object.freeze([240, 360, 480, 720, 1080]);
export const MAX_VIDEO_VARIANT_DURATION_MS = 60_000;
const MAX_VIDEO_VARIANT_EDGE = 2000;

export function videoVariantDimensions(media, quality) {
  const width = Number(media?.width);
  const height = Number(media?.height);
  const duration = Number(media?.duration_ms ?? media?.durationMs);
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const target = Number(quality);
  if (!VIDEO_VARIANT_QUALITIES.includes(target)
    || !Number.isFinite(shortEdge) || !Number.isFinite(longEdge)
    || !Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_VARIANT_DURATION_MS
    || shortEdge <= target) return null;
  const targetLongEdge = Math.round(target * longEdge / shortEdge);
  if (targetLongEdge > MAX_VIDEO_VARIANT_EDGE) return null;
  return width <= height
    ? { width: target, height: targetLongEdge }
    : { width: targetLongEdge, height: target };
}

export function availableVideoQualities(media) {
  return VIDEO_VARIANT_QUALITIES.filter((quality) => videoVariantDimensions(media, quality));
}
