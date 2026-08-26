import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Bookmark,
  Check,
  ChevronRight,
  Circle,
  Eye,
  Globe2,
  Heart,
  LockKeyhole,
  MessageCircle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  UsersRound,
  Volume2,
  X,
} from 'lucide-react';
import { circles, notifications, posts, suggestions, trends } from './data.js';

const notificationCategory = {
  n1: 'following',
  n2: 'all',
  n3: 'mentions',
  n4: 'system',
};

function Initials({ value, tone = 'graphite' }) {
  return <span className={`experience-avatar experience-avatar-${tone}`} aria-hidden="true">{value}</span>;
}

function PreviewBoundary() {
  return (
    <aside className="experience-boundary" role="note">
      <ShieldCheck aria-hidden="true" />
      <div>
        <strong>Private preview boundary</strong>
        <span>Seeded content only. Search, notification and setting changes stay in this browser.</span>
      </div>
    </aside>
  );
}

function ExperienceHeader({ eyebrow, title, subtitle, children }) {
  return (
    <header className="experience-header">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children ? <div className="experience-header-actions">{children}</div> : null}
    </header>
  );
}

function ResultSection({ title, count, children }) {
  return (
    <section className="experience-result-section">
      <header><h2>{title}</h2><span>{count}</span></header>
      <div>{children}</div>
    </section>
  );
}

