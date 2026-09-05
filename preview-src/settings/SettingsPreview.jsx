import { useState } from 'react';
import {
  Bell,
  Download,
  Eye,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  MessageSquare,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';

const sections = [
  { id: 'account', label: 'Account', icon: UserRound },
  { id: 'privacy', label: 'Privacy', icon: Lock },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'safety', label: 'Safety', icon: ShieldCheck },
  { id: 'data', label: 'Your data', icon: Download },
];

function ToggleRow({ title, copy, checked, onChange }) {
  return (
    <label className="settings-toggle-row">
      <span><strong>{title}</strong><small>{copy}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true"><b /></i>
    </label>
  );
}

function SettingsHeader({ eyebrow, title, copy }) {
  return <header className="settings-panel-header"><span>{eyebrow}</span><h2>{title}</h2><p>{copy}</p></header>;
}

function AccountPanel({ member, sessions, onSignOutSessions, onPreviewAction }) {
  return (
    <div className="settings-panel">
      <SettingsHeader eyebrow="Identity & security" title="Account" copy="Review the identity and active devices connected to your SautiLink account." />
      <section className="settings-card">
        <div className="settings-card-title"><UserRound aria-hidden="true" /><div><strong>Account identity</strong><small>Your verified sign-in details</small></div></div>
        <dl className="settings-details">
          <div><dt>Username</dt><dd>{member.handle}</dd></div>
          <div><dt>Email</dt><dd>member@sample.sautilink.com <span>Verified</span></dd></div>
          <div><dt>Language</dt><dd>English</dd></div>
        </dl>
        <button className="settings-secondary" type="button" onClick={() => onPreviewAction('Password recovery is represented in this seeded preview.')}><KeyRound aria-hidden="true" />Change password</button>
      </section>
      <section className="settings-card">
        <div className="settings-card-title"><Laptop aria-hidden="true" /><div><strong>Active sessions</strong><small>Devices currently signed in</small></div></div>
        <div className="session-list">
          {sessions.map((session) => <article key={session.id}><span><Laptop aria-hidden="true" /></span><div><strong>{session.device}</strong><small>{session.location} · {session.lastActive}</small></div>{session.current ? <b>Current</b> : null}</article>)}
        </div>
        <button className="settings-secondary" type="button" disabled={sessions.length === 1} onClick={onSignOutSessions}><LogOut aria-hidden="true" />Sign out other sessions</button>
      </section>
    </div>
  );
}

function PrivacyPanel({ privacy, setPrivacy }) {
  const update = (key, value) => setPrivacy((current) => ({ ...current, [key]: value }));
  return (
    <div className="settings-panel">
      <SettingsHeader eyebrow="Control your visibility" title="Privacy" copy="Choose how people find and contact you without enabling advertising or unnecessary tracking." />
      <section className="settings-card settings-toggle-list">
        <ToggleRow title="Discoverable account" copy="Allow people to find your public profile in SautiLink search." checked={privacy.discoverable} onChange={(value) => update('discoverable', value)} />
        <ToggleRow title="External search indexing" copy="Allow public profile pages to appear in external search engines." checked={privacy.externalIndexing} onChange={(value) => update('externalIndexing', value)} />
        <ToggleRow title="Read receipts" copy="Let people know when you have read a direct message." checked={privacy.readReceipts} onChange={(value) => update('readReceipts', value)} />
        <ToggleRow title="Activity status" copy="Show people you follow when you were recently active." checked={privacy.activityStatus} onChange={(value) => update('activityStatus', value)} />
      </section>
      <section className="settings-card">
        <div className="settings-card-title"><MessageSquare aria-hidden="true" /><div><strong>Who can message you</strong><small>Basic one-to-one Messages only</small></div></div>
        <label className="settings-select"><span>Message requests</span><select value={privacy.messageAccess} onChange={(event) => update('messageAccess', event.target.value)}><option>People you follow</option><option>Everyone</option><option>No one</option></select></label>
      </section>
    </div>
  );
}

