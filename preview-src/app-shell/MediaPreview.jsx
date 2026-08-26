import { useEffect } from 'react';
import { AlertCircle, Check, Image, Play, RefreshCw, Trash2, Video, X } from 'lucide-react';

export const mediaTemplates = {
  image: {
    id: 'builders-workshop',
    kind: 'image',
    name: 'builders-workshop.jpg',
    details: '1600 × 900 · 2.4 MB',
    scene: 'workshop',
    alt: 'Three East African product builders reviewing a mobile interface together at a workshop table.',
  },
  video: {
    id: 'creator-update',
    kind: 'video',
    name: 'creator-update.mp4',
    details: '1080p · 18.7 MB',
    duration: '0:24',
    scene: 'studio',
    alt: 'A creator recording a short platform update in a quiet studio with captions enabled.',
  },
  invalid: {
    id: 'oversized-photo',
    kind: 'image',
    name: 'full-resolution-event.tiff',
    details: '48.6 MB · TIFF',
    scene: 'document',
    alt: '',
    error: 'This file is too large and its format is not supported. Use JPG, PNG, WebP or AVIF up to 10 MB.',
  },
};

export function createSeededMediaFeed(sourcePosts) {
  return sourcePosts.map((post, index) => {
    if (index === 1) return { ...post, media: [mediaTemplates.image, mediaTemplates.video] };
    if (index === 2) return { ...post, media: [mediaTemplates.video] };
    return post;
  });
}

function MediaArtwork({ item, decorative = false }) {
  return (
    <div
      className={`media-artwork media-scene-${item.scene}`}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={decorative ? undefined : item.alt || `${item.kind} preview`}
    >
      {item.scene === 'workshop' ? <>
        <span className="scene-window"><i /><i /><i /></span>
        <span className="scene-table" />
        <span className="scene-device" />
        <span className="scene-person scene-person-one" />
        <span className="scene-person scene-person-two" />
        <span className="scene-person scene-person-three" />
        <strong>Builders session</strong><small>Dar es Salaam</small>
      </> : null}
      {item.scene === 'studio' ? <>
        <span className="studio-frame"><i /><i /></span>
        <span className="studio-person" />
        <span className="studio-wave">{[3, 7, 5, 10, 6, 9, 4, 8, 5, 7].map((height, index) => <i key={index} style={{ height: `${height * 2}px` }} />)}</span>
        <strong>Creator update</strong><small>Captions ready</small>
      </> : null}
      {item.scene === 'document' ? <>
        <span className="document-sheet"><i /><i /><i /></span>
        <strong>File validation</strong><small>Check format and size</small>
      </> : null}
    </div>
  );
}

export function MediaGallery({ items, onOpen }) {
  if (!items?.length) return null;
  return (
    <div className={`media-gallery media-count-${Math.min(items.length, 4)}`} aria-label={`${items.length} media attachment${items.length === 1 ? '' : 's'}`}>
      {items.slice(0, 4).map((item) => (
        <button type="button" key={item.id} onClick={() => onOpen(item)} aria-label={`Open ${item.kind}: ${item.alt || item.name}`}>
          <MediaArtwork item={item} decorative />
          {item.kind === 'video' ? <span className="media-play"><Play aria-hidden="true" /></span> : null}
          {item.duration ? <span className="media-duration">{item.duration}</span> : null}
          {item.alt ? <span className="media-alt-badge">ALT</span> : null}
        </button>
      ))}
    </div>
  );
}

export function MediaViewer({ item, onClose }) {
  useEffect(() => {
    if (!item) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [item, onClose]);

  if (!item) return null;
  return (
    <div className="media-viewer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="media-viewer" role="dialog" aria-modal="true" aria-label={`${item.kind} viewer`}>
        <header><div><span>{item.kind}</span><strong>{item.name}</strong></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close media viewer"><X aria-hidden="true" /></button></header>
        <div className="media-viewer-stage"><MediaArtwork item={item} />{item.kind === 'video' ? <button className="media-viewer-play" type="button" aria-label="Play preview video"><Play aria-hidden="true" /></button> : null}</div>
        <footer><span>Alternative description</span><p>{item.alt || 'No description has been added yet.'}</p><small>{item.details}{item.duration ? ` · ${item.duration}` : ''}</small></footer>
      </section>
    </div>
  );
}

export function MediaPickerPanel({ open, count, offline, onAdd, onClose }) {
  if (!open) return null;
  return (
    <section className="media-picker-panel" aria-label="Media picker">
      <header><div><strong>Add media</strong><span>Preview a safe R2-ready workflow</span></div><button type="button" onClick={onClose}>Done</button></header>
      <div className="media-picker-options">
        <button type="button" disabled={count >= 4} onClick={() => onAdd('image')}><Image aria-hidden="true" /><span><strong>Add demo image</strong><small>JPG · 2.4 MB</small></span></button>
        <button type="button" disabled={count >= 4} onClick={() => onAdd('video')}><Video aria-hidden="true" /><span><strong>Add demo video</strong><small>MP4 · 18.7 MB</small></span></button>
        <button type="button" disabled={count >= 4} onClick={() => onAdd('invalid')}><AlertCircle aria-hidden="true" /><span><strong>Test invalid file</strong><small>See validation and retry</small></span></button>
      </div>
      <p>{offline ? 'Media will wait on this device until the connection returns.' : 'Nothing uploads in this preview. Production will validate type, size, ownership and content before finalizing R2 objects.'}</p>
    </section>
  );
}

export function ComposerMediaGrid({ items, onAlt, onRemove, onRetry }) {
  if (!items.length) return null;
  return (
    <section className={`composer-media-grid media-count-${Math.min(items.length, 4)}`} aria-label="Attached media">
      {items.map((item) => (
        <article className={`composer-media-card is-${item.status}`} key={item.localId}>
          <MediaArtwork item={item} decorative />
          <div className="composer-media-overlay">
            {item.status === 'uploading' ? <span className="media-progress" role="status"><i style={{ width: `${item.progress}%` }} />Uploading {item.progress}%</span> : null}
            {item.status === 'queued' ? <span className="media-queued" role="status">Waiting for connection</span> : null}
            {item.status === 'ready' ? <span className="media-ready" role="status"><Check aria-hidden="true" />Ready</span> : null}
            {item.status === 'error' ? <span className="media-error" role="alert"><AlertCircle aria-hidden="true" />Upload blocked</span> : null}
          </div>
          <footer><button type="button" onClick={() => onAlt(item.localId)} disabled={item.status === 'error'}>{item.alt ? 'Edit ALT' : 'Add ALT'}</button>{item.status === 'error' || item.status === 'queued' ? <button type="button" onClick={() => onRetry(item.localId)}><RefreshCw aria-hidden="true" />Retry</button> : null}<button type="button" onClick={() => onRemove(item.localId)} aria-label={`Remove ${item.name}`}><Trash2 aria-hidden="true" /></button></footer>
        </article>
      ))}
    </section>
  );
}

export function AltTextEditor({ item, onChange, onDone }) {
  if (!item) return null;
  return (
    <section className="media-alt-editor" aria-label="Alternative text editor">
      <div><span>Accessibility description</span><strong>{item.name}</strong></div>
      <label htmlFor="media-alt-text">Describe the meaningful visual details</label>
      <textarea id="media-alt-text" value={item.alt} onChange={(event) => onChange(event.target.value.slice(0, 420))} rows="3" placeholder="What should someone know if they cannot see this media?" />
      <footer><small>{item.alt.length}/420</small><button className="small-primary" type="button" onClick={onDone}>Done</button></footer>
    </section>
  );
}
