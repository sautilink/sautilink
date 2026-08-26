import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  BarChart3,
  Bell,
  Bookmark,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleEllipsis,
  CloudOff,
  ExternalLink,
  FileText,
  Globe2,
  Heart,
  Home,
  Image,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Moon,
  MoreHorizontal,
  PenLine,
  RefreshCw,
  Repeat2,
  Search,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Smile,
  Sun,
  TrendingUp,
  UserMinus,
  UserPlus,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import {
  circles,
  conversations,
  currentMember,
  notifications,
  posts,
  publicMember,
  suggestions,
  trends,
} from './data.js';
import {
  AltTextEditor,
  ComposerMediaGrid,
  createSeededMediaFeed,
  MediaGallery,
  MediaPickerPanel,
  MediaViewer,
  mediaTemplates,
} from './MediaPreview.jsx';

const navigation = [
  { id: 'stream', label: 'Stream', icon: Home },
  { id: 'discover', label: 'Discover', icon: Search },
  { id: 'circles', label: 'Circles', icon: UsersRound },
  { id: 'notifications', label: 'Notifications', icon: Bell, badge: 4 },
  { id: 'messages', label: 'Messages', icon: Mail, badge: 7 },
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'profile', label: 'Profile', icon: UserRound },
];

const mobileNavigation = navigation.filter(({ id }) => ['stream', 'discover', 'notifications', 'messages'].includes(id));
const knownSections = new Set(navigation.map(({ id }) => id));

function getInitialSection(fallback = 'stream') {
  const candidate = window.location.hash.replace('#', '');
  return knownSections.has(candidate) ? candidate : fallback;
}