function NotificationsPanel({ notifications, setNotifications }) {
  const update = (key, value) => setNotifications((current) => ({ ...current, [key]: value }));
  return (
    <div className="settings-panel">
      <SettingsHeader eyebrow="Only useful signals" title="Notifications" copy="Decide which activity deserves your attention. Promotional notifications are not part of the MVP." />
      <section className="settings-card settings-toggle-list">
        <ToggleRow title="Replies and mentions" copy="Activity involving your public Sauti and username." checked={notifications.replies} onChange={(value) => update('replies', value)} />
        <ToggleRow title="Direct messages" copy="New one-to-one Messages and message requests." checked={notifications.messages} onChange={(value) => update('messages', value)} />
        <ToggleRow title="New followers" copy="When a public voice follows your profile." checked={notifications.followers} onChange={(value) => update('followers', value)} />
        <ToggleRow title="Sautify activity" copy="Important updates from Circles you joined." checked={notifications.circles} onChange={(value) => update('circles', value)} />
        <ToggleRow title="Security alerts" copy="New sign-ins, password changes and account recovery." checked={notifications.security} onChange={(value) => update('security', value)} />
      </section>
      <section className="settings-card">
        <label className="settings-select"><span>Email summary</span><select value={notifications.digest} onChange={(event) => update('digest', event.target.value)}><option>Off</option><option>Daily</option><option>Weekly</option></select></label>
      </section>
    </div>
  );
}

function SafetyPanel({ blocked, muted, onUnblock, onUnmute }) {
  return (
    <div className="settings-panel">
      <SettingsHeader eyebrow="Your boundaries" title="Safety controls" copy="Review accounts you blocked or muted. These lists are private to you." />
      <section className="settings-card">
        <div className="settings-card-title"><ShieldCheck aria-hidden="true" /><div><strong>Blocked accounts</strong><small>They cannot follow or message you</small></div></div>
        <div className="safety-account-list">{blocked.length ? blocked.map((person) => <article key={person.handle}><span>{person.initials}</span><div><strong>{person.name}</strong><small>{person.handle}</small></div><button type="button" onClick={() => onUnblock(person.handle)}>Unblock</button></article>) : <p>No blocked accounts in this preview.</p>}</div>
      </section>
      <section className="settings-card">
        <div className="settings-card-title"><Eye aria-hidden="true" /><div><strong>Muted accounts</strong><small>Their posts are hidden from your Home feed</small></div></div>
        <div className="safety-account-list">{muted.length ? muted.map((person) => <article key={person.handle}><span>{person.initials}</span><div><strong>{person.name}</strong><small>{person.handle}</small></div><button type="button" onClick={() => onUnmute(person.handle)}>Unmute</button></article>) : <p>No muted accounts in this preview.</p>}</div>
      </section>
    </div>
  );
}

function DataPanel({ exportRequested, onExport, onDelete }) {
  return (
    <div className="settings-panel">
      <SettingsHeader eyebrow="Portable and reversible" title="Your data" copy="Request a copy of your information or begin the protected account-deletion flow." />
      <section className="settings-card data-action-card"><span><Download aria-hidden="true" /></span><div><strong>Download your data</strong><p>A real export will require recent authentication and will be prepared privately.</p>{exportRequested ? <small role="status">Seeded export request recorded on this device.</small> : null}</div><button className="settings-secondary" type="button" disabled={exportRequested} onClick={onExport}>{exportRequested ? 'Requested' : 'Request export'}</button></section>
      <section className="settings-card data-action-card is-danger"><span><Trash2 aria-hidden="true" /></span><div><strong>Delete your account</strong><p>Deletion must require recent authentication, a clear confirmation and a recovery window before permanent removal.</p></div><button className="settings-danger" type="button" onClick={onDelete}>Start deletion</button></section>
    </div>
  );
}

