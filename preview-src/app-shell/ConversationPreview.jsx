import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Bookmark,
  ChevronDown,
  CloudOff,
  Heart,
  Image,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Repeat2,
  Send,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import { MediaGallery } from './MediaPreview.jsx';

const seededReplies = [
  {
    id: 'reply-asha',
    author: { name: 'Asha Mhando', handle: '@asham', initials: 'AM', tone: 'graphite', verified: true },
    time: '14m',
    text: 'The strongest part is the separation between the public conversation and private account data. That boundary should stay visible in every feature.',
    likes: 84,
    replies: 6,
    depth: 0,
  },
  {
    id: 'reply-jabari',
    author: { name: 'Jabari Otieno', handle: '@jabariotieno', initials: 'JO', tone: 'sand', verified: true },
    time: '9m',
    text: 'Agreed. I would add performance budgets to the product contract too, especially for entry-level phones and unstable networks.',
    likes: 41,
    replies: 2,
    depth: 1,
    replyingTo: '@asham',
  },
  {
    id: 'reply-neema',
    author: { name: 'Neema Habari', handle: '@neemahabari', initials: 'NH', tone: 'blue', verified: true },
    time: '6m',
    text: 'Clear context is what makes a long thread useful. The parent Sauti should never disappear while people read the replies.',
    likes: 29,
    replies: 1,
    depth: 0,
  },
  {
    id: 'reply-hidden',
    hidden: true,
    reason: 'Hidden by your reply controls',
    depth: 0,
  },
];

function ThreadAvatar({ person, size = 'medium' }) {
  return <span className={`avatar avatar-${person.tone || 'graphite'} avatar-${size}`} aria-hidden="true">{person.initials}</span>;
}

function ThreadVerified() {
  return <BadgeCheck className="verified-mark" aria-label="Verified account" />;
}

function ReplyCard({ reply, liked, hiddenShown, onShowHidden, onLike, onReply, onRetry, onPreviewAction }) {
  if (reply.hidden && !hiddenShown) {
    return (
      <article className="thread-hidden-reply">
        <span><ShieldCheck aria-hidden="true" /></span>
        <div><strong>{reply.reason}</strong><p>Potentially disruptive content is collapsed without removing its place in the conversation.</p></div>
        <button type="button" onClick={onShowHidden}>Show</button>
      </article>
    );
  }

  const author = reply.author || { name: 'Filtered account', handle: '@filtered', initials: 'FA', tone: 'graphite' };
  const likeCount = (reply.likes || 0) + (liked ? 1 : 0);
  return (
    <article className={`thread-reply thread-depth-${reply.depth || 0}${reply.status ? ` is-${reply.status}` : ''}`}>
      <ThreadAvatar person={author} />
      <div className="thread-reply-content">
        <header className="thread-author-row">
          <div><strong>{author.name}</strong>{author.verified ? <ThreadVerified /> : null}<span>{author.handle}</span><span aria-hidden="true">·</span><time>{reply.time}</time></div>
          <button type="button" onClick={() => onPreviewAction(`Controls for ${author.handle}`)} aria-label={`More actions for ${author.handle}`}><MoreHorizontal aria-hidden="true" /></button>
        </header>
        {reply.replyingTo ? <p className="thread-replying-to">Replying to <button type="button" onClick={() => onPreviewAction(reply.replyingTo)}>{reply.replyingTo}</button></p> : null}
        <p className="thread-reply-copy">{reply.text || 'This reply remains collapsed until you choose to view it.'}</p>
        {reply.status === 'queued' ? <div className="thread-delivery-note"><CloudOff aria-hidden="true" /><span><strong>Waiting for connection</strong>This reply stays on this device.</span></div> : null}
        {reply.status === 'failed' ? <div className="thread-delivery-note is-failed"><RefreshCw aria-hidden="true" /><span><strong>Reply not sent</strong>Nothing reached production.</span><button type="button" onClick={() => onRetry(reply.id)}>Retry</button></div> : null}
        <footer className="thread-reply-actions">
          <button type="button" onClick={() => onReply(author.handle)} aria-label={`Reply to ${author.handle}`}><MessageCircle aria-hidden="true" /><span>{reply.replies || 0}</span></button>
          <button type="button" onClick={() => onPreviewAction('Reshare reply')} aria-label="Reshare reply"><Repeat2 aria-hidden="true" /></button>
          <button className={liked ? 'is-liked' : ''} type="button" onClick={() => onLike(reply.id)} aria-pressed={liked} aria-label={`${likeCount} likes`}><Heart aria-hidden="true" /><span>{likeCount}</span></button>
          <button type="button" onClick={() => onPreviewAction('Share reply')} aria-label="Share reply"><Share2 aria-hidden="true" /></button>
        </footer>
      </div>
    </article>
  );
}

