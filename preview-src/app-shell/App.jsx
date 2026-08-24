import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  BarChart3,
  Bell,
  Bookmark,
  CalendarDays,
  ChevronDown,
  CircleEllipsis,
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
  Repeat2,
  Search,
  Send,
  Settings,
  Share2,
  SlidersHorizontal,
  Smile,
  Sun,
  TrendingUp,
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
  suggestions,
  trends,
} from './data.js';

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

function getInitialSection() {
  const candidate = window.location.hash.replace('#', '');
  return knownSections.has(candidate) ? candidate : 'stream';
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

function PrimaryRail({ section, onNavigate, onCompose, onMore }) {
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
          <Avatar initials={currentMember.initials} tone="graphite" size="small" />
          <span className="member-switcher-copy">
            <strong>{currentMember.name}</strong>
            <small>{currentMember.handle}</small>
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

function ComposerEntry({ onCompose }) {
  return (
    <section className="composer-entry" aria-label="Share a Sauti">
      <Avatar initials={currentMember.initials} tone="graphite" />
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

function PostCard({ post, liked, saved, onLike, onSave, onPreviewAction }) {
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

function StreamScreen({ liked, saved, onLike, onSave, onCompose, onPreviewAction }) {
  const [feedMode, setFeedMode] = useState('selected');
  const visiblePosts = feedMode === 'following' ? posts.slice(1) : posts;
  return (
    <>
      <ScreenHeader title="Stream" subtitle="Voices and Circles selected for you">
        <button className="icon-button" type="button" onClick={() => onPreviewAction('Stream controls')} aria-label="Stream controls"><SlidersHorizontal aria-hidden="true" /></button>
      </ScreenHeader>
      <div className="stream-tabs" role="tablist" aria-label="Stream filter">
        <button role="tab" type="button" aria-selected={feedMode === 'selected'} onClick={() => setFeedMode('selected')}>Selected</button>
        <button role="tab" type="button" aria-selected={feedMode === 'following'} onClick={() => setFeedMode('following')}>Following</button>
      </div>
      <ComposerEntry onCompose={onCompose} />
      <div className="feed-list">
        {visiblePosts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            liked={liked.has(post.id)}
            saved={saved.has(post.id)}
            onLike={onLike}
            onSave={onSave}
            onPreviewAction={onPreviewAction}
          />
        ))}
      </div>
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

function CirclesScreen({ onPreviewAction }) {
  const [joined, setJoined] = useState(new Set(['east-africa-builders']));
  const toggleCircle = (id) => setJoined((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
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
      <div className="circle-list">
        {circles.map((circle) => {
          const isJoined = joined.has(circle.id);
          return (
            <article className="circle-card" key={circle.id}>
              <span className="circle-monogram" aria-hidden="true">{circle.initials}</span>
              <div><h2>{circle.name}</h2><p>{circle.description}</p><small>{circle.members} members · {circle.active}</small></div>
              <button className={isJoined ? 'small-secondary is-joined' : 'small-primary'} type="button" onClick={() => toggleCircle(circle.id)}>{isJoined ? 'Joined' : 'Join'}</button>
            </article>
          );
        })}
      </div>
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

function ProfileScreen({ liked, saved, onLike, onSave, onPreviewAction }) {
  return (
    <>
      <ScreenHeader title="Profile" subtitle={currentMember.handle}>
        <button className="icon-button" type="button" onClick={() => onPreviewAction('Profile settings')} aria-label="Profile settings"><Settings aria-hidden="true" /></button>
      </ScreenHeader>
      <section className="profile-cover" aria-label="Profile cover preview"><span>SautiLink</span></section>
      <section className="profile-summary">
        <Avatar initials={currentMember.initials} tone="graphite" size="xlarge" />
        <button className="small-secondary profile-edit" type="button" onClick={() => onPreviewAction('Edit profile')}>Edit profile</button>
        <h2>{currentMember.name}</h2><p className="profile-handle">{currentMember.handle}</p>
        <p className="profile-bio">{currentMember.bio}</p>
        <div className="profile-meta"><span><MapPin aria-hidden="true" />{currentMember.location}</span><span><CalendarDays aria-hidden="true" />{currentMember.joined}</span></div>
        <div className="profile-counts"><button type="button"><strong>{currentMember.following}</strong> Following</button><button type="button"><strong>{currentMember.followers}</strong> Followers</button></div>
      </section>
      <div className="profile-tabs" role="tablist" aria-label="Profile content"><button type="button" role="tab" aria-selected="true">Sauti</button><button type="button" role="tab" aria-selected="false">Replies</button><button type="button" role="tab" aria-selected="false">Media</button></div>
      <PostCard post={posts[1]} liked={liked.has(posts[1].id)} saved={saved.has(posts[1].id)} onLike={onLike} onSave={onSave} onPreviewAction={onPreviewAction} />
    </>
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

function ContextRail({ theme, onThemeToggle, onNavigate, onPreviewAction }) {
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
      <div className="preview-note"><span>Preview 01</span><strong>App shell</strong><p>Seeded data only. No production accounts or posts.</p></div>
      <footer className="context-footer"><button type="button" onClick={onThemeToggle}>{theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button><a href="/privacy">Privacy</a><a href="/terms">Terms</a><span>© 2026 SautiLink</span></footer>
    </aside>
  );
}

function ComposeDialog({ open, onClose, onSubmit }) {
  const textareaRef = useRef(null);
  const [text, setText] = useState('');
  useEffect(() => {
    if (!open) return undefined;
    textareaRef.current?.focus();
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);
  if (!open) return null;
  const submit = () => { onSubmit(text); setText(''); };
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="compose-dialog" role="dialog" aria-modal="true" aria-labelledby="compose-title">
        <header><button className="icon-button" type="button" onClick={onClose} aria-label="Close composer"><X aria-hidden="true" /></button><h2 id="compose-title">Share a Sauti</h2><button className="draft-action" type="button">Drafts</button></header>
        <div className="compose-body"><Avatar initials={currentMember.initials} tone="graphite" /><textarea ref={textareaRef} value={text} onChange={(event) => setText(event.target.value.slice(0, 500))} placeholder="What deserves to be heard?" aria-label="Your Sauti" rows="6" /></div>
        <div className="compose-visibility"><Globe2 aria-hidden="true" />Everyone can reply<ChevronDown aria-hidden="true" /></div>
        <footer><div className="dialog-tools"><button type="button" aria-label="Add media"><Image aria-hidden="true" /></button><button type="button" aria-label="Create poll"><BarChart3 aria-hidden="true" /></button><button type="button" aria-label="Add emoji"><Smile aria-hidden="true" /></button><button type="button" aria-label="Schedule"><CalendarDays aria-hidden="true" /></button><button type="button" aria-label="Add location"><MapPin aria-hidden="true" /></button></div><span className="character-count">{text.length}/500</span><button className="small-primary compose-submit" type="button" disabled={!text.trim()} onClick={submit}>Share</button></footer>
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

function MobileMenu({ open, onClose, onNavigate }) {
  if (!open) return null;
  return (
    <div className="mobile-menu-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="mobile-menu" role="dialog" aria-modal="true" aria-label="Account menu">
        <header><Brand /><button className="icon-button" type="button" onClick={onClose} aria-label="Close menu"><X aria-hidden="true" /></button></header>
        <div className="mobile-member"><Avatar initials={currentMember.initials} tone="graphite" size="large" /><strong>{currentMember.name}</strong><span>{currentMember.handle}</span><p><b>{currentMember.following}</b> Following <b>{currentMember.followers}</b> Followers</p></div>
        <nav>{navigation.map((item) => <NavigationItem key={item.id} item={item} active={false} onSelect={(id) => { onNavigate(id); onClose(); }} />)}</nav>
      </aside>
    </div>
  );
}

export default function App() {
  const [section, setSection] = useState(getInitialSection);
  const [theme, setTheme] = useState(getInitialTheme);
  const [liked, setLiked] = useState(new Set(['local-voices']));
  const [saved, setSaved] = useState(new Set(['platform-foundation']));
  const [composeOpen, setComposeOpen] = useState(false);
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
    const onHashChange = () => setSection(getInitialSection());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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

  const sectionContent = useMemo(() => {
    const shared = { liked, saved, onLike: (id) => toggleSetValue(setLiked, id), onSave, onPreviewAction: (label) => showToast(`${label} is represented in this visual preview.`) };
    if (section === 'discover') return <DiscoverScreen onPreviewAction={shared.onPreviewAction} />;
    if (section === 'circles') return <CirclesScreen onPreviewAction={shared.onPreviewAction} />;
    if (section === 'messages') return <MessagesScreen onPreviewAction={shared.onPreviewAction} />;
    if (section === 'notifications') return <NotificationsScreen />;
    if (section === 'saved') return <SavedScreen {...shared} />;
    if (section === 'profile') return <ProfileScreen {...shared} />;
    return <StreamScreen {...shared} onCompose={() => setComposeOpen(true)} />;
  }, [section, liked, saved]);

  const submitPreviewSauti = (text) => {
    setComposeOpen(false);
    showToast(text.trim() ? 'Composer approved visually. Nothing was published.' : 'Nothing was published.');
  };

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <MobileTopbar section={section} theme={theme} onThemeToggle={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} onMenu={() => setMenuOpen(true)} onNavigate={setSection} />
      <div className="app-shell">
        <PrimaryRail section={section} onNavigate={setSection} onCompose={() => setComposeOpen(true)} onMore={() => showToast('Settings, moderation and account controls will live here.')} />
        <main className="main-column" id="main-content" tabIndex="-1">{sectionContent}</main>
        <ContextRail theme={theme} onThemeToggle={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} onNavigate={setSection} onPreviewAction={(label) => showToast(`${label} is represented in this visual preview.`)} />
      </div>
      <MobileNavigation section={section} onNavigate={setSection} onCompose={() => setComposeOpen(true)} />
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} onNavigate={setSection} />
      <ComposeDialog open={composeOpen} onClose={() => setComposeOpen(false)} onSubmit={submitPreviewSauti} />
      {toast ? <div className="toast" role="status" aria-live="polite"><span>{toast}</span><button type="button" onClick={() => setToast('')} aria-label="Dismiss"><X aria-hidden="true" /></button></div> : null}
    </>
  );
}