function DiscoverExperience({ onPreviewAction }) {
  const searchRef = useRef(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [previewState, setPreviewState] = useState('ready');

  useEffect(() => {
    const onShortcut = (event) => {
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape' && document.activeElement === searchRef.current) {
        setQuery('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  const normalized = query.trim().toLowerCase();
  const voiceResults = useMemo(() => suggestions.filter((item) =>
    `${item.name} ${item.handle}`.toLowerCase().includes(normalized)), [normalized]);
  const circleResults = useMemo(() => circles.filter((item) =>
    `${item.name} ${item.description}`.toLowerCase().includes(normalized)), [normalized]);
  const sautiResults = useMemo(() => posts.filter((item) =>
    `${item.author.name} ${item.author.handle} ${item.text} ${item.tags.join(' ')}`.toLowerCase().includes(normalized)), [normalized]);
  const total = voiceResults.length + circleResults.length + sautiResults.length;
  const show = (kind) => filter === 'all' || filter === kind;

  return (
    <div className="experience-preview">
      <ExperienceHeader eyebrow="Phase 12 · Search & Discover" title="Find signal without losing control." subtitle="Search public voices, Sauti and Circles with clear filters and predictable states." />
      <PreviewBoundary />
      <form className="experience-search" role="search" onSubmit={(event) => event.preventDefault()}>
        <Search aria-hidden="true" />
        <input ref={searchRef} type="search" value={query} onChange={(event) => { setQuery(event.target.value.slice(0, 80)); setPreviewState('ready'); }} placeholder="Search voices, Sauti and Circles" aria-label="Search SautiLink" autoComplete="off" />
        {query ? <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus(); }} aria-label="Clear search"><X aria-hidden="true" /></button> : <kbd>/</kbd>}
      </form>
      <div className="experience-filter-row" role="tablist" aria-label="Search result type">
        {['all', 'voices', 'sauti', 'circles'].map((item) => <button key={item} type="button" role="tab" aria-selected={filter === item} onClick={() => setFilter(item)}>{item === 'all' ? 'All' : item[0].toUpperCase() + item.slice(1)}</button>)}
      </div>
      <section className="experience-state-lab" aria-label="Preview search states">
        <span>Preview state</span>
        <div>{['ready', 'loading', 'offline', 'error'].map((state) => <button key={state} type="button" aria-pressed={previewState === state} onClick={() => setPreviewState(state)}>{state}</button>)}</div>
      </section>

      {previewState === 'loading' ? <div className="experience-skeleton" aria-label="Loading search results" aria-busy="true">{[1, 2, 3].map((item) => <span key={item} />)}</div> : null}
      {previewState === 'offline' ? <section className="experience-status"><Globe2 aria-hidden="true" /><h2>Search is paused offline.</h2><p>Your recent results stay visible on this device. Try again when the connection returns.</p><button type="button" onClick={() => setPreviewState('ready')}>Show cached view</button></section> : null}
      {previewState === 'error' ? <section className="experience-status"><Circle aria-hidden="true" /><h2>Search could not refresh.</h2><p>No query or account data was lost.</p><button type="button" onClick={() => setPreviewState('ready')}>Try again</button></section> : null}

      {previewState === 'ready' && !normalized ? (
        <>
          <section className="experience-discovery-block">
            <header><span>Useful now</span><h2>Topics across the region</h2></header>
            <div className="experience-topic-grid">{trends.map((trend) => <button type="button" key={trend.label} onClick={() => setQuery(trend.label)}><small>{trend.context}</small><strong>{trend.label}</strong><span>{trend.posts}</span></button>)}</div>
          </section>
          <ResultSection title="Voices worth discovering" count={suggestions.length}>
            {suggestions.map((person) => <button className="experience-person-row" type="button" key={person.handle} onClick={() => onPreviewAction(`${person.name} profile is represented in this preview.`)}><Initials value={person.initials} tone={person.tone} /><span><strong>{person.name}</strong><small>{person.handle}</small></span><UserPlus aria-hidden="true" /></button>)}
          </ResultSection>
        </>
      ) : null}

      {previewState === 'ready' && normalized && total === 0 ? <section className="experience-status"><Search aria-hidden="true" /><h2>No results for “{query}”.</h2><p>Try a name, topic, Circle or shorter phrase.</p><button type="button" onClick={() => setQuery('')}>Clear search</button></section> : null}
      {previewState === 'ready' && normalized && total > 0 ? (
        <div className="experience-results" aria-live="polite">
          {show('voices') && voiceResults.length ? <ResultSection title="Voices" count={voiceResults.length}>{voiceResults.map((person) => <button className="experience-person-row" type="button" key={person.handle} onClick={() => onPreviewAction(`${person.name} profile is represented in this preview.`)}><Initials value={person.initials} tone={person.tone} /><span><strong>{person.name}</strong><small>{person.handle}</small></span><ChevronRight aria-hidden="true" /></button>)}</ResultSection> : null}
          {show('sauti') && sautiResults.length ? <ResultSection title="Sauti" count={sautiResults.length}>{sautiResults.map((post) => <button className="experience-sauti-row" type="button" key={post.id} onClick={() => onPreviewAction('Search result conversation is represented in this preview.')}><Initials value={post.author.initials} tone={post.author.tone} /><span><strong>{post.author.name} <small>{post.author.handle}</small></strong><p>{post.text}</p></span><Bookmark aria-hidden="true" /></button>)}</ResultSection> : null}
          {show('circles') && circleResults.length ? <ResultSection title="Circles" count={circleResults.length}>{circleResults.map((circle) => <button className="experience-circle-row" type="button" key={circle.id} onClick={() => onPreviewAction(`${circle.name} is represented in this preview.`)}><Initials value={circle.initials} tone="blue" /><span><strong>{circle.name}</strong><small>{circle.access} · {circle.members} members</small></span><UsersRound aria-hidden="true" /></button>)}</ResultSection> : null}
        </div>
      ) : null}
    </div>
  );
}

function NotificationsExperience({ onNavigate, onOpenThread, onPreviewAction }) {
  const [filter, setFilter] = useState('all');
  const [readIds, setReadIds] = useState(() => new Set(['n2']));
  const visible = filter === 'all' ? notifications : notifications.filter((item) => notificationCategory[item.id] === filter);
  const unread = notifications.length - readIds.size;
  const icons = { follow: UserPlus, like: Heart, reply: MessageCircle, circle: UsersRound };

  const openNotification = (item) => {
    setReadIds((current) => new Set(current).add(item.id));
    if (item.kind === 'reply') onOpenThread();
    else onPreviewAction(`${item.title}. Opened locally.`);
  };

  return (
    <div className="experience-preview">
      <ExperienceHeader eyebrow="Phase 12 · Notifications" title="Important activity, kept quiet." subtitle="Filter meaningful events, control unread state and choose what can interrupt you.">
        <button className="experience-secondary" type="button" onClick={() => onNavigate('settings')}><SlidersHorizontal aria-hidden="true" />Preferences</button>
      </ExperienceHeader>
      <PreviewBoundary />
      <div className="experience-notification-toolbar">
        <div className="experience-filter-row" role="tablist" aria-label="Notification type">
          {['all', 'mentions', 'following', 'system'].map((item) => <button key={item} type="button" role="tab" aria-selected={filter === item} onClick={() => setFilter(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}
        </div>
        <button type="button" onClick={() => setReadIds(new Set(notifications.map((item) => item.id)))} disabled={unread === 0}><Check aria-hidden="true" />Mark all read</button>
      </div>
      <section className="experience-notification-summary"><Bell aria-hidden="true" /><div><strong>{unread} unread</strong><span>Only activity you asked for appears here.</span></div></section>
      {visible.length ? <section className="experience-notification-list" aria-live="polite">{visible.map((item) => {
        const Icon = icons[item.kind];
        const isRead = readIds.has(item.id);
        return <button className={`experience-notification-row${isRead ? ' is-read' : ''}`} type="button" key={item.id} onClick={() => openNotification(item)}><span className={`experience-notification-icon notification-${item.kind}`}><Icon aria-hidden="true" /></span><Initials value={item.initials} tone={item.tone} /><span><strong>{item.title}</strong><small>{item.detail}</small></span>{!isRead ? <i aria-label="Unread" /> : <Check aria-label="Read" />}</button>;
      })}</section> : <section className="experience-status"><Bell aria-hidden="true" /><h2>No notifications in this view.</h2><p>Choose All to return to the complete activity list.</p><button type="button" onClick={() => setFilter('all')}>Show all</button></section>}
    </div>
  );
}

const settingGroups = [
  { id: 'account', label: 'Account', icon: Eye },
  { id: 'privacy', label: 'Privacy & safety', icon: LockKeyhole },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'accessibility', label: 'Accessibility', icon: Volume2 },
  { id: 'data', label: 'Data controls', icon: ShieldCheck },
];

function SettingSwitch({ label, description, checked, onChange }) {
  return (
    <div className="experience-setting-row">
      <span><strong>{label}</strong><small>{description}</small></span>
      <button className="experience-switch" type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><span /></button>
    </div>
  );
}

function SettingsExperience({ onPreviewAction }) {
  const [active, setActive] = useState('account');
  const [saved, setSaved] = useState(false);
  const [language, setLanguage] = useState('English');
  const [preferences, setPreferences] = useState({
    discoverable: true,
    publicProfile: true,
    mentions: true,
    following: true,
    system: true,
    emailDigest: false,
    reducedMotion: false,
    autoplay: false,
    highContrast: false,
    activityStatus: false,
  });
  const update = (key, value) => {
    setSaved(false);
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="experience-preview">
      <ExperienceHeader eyebrow="Phase 12 · Settings" title="Your account, your boundaries." subtitle="Privacy, safety, notification and accessibility controls in one predictable place.">
        <button className="experience-primary" type="button" onClick={() => setSaved(true)}><Check aria-hidden="true" />Save on this device</button>
      </ExperienceHeader>
      <PreviewBoundary />
      {saved ? <div className="experience-saved-notice" role="status"><Check aria-hidden="true" />Preview preferences saved locally. Nothing reached production.</div> : null}
      <div className="experience-settings-layout">
        <nav className="experience-settings-nav" aria-label="Settings categories">{settingGroups.map((group) => {
          const Icon = group.icon;
          return <button type="button" key={group.id} className={active === group.id ? 'is-active' : ''} aria-current={active === group.id ? 'page' : undefined} onClick={() => setActive(group.id)}><Icon aria-hidden="true" /><span>{group.label}</span><ChevronRight aria-hidden="true" /></button>;
        })}</nav>
        <section className="experience-settings-panel">
          <header><span>{settingGroups.find((item) => item.id === active)?.label}</span><h2>{active === 'account' ? 'Account preferences' : active === 'privacy' ? 'Privacy and safety' : active === 'notifications' ? 'Notification preferences' : active === 'accessibility' ? 'Accessibility and language' : 'Your data'}</h2></header>
          {active === 'account' ? <>
            <SettingSwitch label="Public profile" description="Allow people to view your public profile and public Sauti." checked={preferences.publicProfile} onChange={(value) => update('publicProfile', value)} />
            <SettingSwitch label="Show activity status" description="Let people you follow see when you were recently active." checked={preferences.activityStatus} onChange={(value) => update('activityStatus', value)} />
            <label className="experience-select-row"><span><strong>Display language</strong><small>Choose the language used for navigation and settings.</small></span><select value={language} onChange={(event) => { setSaved(false); setLanguage(event.target.value); }}><option>English</option><option>Kiswahili</option><option>Français</option><option>Español</option><option>Norsk</option></select></label>
          </> : null}
          {active === 'privacy' ? <>
            <SettingSwitch label="Appear in Discover" description="Allow your public profile to appear in relevant public searches." checked={preferences.discoverable} onChange={(value) => update('discoverable', value)} />
            <SettingSwitch label="Autoplay media" description="Play public video automatically when your connection allows it." checked={preferences.autoplay} onChange={(value) => update('autoplay', value)} />
            <button className="experience-link-row" type="button" onClick={() => onPreviewAction('Muted and blocked accounts are represented in this preview.')}><span><strong>Muted and blocked accounts</strong><small>Review voices and topics you do not want to see.</small></span><ChevronRight aria-hidden="true" /></button>
          </> : null}
          {active === 'notifications' ? <>
            <SettingSwitch label="Mentions and replies" description="Notify you when someone directly includes you in a conversation." checked={preferences.mentions} onChange={(value) => update('mentions', value)} />
            <SettingSwitch label="People you follow" description="Show selected activity from voices you chose to follow." checked={preferences.following} onChange={(value) => update('following', value)} />
            <SettingSwitch label="Security and system" description="Keep important account and safety notices enabled." checked={preferences.system} onChange={(value) => update('system', value)} />
            <SettingSwitch label="Email digest" description="Receive a quiet summary instead of many separate emails." checked={preferences.emailDigest} onChange={(value) => update('emailDigest', value)} />
          </> : null}
          {active === 'accessibility' ? <>
            <SettingSwitch label="Reduce motion" description="Limit non-essential movement throughout SautiLink." checked={preferences.reducedMotion} onChange={(value) => update('reducedMotion', value)} />
            <SettingSwitch label="Higher contrast" description="Increase separation between text, controls and surfaces." checked={preferences.highContrast} onChange={(value) => update('highContrast', value)} />
            <SettingSwitch label="Stop media autoplay" description="Require an explicit action before video or audio plays." checked={!preferences.autoplay} onChange={(value) => update('autoplay', !value)} />
          </> : null}
          {active === 'data' ? <>
            <button className="experience-link-row" type="button" onClick={() => onPreviewAction('Download your information is represented in this preview.')}><span><strong>Download your information</strong><small>Prepare a portable copy of your account data.</small></span><ChevronRight aria-hidden="true" /></button>
            <button className="experience-link-row" type="button" onClick={() => onPreviewAction('Active sessions are represented in this preview.')}><span><strong>Devices and sessions</strong><small>Review where your account is signed in and close old sessions.</small></span><ChevronRight aria-hidden="true" /></button>
            <button className="experience-link-row experience-danger-row" type="button" onClick={() => onPreviewAction('Account deletion requires re-authentication and a protected server workflow.')}><span><strong>Deactivate or delete account</strong><small>Use a protected, reversible process before permanent deletion.</small></span><ChevronRight aria-hidden="true" /></button>
          </> : null}
        </section>
      </div>
      <section className="experience-integration">
        <header><span>Integration readiness</span><h2>Safe path from test to production</h2></header>
        <div>
          <article><strong>Canonical data source</strong><p>Account, profile and social data remain protected by row-level policies and server-owned authorization.</p></article>
          <article><strong>Cloudflare edge controls</strong><p>Workers validate writes, enforce rate limits and keep secrets out of browser bundles.</p></article>
          <article><strong>Promotion gate</strong><p>test.sautilink.com comes first; production follows only after security, accessibility and rollback checks.</p></article>
        </div>
      </section>
    </div>
  );
}

export default function ExperiencePreview({ section, onNavigate, onOpenThread, onPreviewAction }) {
  if (section === 'notifications') return <NotificationsExperience onNavigate={onNavigate} onOpenThread={onOpenThread} onPreviewAction={onPreviewAction} />;
  if (section === 'settings') return <SettingsExperience onPreviewAction={onPreviewAction} />;
  return <DiscoverExperience onPreviewAction={onPreviewAction} />;
}