function getInitialTheme() {
  try {
    const stored = window.localStorage.getItem('sautilink.preview.theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // The preview remains usable when storage is unavailable.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function Avatar({ initials, tone = 'blue', size = 'medium' }) {
  return <span className={`avatar avatar-${tone} avatar-${size}`} aria-hidden="true">{initials}</span>;
}

function VerifiedMark() {
  return <BadgeCheck className="verified-mark" aria-label="Verified account" />;
}

function Brand() {
  return (
    <span className="brand-lockup">
      <img src="/logo.png" alt="" width="40" height="40" />
      <strong>SautiLink</strong>
    </span>
  );
}

function NavigationItem({ item, active, onSelect, compact = false }) {
  const Icon = item.icon;
  return (
    <button
      className={`navigation-item${active ? ' is-active' : ''}${compact ? ' is-compact' : ''}`}
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={active ? 'page' : undefined}
      aria-label={compact ? item.label : undefined}
    >
      <span className="navigation-icon">
        <Icon aria-hidden="true" />
        {item.badge ? <span className="navigation-badge" aria-label={`${item.badge} unread`}>{item.badge}</span> : null}
      </span>
      {!compact ? <span>{item.label}</span> : null}
    </button>
  );
}

function PrimaryRail({ section, member, onNavigate, onCompose, onMore }) {
  return (
    <aside className="primary-rail" aria-label="Primary navigation">
      <div className="primary-rail-inner">
        <button className="brand-button" type="button" onClick={() => onNavigate('stream')} aria-label="Open Stream">
          <Brand />
        </button>

        <nav className="desktop-navigation" aria-label="SautiLink">
          {navigation.map((item) => (
            <NavigationItem key={item.id} item={item} active={section === item.id} onSelect={onNavigate} />
          ))}
          <button className="navigation-item" type="button" onClick={onMore}>
            <span className="navigation-icon"><CircleEllipsis aria-hidden="true" /></span>
            <span>More</span>
          </button>
        </nav>

        <button className="compose-primary" type="button" onClick={onCompose}>
          <PenLine aria-hidden="true" />
          <span>Share a Sauti</span>
        </button>

        <button className="member-switcher" type="button" onClick={() => onNavigate('profile')}>
          <Avatar initials={member.initials} tone="graphite" size="small" />
          <span className="member-switcher-copy">
            <strong>{member.name}</strong>
            <small>{member.handle}</small>
          </span>
          <MoreHorizontal aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

function MobileTopbar({ section, theme, onThemeToggle, onMenu, onNavigate }) {
  const title = navigation.find((item) => item.id === section)?.label || 'Stream';
  return (
    <header className="mobile-topbar">
      <button className="icon-button" type="button" onClick={onMenu} aria-label="Open menu"><Menu aria-hidden="true" /></button>
      <button className="mobile-brand" type="button" onClick={() => onNavigate('stream')} aria-label="SautiLink Stream">
        <img src="/logo.png" alt="" width="34" height="34" />
        <strong>{title}</strong>
      </button>
      <button className="icon-button" type="button" onClick={onThemeToggle} aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} mode`}>
        {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </button>
    </header>
  );
}

function ScreenHeader({ title, subtitle, children }) {
  return (
    <header className="screen-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {children ? <div className="screen-header-actions">{children}</div> : null}
    </header>
  );
}

function ComposerEntry({ member, onCompose }) {
  return (
    <section className="composer-entry" aria-label="Share a Sauti">
      <Avatar initials={member.initials} tone="graphite" />
      <button className="composer-prompt" type="button" onClick={onCompose}>What deserves to be heard?</button>
      <div className="composer-tools" aria-label="Composer options">
        <button type="button" onClick={onCompose} aria-label="Add media"><Image aria-hidden="true" /></button>
        <button type="button" onClick={onCompose} aria-label="Create poll"><BarChart3 aria-hidden="true" /></button>
        <button type="button" onClick={onCompose} aria-label="Add an emoji"><Smile aria-hidden="true" /></button>
        <button type="button" onClick={onCompose} aria-label="Schedule"><CalendarDays aria-hidden="true" /></button>
        <button className="composer-entry-submit" type="button" onClick={onCompose}>Share</button>
      </div>
    </section>
  );
}

function ArchitectureVisual({ visual }) {
  return (
    <div className="architecture-visual" role="img" aria-label={`${visual.title}: ${visual.items.join(', ')}`}>
      <span className="architecture-label">{visual.label}</span>
      <strong>{visual.title}</strong>
      <div className="architecture-items">
        {visual.items.map((item, index) => (
          <span key={item} className={index === 1 ? 'is-core' : ''}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function PostCard({ post, liked, saved, onLike, onSave, onOpenMedia, onPreviewAction }) {
  const likes = post.metrics.likes + (liked ? 1 : 0);
  return (
    <article className="post-card">
      <Avatar initials={post.author.initials} tone={post.author.tone} />
      <div className="post-content">
        <header className="post-author-row">
          <div className="post-author">
            <strong>{post.author.name}</strong>
            {post.author.verified ? <VerifiedMark /> : null}
            <span>{post.author.handle}</span>
            <span aria-hidden="true">·</span>
            <time>{post.time}</time>
          </div>
          <button className="post-more" type="button" onClick={() => onPreviewAction('Post controls')} aria-label="More actions"><MoreHorizontal aria-hidden="true" /></button>
        </header>
        <p className="post-copy">{post.text}</p>
        <div className="post-tags">
          {post.tags.map((tag) => <button type="button" key={tag} onClick={() => onPreviewAction(`#${tag}`)}>#{tag}</button>)}
        </div>
        {post.visual ? <ArchitectureVisual visual={post.visual} /> : null}
        {post.media ? <MediaGallery items={post.media} onOpen={onOpenMedia} /> : null}
        <div className="post-audience"><Globe2 aria-hidden="true" />{post.audience}</div>
        <footer className="post-actions" aria-label="Sauti actions">
          <button type="button" onClick={() => onPreviewAction('Replies')} aria-label={`${post.metrics.replies} replies`}><MessageCircle aria-hidden="true" /><span>{post.metrics.replies}</span></button>
          <button type="button" onClick={() => onPreviewAction('Reshare')} aria-label={`${post.metrics.reshares} reshares`}><Repeat2 aria-hidden="true" /><span>{post.metrics.reshares}</span></button>
          <button className={liked ? 'is-liked' : ''} type="button" onClick={() => onLike(post.id)} aria-pressed={liked} aria-label={`${likes} likes`}><Heart aria-hidden="true" /><span>{likes}</span></button>
          <button type="button" onClick={() => onPreviewAction('View insights')} aria-label={`${post.metrics.views} views`}><BarChart3 aria-hidden="true" /><span>{post.metrics.views}</span></button>
          <span className="post-actions-spacer" />
          <button className={saved ? 'is-saved' : ''} type="button" onClick={() => onSave(post.id)} aria-pressed={saved} aria-label={saved ? 'Remove from Saved' : 'Save'}><Bookmark aria-hidden="true" /></button>
          <button type="button" onClick={() => onPreviewAction('Share')} aria-label="Share"><Share2 aria-hidden="true" /></button>
        </footer>
      </div>
    </article>
  );
}

function StreamStatus({ icon: Icon, title, copy, action, onAction }) {
  return (
    <section className="stream-status" role="status">
      <span><Icon aria-hidden="true" /></span>
      <h2>{title}</h2>
      <p>{copy}</p>
      {action ? <button className="small-secondary" type="button" onClick={onAction}><RefreshCw aria-hidden="true" />{action}</button> : null}
    </section>
  );
}

function StreamSkeleton() {
  return <div className="stream-skeleton" aria-label="Loading Stream" aria-busy="true">{[1, 2, 3].map((item) => <article key={item}><span /><div><b /><i /><i /></div></article>)}</div>;
}

function StreamScreen({ member, feedPosts, streamStatus, showStateLab, onStreamStatusChange, liked, saved, onLike, onSave, onOpenMedia, onCompose, onPreviewAction }) {
  const [feedMode, setFeedMode] = useState('selected');
  const visiblePosts = feedMode === 'following' ? feedPosts.slice(1) : feedPosts;
  return (
    <>
      <ScreenHeader title="Stream" subtitle="Latest Sauti from voices and Circles you follow">
        <button className="icon-button" type="button" onClick={() => onPreviewAction('Stream controls')} aria-label="Stream controls"><SlidersHorizontal aria-hidden="true" /></button>
      </ScreenHeader>
      <div className="stream-tabs" role="tablist" aria-label="Stream filter">
        <button role="tab" type="button" aria-selected={feedMode === 'selected'} onClick={() => setFeedMode('selected')}>Selected</button>
        <button role="tab" type="button" aria-selected={feedMode === 'following'} onClick={() => setFeedMode('following')}>Following</button>
      </div>
      <ComposerEntry member={member} onCompose={onCompose} />
      {showStateLab ? <section className="stream-state-lab" aria-label="Preview Stream states"><span>Preview state</span><div>{['ready', 'loading', 'empty', 'offline', 'error'].map((state) => <button key={state} type="button" className={streamStatus === state ? 'is-active' : ''} aria-pressed={streamStatus === state} onClick={() => onStreamStatusChange(state)}>{state}</button>)}</div></section> : null}
      {streamStatus === 'offline' ? <aside className="offline-banner" role="status"><CloudOff aria-hidden="true" /><div><strong>You are offline.</strong><span>Drafts stay on this device. The Stream will refresh when you reconnect.</span></div></aside> : null}
      {streamStatus === 'loading' ? <StreamSkeleton /> : null}
      {streamStatus === 'error' ? <StreamStatus icon={AlertCircle} title="The Stream could not refresh." copy="Your existing content is safe. Try again when the connection is stable." action="Try again" onAction={() => onStreamStatusChange('ready')} /> : null}
      {streamStatus === 'empty' ? <StreamStatus icon={FileText} title="Your Stream is ready for its first voice." copy="Follow people, join a Circle or share the first Sauti to begin." /> : null}
      {streamStatus === 'ready' || streamStatus === 'offline' ? <div className="feed-list">
        {visiblePosts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            liked={liked.has(post.id)}
            saved={saved.has(post.id)}
            onLike={onLike}
            onSave={onSave}
            onOpenMedia={onOpenMedia}
            onPreviewAction={onPreviewAction}
          />
        ))}
      </div> : null}
    </>
  );
}

function DiscoverScreen({ onPreviewAction }) {
  return (
    <>
      <ScreenHeader title="Discover" subtitle="Find useful voices, topics and conversations" />
      <section className="discover-search">
        <Search aria-hidden="true" />
        <input type="search" aria-label="Search SautiLink" placeholder="Search voices, Sauti and Circles" onChange={() => {}} />
        <kbd>/</kbd>
      </section>
      <section className="content-section">
        <div className="section-heading"><div><span>Live signals</span><h2>What people are discussing</h2></div><TrendingUp aria-hidden="true" /></div>
        <div className="topic-grid">
          {trends.map((trend, index) => (
            <button className="topic-card" type="button" key={trend.label} onClick={() => onPreviewAction(trend.label)}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <small>{trend.context}</small>
              <strong>{trend.label}</strong>
              <p>{trend.posts}</p>
            </button>
          ))}
        </div>
      </section>
      <section className="content-section voices-section">
        <div className="section-heading"><div><span>Fresh perspectives</span><h2>Voices worth discovering</h2></div></div>
        {suggestions.map((person) => <SuggestionRow key={person.handle} person={person} />)}
      </section>
    </>
  );
}

function CirclesScreen({ joined, onToggleCircle, onPreviewAction }) {
  const [filter, setFilter] = useState('yours');
  const [selectedCircle, setSelectedCircle] = useState(null);
  const visibleCircles = filter === 'yours'
    ? circles.filter((circle) => joined.has(circle.id))
    : circles.filter((circle) => !joined.has(circle.id));

  if (selectedCircle) {
    const circle = circles.find(({ id }) => id === selectedCircle);
    const isJoined = joined.has(circle.id);
    return (
      <>
        <ScreenHeader title={circle.name} subtitle={`${circle.access} Circle · ${circle.members} members`}>
          <button className="icon-button" type="button" onClick={() => setSelectedCircle(null)} aria-label="Back to Circles"><ChevronLeft aria-hidden="true" /></button>
          <button className={isJoined ? 'small-secondary is-joined' : 'small-primary'} type="button" onClick={() => onToggleCircle(circle.id)}>{isJoined ? 'Joined' : circle.access === 'Approval' ? 'Request to join' : 'Join Circle'}</button>
        </ScreenHeader>
        <section className="circle-detail-hero">
          <span className="circle-monogram circle-monogram-large" aria-hidden="true">{circle.initials}</span>
          <div><span className="profile-state-chip"><ShieldCheck aria-hidden="true" />{circle.access}</span><h2>{circle.name}</h2><p>{circle.description}</p></div>
        </section>
        <section className="circle-detail-grid">
          <article className="circle-detail-panel"><span>Circle health</span><strong>{circle.active}</strong><p>Conversation quality, membership and moderator actions will be observable before launch.</p></article>
          <article className="circle-detail-panel"><span>Your access</span><strong>{isJoined ? circle.role || 'Member' : 'Not joined'}</strong><p>{isJoined ? 'You can read and participate under the visible Circle rules.' : 'Review the rules before joining this Circle.'}</p></article>
        </section>
        <section className="circle-rules">
          <div className="section-heading"><div><span>Before you participate</span><h2>Circle rules</h2></div></div>
          <ol>{circle.rules.map((rule) => <li key={rule}><Check aria-hidden="true" /><span>{rule}</span></li>)}</ol>
        </section>
        <EmptyState icon={UsersRound} title="The Circle Stream starts here." copy="Circle Sauti, pinned context and moderator notices arrive with the conversation milestone." />
      </>
    );
  }

  return (
    <>
      <ScreenHeader title="Circles" subtitle="Focused communities with clear ownership">
        <button className="small-secondary" type="button" onClick={() => onPreviewAction('Create a Circle')}><UsersRound aria-hidden="true" />Create</button>
      </ScreenHeader>
      <section className="circle-intro">
        <span>Community without the noise</span>
        <h2>Go deeper with people who care about the same things.</h2>
        <p>Circles can be open, private or approval-based. Moderators and rules remain visible before you join.</p>
      </section>
      <div className="circle-filters" role="tablist" aria-label="Circle filter">
        <button type="button" role="tab" aria-selected={filter === 'yours'} onClick={() => setFilter('yours')}>Your Circles <span>{joined.size}</span></button>
        <button type="button" role="tab" aria-selected={filter === 'discover'} onClick={() => setFilter('discover')}>Discover <span>{circles.length - joined.size}</span></button>
      </div>
      {visibleCircles.length ? <div className="circle-list">
        {visibleCircles.map((circle) => {
          const isJoined = joined.has(circle.id);
          return (
            <article className="circle-card" key={circle.id}>
              <span className="circle-monogram" aria-hidden="true">{circle.initials}</span>
              <div><button className="circle-title" type="button" onClick={() => setSelectedCircle(circle.id)}><h2>{circle.name}</h2></button><p>{circle.description}</p><small>{circle.access} · {circle.members} members · {circle.active}</small></div>
              <button className={isJoined ? 'small-secondary is-joined' : 'small-primary'} type="button" onClick={() => onToggleCircle(circle.id)}>{isJoined ? circle.role || 'Joined' : circle.access === 'Approval' ? 'Request' : 'Join'}</button>
            </article>
          );
        })}
      </div> : <EmptyState icon={UsersRound} title="Your Circle list is clear." copy="Join a Circle from Discover and it will stay organized here." />}
    </>
  );
}

function MessagesScreen({ onPreviewAction }) {
  const [selected, setSelected] = useState(conversations[0]);
  return (
    <>
      <ScreenHeader title="Messages" subtitle="Private conversations and Circle rooms">
        <button className="icon-button" type="button" onClick={() => onPreviewAction('Message settings')} aria-label="Message settings"><Settings aria-hidden="true" /></button>
        <button className="icon-button accent-icon" type="button" onClick={() => onPreviewAction('New message')} aria-label="New message"><PenLine aria-hidden="true" /></button>
      </ScreenHeader>
      <div className="messages-layout">
        <section className="conversation-list" aria-label="Conversations">
          <label className="conversation-search"><Search aria-hidden="true" /><input type="search" placeholder="Search messages" aria-label="Search messages" /></label>
          {conversations.map((conversation) => (
            <button className={`conversation-row${selected.handle === conversation.handle ? ' is-selected' : ''}`} type="button" key={conversation.handle} onClick={() => setSelected(conversation)}>
              <Avatar initials={conversation.initials} tone={conversation.tone} />
              <span className="conversation-copy"><strong>{conversation.name}{conversation.verified ? <VerifiedMark /> : null}</strong><small>{conversation.preview}</small></span>
              <span className="conversation-meta"><time>{conversation.time}</time>{conversation.unread ? <b>{conversation.unread}</b> : null}</span>
            </button>
          ))}
        </section>
        <section className="message-preview" aria-label={`Conversation with ${selected.name}`}>
          <Avatar initials={selected.initials} tone={selected.tone} size="large" />
          <h2>{selected.name}</h2>
          <p>{selected.handle}</p>
          <span>Encrypted messaging and delivery states arrive in a later milestone.</span>
          <button className="small-primary" type="button" onClick={() => onPreviewAction('Conversation')}>Open preview</button>
        </section>
      </div>
    </>
  );
}

function NotificationsScreen() {
  const iconForKind = { follow: UserPlus, like: Heart, reply: MessageCircle, circle: UsersRound };
  return (
    <>
      <ScreenHeader title="Notifications" subtitle="Meaningful activity across your account">
        <button className="icon-button" type="button" aria-label="Notification settings"><Settings aria-hidden="true" /></button>
      </ScreenHeader>
      <div className="notification-filters" role="tablist" aria-label="Notification filter"><button type="button" role="tab" aria-selected="true">All</button><button type="button" role="tab" aria-selected="false">Mentions</button></div>
      <section className="notification-list">
        {notifications.map((notification) => {
          const KindIcon = iconForKind[notification.kind];
          return (
            <article className="notification-row" key={notification.id}>
              <span className={`notification-kind notification-${notification.kind}`}><KindIcon aria-hidden="true" /></span>
              <Avatar initials={notification.initials} tone={notification.tone} size="small" />
              <div><strong>{notification.title}</strong><p>{notification.detail}</p></div>
              <span className="unread-dot" aria-label="Unread" />
            </article>
          );
        })}
      </section>
    </>
  );
}

function SavedScreen({ saved, liked, onLike, onSave, onPreviewAction }) {
  const savedPosts = posts.filter((post) => saved.has(post.id));
  return (
    <>
      <ScreenHeader title="Saved" subtitle="Private to you and available across your devices" />
      {savedPosts.length ? (
        <div className="feed-list">
          {savedPosts.map((post) => <PostCard key={post.id} post={post} liked={liked.has(post.id)} saved onLike={onLike} onSave={onSave} onPreviewAction={onPreviewAction} />)}
        </div>
      ) : (
        <EmptyState icon={Bookmark} title="Keep the Sauti you want to return to." copy="Use the bookmark action on any Sauti. Your Saved list is private." />
      )}
    </>
  );
}

function ProfileScreen({ member, viewMode, onViewModeChange, following, onFollow, liked, saved, onLike, onSave, onEdit, onPreviewAction }) {
  const [tab, setTab] = useState('sauti');
  const [controlsOpen, setControlsOpen] = useState(false);
  const viewedMember = viewMode === 'public' ? publicMember : member;
  const isOwner = viewMode === 'owner';

  return (
    <>
      <ScreenHeader title={isOwner ? 'Profile' : viewedMember.name} subtitle={viewedMember.handle}>
        <button className="small-secondary profile-view-toggle" type="button" onClick={() => onViewModeChange(isOwner ? 'public' : 'owner')}>{isOwner ? 'View public profile' : 'Back to your profile'}</button>
        {isOwner ? <button className="icon-button" type="button" onClick={() => onPreviewAction('Profile settings')} aria-label="Profile settings"><Settings aria-hidden="true" /></button> : null}
      </ScreenHeader>
      <section className={`profile-cover${isOwner ? ' profile-cover-owner' : ''}`} aria-label="Profile cover preview">
        <span>{isOwner ? 'SautiLink' : 'DESIGN · PEOPLE · PLACES'}</span>
        {isOwner ? <button className="profile-media-button" type="button" onClick={() => onPreviewAction('Header image')} aria-label="Change header image"><Camera aria-hidden="true" /></button> : null}
      </section>
      <section className="profile-summary">
        <span className="profile-avatar-wrap"><Avatar initials={viewedMember.initials} tone={isOwner ? 'graphite' : 'sand'} size="xlarge" />{isOwner ? <button className="profile-avatar-button" type="button" onClick={() => onPreviewAction('Avatar image')} aria-label="Change profile image"><Camera aria-hidden="true" /></button> : null}</span>
        <div className="profile-primary-actions">
          {isOwner ? <button className="small-secondary" type="button" onClick={onEdit}>Edit profile</button> : (
            <>
              <button className={following ? 'small-secondary is-following' : 'small-primary'} type="button" onClick={onFollow}>{following ? 'Following' : 'Follow'}</button>
              <button className="icon-button" type="button" onClick={() => onPreviewAction('Profile notifications')} aria-label="Profile notifications"><Bell aria-hidden="true" /></button>
              <span className="profile-controls-wrap"><button className="icon-button" type="button" onClick={() => setControlsOpen((open) => !open)} aria-expanded={controlsOpen} aria-label="Profile safety controls"><MoreHorizontal aria-hidden="true" /></button>{controlsOpen ? <span className="profile-controls-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setControlsOpen(false); onPreviewAction(`Mute ${viewedMember.handle}`); }}><UserMinus aria-hidden="true" />Mute</button><button type="button" role="menuitem" onClick={() => { setControlsOpen(false); onPreviewAction(`Block ${viewedMember.handle}`); }}><ShieldCheck aria-hidden="true" />Block</button></span> : null}</span>
            </>
          )}
        </div>
        <h2>{viewedMember.name}{viewedMember.verified ? <VerifiedMark /> : null}</h2><p className="profile-handle">{viewedMember.handle}</p>
        <p className="profile-bio">{viewedMember.bio}</p>
        <div className="profile-meta"><span><MapPin aria-hidden="true" />{viewedMember.location}</span><button type="button" onClick={() => onPreviewAction('Website')}><ExternalLink aria-hidden="true" />{viewedMember.website}</button><span><CalendarDays aria-hidden="true" />{viewedMember.joined}</span></div>
        <div className="profile-counts"><button type="button" onClick={() => onPreviewAction('Following list')}><strong>{viewedMember.following}</strong> Following</button><button type="button" onClick={() => onPreviewAction('Followers list')}><strong>{viewedMember.followers}</strong> Followers</button></div>
      </section>
      <div className="profile-tabs" role="tablist" aria-label="Profile content"><button type="button" role="tab" aria-selected={tab === 'sauti'} onClick={() => setTab('sauti')}>Sauti</button><button type="button" role="tab" aria-selected={tab === 'replies'} onClick={() => setTab('replies')}>Replies</button><button type="button" role="tab" aria-selected={tab === 'media'} onClick={() => setTab('media')}>Media</button></div>
      {tab === 'sauti' ? <PostCard post={posts[1]} liked={liked.has(posts[1].id)} saved={saved.has(posts[1].id)} onLike={onLike} onSave={onSave} onPreviewAction={onPreviewAction} /> : null}
      {tab === 'replies' ? <EmptyState icon={MessageCircle} title="No replies to show yet." copy="Replies will appear here without mixing them into the member’s main Sauti list." /> : null}
      {tab === 'media' ? <EmptyState icon={Image} title="Media will have its own focused view." copy="R2-backed images and video arrive in the dedicated media milestone." /> : null}
    </>
  );
}

function EditProfileDialog({ open, member, onClose, onSave, onMediaAction }) {
  const nameInput = useRef(null);
  const [draft, setDraft] = useState(member);
  const [discoverable, setDiscoverable] = useState(true);

  useEffect(() => {
    if (!open) return undefined;
    setDraft(member);
    nameInput.current?.focus();
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, member, onClose]);

  if (!open) return null;
  const update = (field) => (event) => setDraft((current) => ({ ...current, [field]: event.target.value }));
  const save = (event) => {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) return;
    const initials = name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
    onSave({ ...draft, name, bio: draft.bio.trim(), location: draft.location.trim(), website: draft.website.trim(), initials });
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="profile-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title" onSubmit={save}>
        <header><button className="icon-button" type="button" onClick={onClose} aria-label="Close profile editor"><X aria-hidden="true" /></button><div><span>Public identity</span><h2 id="profile-edit-title">Edit profile</h2></div><button className="small-primary" type="submit" disabled={!draft.name.trim()}>Save</button></header>
        <section className="profile-edit-media"><div><span className="circle-monogram circle-monogram-large" aria-hidden="true">{draft.initials}</span><button type="button" onClick={() => onMediaAction('Profile image')}><Camera aria-hidden="true" />Change photo</button></div><button type="button" onClick={() => onMediaAction('Header image')}><Camera aria-hidden="true" />Change header</button></section>
        <div className="profile-edit-fields">
          <label><span>Display name</span><input ref={nameInput} value={draft.name} onChange={update('name')} maxLength="80" required /><small>{draft.name.length}/80</small></label>
          <label><span>Bio</span><textarea value={draft.bio} onChange={update('bio')} maxLength="500" rows="4" /><small>{draft.bio.length}/500</small></label>
          <label><span>Location</span><input value={draft.location} onChange={update('location')} maxLength="100" /></label>
          <label><span>Website</span><input value={draft.website} onChange={update('website')} inputMode="url" maxLength="120" /></label>
          <label className="profile-discoverable"><span><strong>Show in Discover</strong><small>People can find this public profile. Private account details remain separate.</small></span><input type="checkbox" checked={discoverable} onChange={(event) => setDiscoverable(event.target.checked)} aria-label="Show profile in Discover" /></label>
        </div>
        <footer><ShieldCheck aria-hidden="true" /><p>Your email, WhatsApp preferences and security settings are never part of this public profile.</p></footer>
      </form>
    </div>
  );
}

function EmptyState({ icon: Icon, title, copy }) {
  return <section className="empty-state"><span><Icon aria-hidden="true" /></span><h2>{title}</h2><p>{copy}</p></section>;
}

function SuggestionRow({ person }) {
  const [following, setFollowing] = useState(false);
  return (
    <div className="suggestion-row">
      <Avatar initials={person.initials} tone={person.tone} size="small" />
      <div><strong>{person.name}{person.verified ? <VerifiedMark /> : null}</strong><span>{person.handle}</span></div>
      <button className={following ? 'small-secondary is-following' : 'small-primary'} type="button" onClick={() => setFollowing((value) => !value)}>{following ? 'Following' : 'Follow'}</button>
    </div>
  );
}

function ContextRail({ theme, previewMilestone, onThemeToggle, onNavigate, onPreviewAction }) {
  return (
    <aside className="context-rail" aria-label="Discover more">
      <label className="global-search"><Search aria-hidden="true" /><input type="search" placeholder="Search SautiLink" aria-label="Search SautiLink" /><kbd>/</kbd></label>
      <section className="context-panel">
        <header><h2>Now on SautiLink</h2><button type="button" onClick={() => onNavigate('discover')} aria-label="Open Discover"><TrendingUp aria-hidden="true" /></button></header>
        {trends.slice(0, 3).map((trend) => (
          <button className="trend-row" type="button" key={trend.label} onClick={() => onPreviewAction(trend.label)}><small>{trend.context}</small><strong>{trend.label}</strong><span>{trend.posts}</span></button>
        ))}
        <button className="context-link" type="button" onClick={() => onNavigate('discover')}>Show more</button>
      </section>
      <section className="context-panel">
        <header><h2>Voices to discover</h2></header>
        {suggestions.map((person) => <SuggestionRow key={person.handle} person={person} />)}
        <button className="context-link" type="button" onClick={() => onNavigate('discover')}>See all voices</button>
      </section>
      <div className="preview-note"><span>{previewMilestone.label}</span><strong>{previewMilestone.title}</strong><p>{previewMilestone.note}</p></div>
      <footer className="context-footer"><button type="button" onClick={onThemeToggle}>{theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button><a href="/privacy">Privacy</a><a href="/terms">Terms</a><span>© 2026 SautiLink</span></footer>
    </aside>
  );
}

function ComposeDialog({ open, member, offline, mediaEnabled, onClose, onSubmit }) {
  const textareaRef = useRef(null);
  const [text, setText] = useState('');
  const [audience, setAudience] = useState('Public');
  const [replyAccess, setReplyAccess] = useState('Everyone');
  const [drafts, setDrafts] = useState([]);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [altEditorId, setAltEditorId] = useState(null);
  const uploadTimers = useRef(new Set());
  useEffect(() => {
    if (!open) return undefined;
    textareaRef.current?.focus();
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);
  useEffect(() => () => {
    uploadTimers.current.forEach((timer) => window.clearTimeout(timer));
    uploadTimers.current.clear();
  }, []);
  if (!open) return null;
  const finishUpload = (localId) => {
    const timer = window.setTimeout(() => {
      setAttachments((current) => current.map((item) => item.localId === localId ? { ...item, status: 'ready', progress: 100, error: undefined } : item));
      uploadTimers.current.delete(timer);
    }, 850);
    uploadTimers.current.add(timer);
  };
  const addMedia = (kind) => {
    if (attachments.length >= 4) return;
    const template = mediaTemplates[kind];
    const localId = `${template.id}-${Date.now()}`;
    const status = template.error ? 'error' : offline ? 'queued' : 'uploading';
    setAttachments((current) => [...current, { ...template, localId, status, progress: status === 'uploading' ? 68 : 0 }]);
    if (status === 'uploading') finishUpload(localId);
  };
  const retryMedia = (localId) => {
    setAttachments((current) => current.map((item) => item.localId === localId ? { ...item, kind: 'image', name: 'optimized-event.jpg', details: '1920 × 1080 · 8.2 MB', scene: 'workshop', status: offline ? 'queued' : 'uploading', progress: offline ? 0 : 34, error: undefined } : item));
    if (!offline) finishUpload(localId);
  };
  const canCompose = Boolean(text.trim() || attachments.length);
  const hasBlockingMedia = !offline && attachments.some((item) => item.status !== 'ready');
  const storeDraft = () => {
    if (!canCompose) return;
    const draftMedia = attachments.map((item) => item.status === 'ready' || item.status === 'error' ? item : { ...item, status: 'queued', progress: 0 });
    setDrafts((current) => [{ id: Date.now(), text: text.trim(), audience, replyAccess, media: draftMedia }, ...current].slice(0, 5));
    setText('');
    setAttachments([]);
    setAltEditorId(null);
    setMediaPickerOpen(false);
    setDraftsOpen(true);
  };
  const submit = () => {
    if (!canCompose || hasBlockingMedia) return;
    if (offline) {
      storeDraft();
      return;
    }
    onSubmit({ text: text.trim(), audience, replyAccess, media: attachments.map((item) => ({ ...item, id: item.localId })) });
    setText('');
    setAttachments([]);
    setAltEditorId(null);
    setMediaPickerOpen(false);
    setDraftsOpen(false);
  };
  const activeAltItem = attachments.find((item) => item.localId === altEditorId);
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="compose-dialog" role="dialog" aria-modal="true" aria-labelledby="compose-title">
        <header><button className="icon-button" type="button" onClick={onClose} aria-label="Close composer"><X aria-hidden="true" /></button><h2 id="compose-title">Share a Sauti</h2><button className="draft-action" type="button" aria-expanded={draftsOpen} onClick={() => setDraftsOpen((value) => !value)}>Drafts{drafts.length ? ` (${drafts.length})` : ''}</button></header>
        {draftsOpen ? <section className="draft-panel" aria-label="Saved drafts"><div><strong>Drafts on this device</strong><button type="button" onClick={() => setDraftsOpen(false)}>Done</button></div>{drafts.length ? drafts.map((draft) => <button className="draft-row" type="button" key={draft.id} onClick={() => { setText(draft.text); setAudience(draft.audience); setReplyAccess(draft.replyAccess || 'Everyone'); setAttachments(draft.media || []); setDrafts((current) => current.filter(({ id }) => id !== draft.id)); setDraftsOpen(false); }}><span>{draft.text || 'Media Sauti'}</span><small>{draft.audience}{draft.media?.length ? ` · ${draft.media.length} media` : ''}</small></button>) : <p>No drafts yet. Your unfinished Sauti will stay private here.</p>}</section> : null}
        <MediaPickerPanel open={mediaEnabled && mediaPickerOpen} count={attachments.length} offline={offline} onAdd={addMedia} onClose={() => setMediaPickerOpen(false)} />
        <div className="compose-scroll-region">
          <div className="compose-body"><Avatar initials={member.initials} tone="graphite" /><textarea ref={textareaRef} value={text} onChange={(event) => setText(event.target.value.slice(0, 500))} placeholder="What deserves to be heard?" aria-label="Your Sauti" rows={attachments.length ? '3' : '6'} /></div>
          {mediaEnabled ? <ComposerMediaGrid items={attachments} onAlt={setAltEditorId} onRetry={retryMedia} onRemove={(localId) => { setAttachments((current) => current.filter((item) => item.localId !== localId)); if (altEditorId === localId) setAltEditorId(null); }} /> : null}
          <AltTextEditor item={activeAltItem} onChange={(alt) => setAttachments((current) => current.map((item) => item.localId === altEditorId ? { ...item, alt } : item))} onDone={() => setAltEditorId(null)} />
        </div>
        <div className="compose-settings">
          <label><Globe2 aria-hidden="true" /><span>Audience</span><select value={audience} onChange={(event) => setAudience(event.target.value)} aria-label="Sauti audience"><option>Public</option><option>Followers</option><option>East Africa Builders</option></select><ChevronDown aria-hidden="true" /></label>
          <label><MessageCircle aria-hidden="true" /><span>Replies</span><select value={replyAccess} onChange={(event) => setReplyAccess(event.target.value)} aria-label="Who can reply"><option>Everyone</option><option>People you follow</option><option>Only people mentioned</option></select><ChevronDown aria-hidden="true" /></label>
        </div>
        {offline ? <div className="compose-offline"><CloudOff aria-hidden="true" />Offline Sauti will be saved as a draft.</div> : null}
        {hasBlockingMedia ? <div className="compose-media-note" role="status">Finish or remove pending media before sharing.</div> : null}
        <footer><div className="dialog-tools"><button className={mediaPickerOpen ? 'is-active' : ''} type="button" aria-expanded={mediaPickerOpen} aria-label="Add media" onClick={() => mediaEnabled ? setMediaPickerOpen((value) => !value) : undefined}><Image aria-hidden="true" /></button><button type="button" aria-label="Create poll"><BarChart3 aria-hidden="true" /></button><button type="button" aria-label="Add emoji"><Smile aria-hidden="true" /></button><button type="button" aria-label="Schedule"><CalendarDays aria-hidden="true" /></button><button type="button" aria-label="Add location"><MapPin aria-hidden="true" /></button></div><button className="save-draft-action" type="button" disabled={!canCompose} onClick={storeDraft}>Save draft</button><span className="character-count">{text.length}/500</span><button className="small-primary compose-submit" type="button" disabled={!canCompose || hasBlockingMedia} onClick={submit}>{offline ? 'Save draft' : 'Share'}</button></footer>
      </section>
    </div>
  );
}

function MobileNavigation({ section, onNavigate, onCompose }) {
  return (
    <nav className="mobile-navigation" aria-label="Mobile navigation">
      {mobileNavigation.slice(0, 2).map((item) => <NavigationItem key={item.id} item={item} active={section === item.id} onSelect={onNavigate} compact />)}
      <button className="mobile-compose" type="button" onClick={onCompose} aria-label="Share a Sauti"><PenLine aria-hidden="true" /></button>
      {mobileNavigation.slice(2).map((item) => <NavigationItem key={item.id} item={item} active={section === item.id} onSelect={onNavigate} compact />)}
    </nav>
  );
}

function MobileMenu({ open, member, onClose, onNavigate }) {
  if (!open) return null;
  return (
    <div className="mobile-menu-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="mobile-menu" role="dialog" aria-modal="true" aria-label="Account menu">
        <header><Brand /><button className="icon-button" type="button" onClick={onClose} aria-label="Close menu"><X aria-hidden="true" /></button></header>
        <div className="mobile-member"><Avatar initials={member.initials} tone="graphite" size="large" /><strong>{member.name}</strong><span>{member.handle}</span><p><b>{member.following}</b> Following <b>{member.followers}</b> Followers</p></div>
        <nav>{navigation.map((item) => <NavigationItem key={item.id} item={item} active={false} onSelect={(id) => { onNavigate(id); onClose(); }} />)}</nav>
      </aside>
    </div>
  );
}

export default function App({
  initialSection = 'stream',
  enableStreamLab = false,
  enableMediaPreview = false,
  previewMilestone = { label: 'Preview 01', title: 'App shell', note: 'Seeded data only. No production accounts or posts.' },
}) {
  const [section, setSection] = useState(() => getInitialSection(initialSection));
  const [theme, setTheme] = useState(getInitialTheme);
  const [member, setMember] = useState({ ...currentMember });
  const [feedPosts, setFeedPosts] = useState(() => enableMediaPreview ? createSeededMediaFeed(posts) : posts);
  const [streamStatus, setStreamStatus] = useState('ready');
  const [liked, setLiked] = useState(new Set(['local-voices']));
  const [saved, setSaved] = useState(new Set(['platform-foundation']));
  const [joinedCircles, setJoinedCircles] = useState(new Set(['east-africa-builders', 'quiet-design-club']));
  const [profileView, setProfileView] = useState('owner');
  const [followingPublicProfile, setFollowingPublicProfile] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [activeMedia, setActiveMedia] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f1115' : '#ffffff');
    try { window.localStorage.setItem('sautilink.preview.theme', theme); } catch { /* optional */ }
  }, [theme]);

  useEffect(() => {
    document.title = `${navigation.find((item) => item.id === section)?.label || 'Stream'} — SautiLink Preview`;
    window.history.replaceState(null, '', `#${section}`);
    document.getElementById('main-content')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [section]);

  useEffect(() => {
    const onHashChange = () => setSection(getInitialSection(initialSection));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [initialSection]);

  const showToast = (message) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(''), 3200);
  };

  const toggleSetValue = (setter, id) => setter((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const onSave = (id) => {
    const willSave = !saved.has(id);
    toggleSetValue(setSaved, id);
    showToast(willSave ? 'Saved privately.' : 'Removed from Saved.');
  };

  const toggleCircle = (id) => {
    const willJoin = !joinedCircles.has(id);
    toggleSetValue(setJoinedCircles, id);
    showToast(willJoin ? 'Circle added to your list.' : 'Circle removed from your list.');
  };

  const sectionContent = useMemo(() => {
    const shared = { member, liked, saved, onLike: (id) => toggleSetValue(setLiked, id), onSave, onOpenMedia: setActiveMedia, onPreviewAction: (label) => showToast(`${label} is represented in this visual preview.`) };
    if (section === 'discover') return <DiscoverScreen onPreviewAction={shared.onPreviewAction} />;
    if (section === 'circles') return <CirclesScreen joined={joinedCircles} onToggleCircle={toggleCircle} onPreviewAction={shared.onPreviewAction} />;
    if (section === 'messages') return <MessagesScreen onPreviewAction={shared.onPreviewAction} />;
    if (section === 'notifications') return <NotificationsScreen />;
    if (section === 'saved') return <SavedScreen {...shared} />;
    if (section === 'profile') return <ProfileScreen {...shared} viewMode={profileView} onViewModeChange={setProfileView} following={followingPublicProfile} onFollow={() => { setFollowingPublicProfile((value) => !value); showToast(followingPublicProfile ? `Unfollowed ${publicMember.handle}.` : `Following ${publicMember.handle}.`); }} onEdit={() => setEditProfileOpen(true)} />;
    return <StreamScreen {...shared} feedPosts={feedPosts} streamStatus={streamStatus} showStateLab={enableStreamLab} onStreamStatusChange={setStreamStatus} onCompose={() => setComposeOpen(true)} />;
  }, [section, member, feedPosts, streamStatus, enableStreamLab, liked, saved, joinedCircles, profileView, followingPublicProfile]);

  const submitPreviewSauti = ({ text, audience, replyAccess, media = [] }) => {
    const tags = [...text.matchAll(/#([a-z0-9_]+)/gi)].map((match) => match[1]).slice(0, 5);
    setFeedPosts((current) => [{
      id: `preview-${Date.now()}`,
      author: { name: member.name, handle: member.handle, initials: member.initials, tone: 'graphite', verified: false },
      time: 'Now',
      audience,
      replyAccess,
      text,
      tags,
      media,
      metrics: { replies: 0, reshares: 0, likes: 0, views: '0' },
    }, ...current]);
    setComposeOpen(false);
    setStreamStatus('ready');
    setSection('stream');
    showToast('Your Sauti appears at the top of this preview. Nothing reached production.');
  };

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <MobileTopbar section={section} theme={theme} onThemeToggle={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} onMenu={() => setMenuOpen(true)} onNavigate={setSection} />
      <div className="app-shell">
        <PrimaryRail section={section} member={member} onNavigate={setSection} onCompose={() => setComposeOpen(true)} onMore={() => showToast('Settings, moderation and account controls will live here.')} />
        <main className="main-column" id="main-content" tabIndex="-1">{sectionContent}</main>
        <ContextRail theme={theme} previewMilestone={previewMilestone} onThemeToggle={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} onNavigate={setSection} onPreviewAction={(label) => showToast(`${label} is represented in this visual preview.`)} />
      </div>
      <MobileNavigation section={section} onNavigate={setSection} onCompose={() => setComposeOpen(true)} />
      <MobileMenu open={menuOpen} member={member} onClose={() => setMenuOpen(false)} onNavigate={setSection} />
      <ComposeDialog open={composeOpen} member={member} offline={streamStatus === 'offline'} mediaEnabled={enableMediaPreview} onClose={() => setComposeOpen(false)} onSubmit={submitPreviewSauti} />
      <EditProfileDialog open={editProfileOpen} member={member} onClose={() => setEditProfileOpen(false)} onMediaAction={(label) => showToast(enableMediaPreview ? `${label} will use the same validated R2 workflow shown in the composer.` : `${label} upload arrives with the R2 media milestone.`)} onSave={(nextMember) => { setMember(nextMember); setEditProfileOpen(false); showToast('Profile changes saved in this preview.'); }} />
      <MediaViewer item={activeMedia} onClose={() => setActiveMedia(null)} />
      {toast ? <div className="toast" role="status" aria-live="polite"><span>{toast}</span><button type="button" onClick={() => setToast('')} aria-label="Dismiss"><X aria-hidden="true" /></button></div> : null}
    </>
  );
}