function DeleteAccountDialog({ open, handle, onClose, onConfirm }) {
  const [confirmation, setConfirmation] = useState('');
  if (!open) return null;
  const canConfirm = confirmation.trim().toUpperCase() === 'DELETE';
  return (
    <div className="settings-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-account-title">
        <header><div><span>Protected action</span><h2 id="delete-account-title">Delete {handle}?</h2></div><button type="button" onClick={onClose} aria-label="Close account deletion"><X aria-hidden="true" /></button></header>
        <p>This seeded preview will not delete an account. A real request must sign out active sessions, enter a recovery window and remove data under the published retention policy.</p>
        <label><span>Type DELETE to continue</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
        <footer><button className="settings-secondary" type="button" onClick={onClose}>Cancel</button><button className="settings-danger" type="button" disabled={!canConfirm} onClick={() => { onConfirm(); setConfirmation(''); }}>Confirm deletion request</button></footer>
      </section>
    </div>
  );
}

export default function SettingsPreview({ member, onPreviewAction }) {
  const [activeSection, setActiveSection] = useState('account');
  const [privacy, setPrivacy] = useState({ discoverable: true, externalIndexing: false, readReceipts: true, activityStatus: false, messageAccess: 'People you follow' });
  const [notifications, setNotifications] = useState({ replies: true, messages: true, followers: true, circles: false, security: true, digest: 'Off' });
  const [sessions, setSessions] = useState([
    { id: 'current', device: 'Windows · Chrome', location: 'Tanzania', lastActive: 'Active now', current: true },
    { id: 'phone', device: 'Android · SautiLink Web', location: 'Tanzania', lastActive: '2 days ago', current: false },
  ]);
  const [blocked, setBlocked] = useState([{ name: 'Seeded Account One', handle: '@seededone', initials: 'S1' }, { name: 'Seeded Account Two', handle: '@seededtwo', initials: 'S2' }]);
  const [muted, setMuted] = useState([{ name: 'Quiet Preview', handle: '@quietpreview', initials: 'QP' }]);
  const [exportRequested, setExportRequested] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const activePanel = {
    account: <AccountPanel member={member} sessions={sessions} onSignOutSessions={() => { setSessions((current) => current.filter(({ current: isCurrent }) => isCurrent)); onPreviewAction('Other seeded sessions signed out on this device.'); }} onPreviewAction={onPreviewAction} />,
    privacy: <PrivacyPanel privacy={privacy} setPrivacy={setPrivacy} />,
    notifications: <NotificationsPanel notifications={notifications} setNotifications={setNotifications} />,
    safety: <SafetyPanel blocked={blocked} muted={muted} onUnblock={(handle) => setBlocked((current) => current.filter((person) => person.handle !== handle))} onUnmute={(handle) => setMuted((current) => current.filter((person) => person.handle !== handle))} />,
    data: <DataPanel exportRequested={exportRequested} onExport={() => { setExportRequested(true); onPreviewAction('Seeded data export requested on this device.'); }} onDelete={() => setDeleteOpen(true)} />,
  }[activeSection];

  return (
    <>
      <header className="settings-screen-header"><span>Account controls</span><h1>Settings</h1><p>Privacy-first controls for your SautiLink experience.</p></header>
      <div className="settings-layout">
        <nav className="settings-navigation" aria-label="Settings sections">{sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={activeSection === id ? 'is-active' : ''} aria-current={activeSection === id ? 'page' : undefined} onClick={() => setActiveSection(id)}><Icon aria-hidden="true" /><span>{label}</span></button>)}</nav>
        <main className="settings-content">{activePanel}</main>
      </div>
      <DeleteAccountDialog open={deleteOpen} handle={member.handle} onClose={() => setDeleteOpen(false)} onConfirm={() => { setDeleteOpen(false); onPreviewAction('Seeded deletion request confirmed. No account was changed.'); }} />
    </>
  );
}
