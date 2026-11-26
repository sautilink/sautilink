export function stickerPreviewText(value) {
  return String(value || '').replace(/\[\[sl-sticker:([a-z0-9-]{1,90})\]\]|:(slv-[a-z0-9-]{1,86}):/g,
    (_match, sticker) => sticker ? 'Sticker' : 'Animated emoji');
}
