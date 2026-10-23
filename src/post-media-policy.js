// Post attachments only. Stories and direct-message media keep their own limits.
export const POST_IMAGE_LIMIT = 5 * 1024 * 1024;
export const POST_VIDEO_LIMIT = 250 * 1024 * 1024;
export const POST_VIDEO_DURATION_MS = 180_000;
export const POST_MEDIA_COUNT = 10;
export const POST_UPLOAD_PART_BYTES = 8 * 1024 * 1024;