function ThreadSkeleton() {
  return <div className="thread-skeleton" aria-label="Loading replies" aria-busy="true">{[1, 2, 3].map((item) => <span key={item}><i /><b /><b /></span>)}</div>;
}

export default function ConversationPreview({
  rootPost,
  member,
  rootLiked,
  rootSaved,
  onRootLike,
  onRootSave,
  onOpenMedia,
  onBack,
  onPreviewAction,
  showStateLab = false,
}) {
  const textareaRef = useRef(null);
  const [sort, setSort] = useState('relevant');
  const [connection, setConnection] = useState('online');
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState(rootPost.author.handle);
  const [replies, setReplies] = useState(seededReplies);
  const [likedReplies, setLikedReplies] = useState(new Set(['reply-asha']));
  const [hiddenShown, setHiddenShown] = useState(false);
  const [reshared, setReshared] = useState(false);
  const [reshareMenuOpen, setReshareMenuOpen] = useState(false);

  const visibleReplies = useMemo(() => {
    if (sort === 'newest') return [...replies].reverse();
    return replies;
  }, [replies, sort]);

  const selectReplyTarget = (handle) => {
    setReplyingTo(handle);
    textareaRef.current?.focus();
  };

  const submitReply = () => {
    const text = draft.trim();
    if (!text || connection === 'loading') return;
    const status = connection === 'offline' ? 'queued' : connection === 'failure' ? 'failed' : 'published';
    setReplies((current) => [...current, {
      id: `local-reply-${Date.now()}`,
      author: { name: member.name, handle: member.handle, initials: member.initials, tone: 'graphite' },
      time: status === 'published' ? 'Now' : 'Pending',
      text,
      likes: 0,
      replies: 0,
      depth: replyingTo === rootPost.author.handle ? 0 : 1,
      replyingTo,
      status,
    }]);
    setDraft('');
    onPreviewAction(status === 'published' ? 'Reply added locally. Nothing reached production.' : status === 'queued' ? 'Reply queued on this device.' : 'Reply failure simulated safely.');
  };

  const retryReply = (id) => {
    setConnection('online');
    setReplies((current) => current.map((reply) => reply.id === id ? { ...reply, status: 'published', time: 'Now' } : reply));
    onPreviewAction('Reply recovered locally. Nothing reached production.');
  };

  const toggleReplyLike = (id) => setLikedReplies((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const rootLikes = rootPost.metrics.likes + (rootLiked ? 1 : 0);
  const rootReshares = rootPost.metrics.reshares + (reshared ? 1 : 0);
  const isOffline = connection === 'offline';
  const isFailure = connection === 'failure';

  return (
    <section className="conversation-screen" aria-label="Sauti conversation">
      <header className="thread-header">
        <button className="icon-button" type="button" onClick={onBack} aria-label="Back to Stream"><ArrowLeft aria-hidden="true" /></button>
        <div><h1>Conversation</h1><p>{rootPost.metrics.replies} replies · Public context</p></div>
        <button className="icon-button" type="button" onClick={() => onPreviewAction('Conversation controls')} aria-label="Conversation controls"><MoreHorizontal aria-hidden="true" /></button>
      </header>

      {showStateLab ? <section className="thread-state-lab" aria-label="Preview conversation states"><span>Delivery state</span><div>{[
        ['online', 'Online'],
        ['loading', 'Loading'],
        ['offline', 'Offline'],
        ['failure', 'Send failure'],
      ].map(([value, label]) => <button key={value} type="button" className={connection === value ? 'is-active' : ''} aria-pressed={connection === value} onClick={() => setConnection(value)}>{label}</button>)}</div></section> : null}

      {isOffline ? <aside className="offline-banner thread-offline" role="status"><CloudOff aria-hidden="true" /><div><strong>You are offline.</strong><span>New replies stay queued on this device until the connection returns.</span></div></aside> : null}
      {isFailure ? <aside className="thread-failure-banner" role="status"><RefreshCw aria-hidden="true" /><span><strong>Send failure simulation is on.</strong>Your next reply will show a safe retry state.</span></aside> : null}

      <article className="thread-root">
        <header className="thread-root-author"><ThreadAvatar person={rootPost.author} size="large" /><div><strong>{rootPost.author.name}{rootPost.author.verified ? <ThreadVerified /> : null}</strong><span>{rootPost.author.handle}</span></div><button type="button" onClick={() => onPreviewAction('Root Sauti controls')} aria-label="Root Sauti controls"><MoreHorizontal aria-hidden="true" /></button></header>
        <p className="thread-root-copy">{rootPost.text}</p>
        {rootPost.tags?.length ? <div className="thread-root-tags">{rootPost.tags.map((tag) => <button type="button" key={tag} onClick={() => onPreviewAction(`#${tag}`)}>#{tag}</button>)}</div> : null}
        {rootPost.media ? <MediaGallery items={rootPost.media} onOpen={onOpenMedia} /> : null}
        <p className="thread-root-meta"><time>7:42 PM · Aug 26, 2026</time><span aria-hidden="true">·</span><strong>{rootPost.metrics.views}</strong> Views</p>
        <div className="thread-root-counts"><button type="button" onClick={() => onPreviewAction('Reshare list')}><strong>{rootReshares}</strong> Reshares</button><button type="button" onClick={() => onPreviewAction('Quote list')}><strong>19</strong> Quotes</button><button type="button" onClick={() => onPreviewAction('Like list')}><strong>{rootLikes}</strong> Likes</button><button type="button" onClick={() => onPreviewAction('Saved count')}><strong>57</strong> Saves</button></div>
        <div className="thread-root-actions">
          <button type="button" onClick={() => selectReplyTarget(rootPost.author.handle)} aria-label="Reply"><MessageCircle aria-hidden="true" /></button>
          <span className="thread-reshare-wrap"><button className={reshared ? 'is-reshared' : ''} type="button" aria-expanded={reshareMenuOpen} onClick={() => setReshareMenuOpen((value) => !value)} aria-label="Reshare options"><Repeat2 aria-hidden="true" /></button>{reshareMenuOpen ? <span className="thread-reshare-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setReshared((value) => !value); setReshareMenuOpen(false); onPreviewAction(reshared ? 'Reshare removed locally.' : 'Reshared locally.'); }}><Repeat2 aria-hidden="true" />{reshared ? 'Undo Reshare' : 'Reshare'}</button><button type="button" role="menuitem" onClick={() => { setReshareMenuOpen(false); onPreviewAction('Quote Sauti composer'); }}><MessageCircle aria-hidden="true" />Quote Sauti</button></span> : null}</span>
          <button className={rootLiked ? 'is-liked' : ''} type="button" onClick={() => onRootLike(rootPost.id)} aria-pressed={rootLiked} aria-label="Like"><Heart aria-hidden="true" /></button>
          <button className={rootSaved ? 'is-saved' : ''} type="button" onClick={() => onRootSave(rootPost.id)} aria-pressed={rootSaved} aria-label="Save"><Bookmark aria-hidden="true" /></button>
          <button type="button" onClick={() => onPreviewAction('Share conversation')} aria-label="Share"><Share2 aria-hidden="true" /></button>
        </div>
      </article>

      <section className="thread-reply-composer" aria-label="Write a reply">
        <ThreadAvatar person={{ ...member, tone: 'graphite' }} />
        <div>
          <p>Replying to <button type="button" onClick={() => onPreviewAction(replyingTo)}>{replyingTo}</button></p>
          <textarea ref={textareaRef} value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 500))} placeholder="Add to the conversation" aria-label="Your reply" rows="3" />
          <footer><button type="button" onClick={() => onPreviewAction('Reply media uses the validated R2 workflow.')} aria-label="Add media to reply"><Image aria-hidden="true" /></button><span>{draft.length}/500</span><button className="small-primary" type="button" disabled={!draft.trim() || connection === 'loading'} onClick={submitReply}><Send aria-hidden="true" />{isOffline ? 'Queue reply' : 'Reply'}</button></footer>
        </div>
      </section>

      <div className="thread-sort-row"><div><span>Replies</span><strong>Context stays attached</strong></div><label><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort replies"><option value="relevant">Relevant</option><option value="newest">Newest</option></select><ChevronDown aria-hidden="true" /></label></div>

      {connection === 'loading' ? <ThreadSkeleton /> : <div className="thread-replies" aria-live="polite">{visibleReplies.map((reply) => <ReplyCard key={reply.id} reply={reply} liked={likedReplies.has(reply.id)} hiddenShown={hiddenShown} onShowHidden={() => setHiddenShown(true)} onLike={toggleReplyLike} onReply={selectReplyTarget} onRetry={retryReply} onPreviewAction={onPreviewAction} />)}<button className="thread-more-replies" type="button" onClick={() => onPreviewAction('Two more replies loaded locally.')}><BarChart3 aria-hidden="true" />Show 2 more replies</button></div>}
    </section>
  );
}
