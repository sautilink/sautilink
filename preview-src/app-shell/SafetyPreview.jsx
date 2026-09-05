import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileWarning,
  Flag,
  Gavel,
  History,
  Info,
  LockKeyhole,
  MessageSquareWarning,
  MoreHorizontal,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  UserRoundCheck,
  X,
} from 'lucide-react';

const reportSeed = [
  {
    id: 'report-1042',
    status: 'Needs review',
    category: 'Harassment',
    priority: 'High',
    reporter: '@neemahabari',
    target: '@kijijitech',
    surface: 'Reply in East Africa Builders',
    age: '12m',
    excerpt: 'The reply appears to target a person rather than the idea. Context and the full thread are available to reviewers.',
  },
  {
    id: 'report-1039',
    status: 'Needs review',
    category: 'Privacy',
    priority: 'High',
    reporter: '@mariamnuru',
    target: '@jabariotieno',
    surface: 'Public Sauti',
    age: '28m',
    excerpt: 'A member says private contact information was included in a public post without permission.',
  },
  {
    id: 'report-1035',
    status: 'Assigned',
    category: 'Spam',
    priority: 'Medium',
    reporter: '@asham',
    target: '@dailyoffers',
    surface: 'Feed',
    age: '1h',
    excerpt: 'Repeated promotional replies may be coordinated engagement rather than useful participation.',
  },
  {
    id: 'report-1028',
    status: 'Resolved',
    category: 'Impersonation',
    priority: 'Medium',
    reporter: '@sautilinkdev',
    target: '@sautilink_support',
    surface: 'Profile',
    age: '3h',
    excerpt: 'The account used a confusingly similar name and avatar. The review found no connection to SautiLink.',
  },
];

const appealSeed = [
  { id: 'appeal-207', status: 'Awaiting review', action: 'Visibility limited', member: '@dailyoffers', reason: 'I believe this was applied in error.', age: '46m', sla: '18h left' },
  { id: 'appeal-204', status: 'Awaiting review', action: 'Post removed', member: '@mtaaobserver', reason: 'The post was a quotation from a public report.', age: '2h', sla: '16h left' },
  { id: 'appeal-198', status: 'Decided', action: 'Reply restored', member: '@asham', reason: 'Additional context was supplied after the first review.', age: '1d', sla: 'Closed' },
];

const auditSeed = [
  { time: 'Today · 14:18', event: 'Report assigned', actor: 'M. Reviewer', detail: 'report-1035 · Spam' },
  { time: 'Today · 13:52', event: 'Appeal opened', actor: 'System', detail: 'appeal-207 · Visibility limited' },
  { time: 'Today · 12:46', event: 'Post restored', actor: 'A. Moderator', detail: 'report-1019 · Context review complete' },
  { time: 'Yesterday · 19:22', event: 'Policy version published', actor: 'Safety team', detail: 'Community Guidelines v0.4' },
];

const policyRows = [
  ['Context first', 'Review the surrounding thread, not only the reported excerpt.'],
  ['Proportionate action', 'Prefer the smallest action that protects people and conversation.'],
  ['Member notice', 'Explain meaningful decisions and give members a path to appeal.'],
];

function SafetyMetric({ label, value, note, tone = 'neutral' }) {
  return <article className={`safety-metric safety-metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function SafetyBadge({ children, tone = 'neutral' }) {
  return <span className={`safety-badge safety-badge-${tone}`}>{children}</span>;
}

function SafetyTabs({ tab, onChange }) {
  const tabs = [
    ['overview', 'Overview', ShieldCheck],
    ['reports', 'Reports', Flag],
    ['appeals', 'Appeals', Scale],
    ['admin', 'Admin operations', ClipboardCheck],
  ];
  return <div className="safety-tabs" role="tablist" aria-label="Trust and Safety sections">{tabs.map(([id, label, Icon]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onChange(id)}><Icon aria-hidden="true" /><span>{label}</span>{id === 'reports' ? <b>3</b> : null}</button>)}</div>;
}

function ReportDialog({ open, onClose, onSubmit }) {
  const [reason, setReason] = useState('Harassment or abuse');
  const [details, setDetails] = useState('');
  if (!open) return null;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="safety-report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-dialog-title" onSubmit={(event) => { event.preventDefault(); onSubmit({ reason, details: details.trim() }); }}>
      <header><div><span>Member safety</span><h2 id="report-dialog-title">Report a Sauti</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close report dialog"><X aria-hidden="true" /></button></header>
      <div className="safety-report-copy"><MessageSquareWarning aria-hidden="true" /><p>Reports are reviewed with context. A report does not automatically remove content or reveal your identity to the reported member.</p></div>
      <label><span>What is the concern?</span><select value={reason} onChange={(event) => setReason(event.target.value)}><option>Harassment or abuse</option><option>Privacy or personal information</option><option>Spam or manipulation</option><option>Impersonation</option><option>Other safety concern</option></select></label>
      <label><span>Additional context <small>Optional</small></span><textarea value={details} onChange={(event) => setDetails(event.target.value.slice(0, 500))} rows="5" placeholder="Tell the review team what happened…" /><small className="safety-count">{details.length}/500</small></label>
      <footer><span><LockKeyhole aria-hidden="true" />Simulation only · no report is sent</span><div><button className="small-secondary" type="button" onClick={onClose}>Cancel</button><button className="small-primary" type="submit"><Flag aria-hidden="true" />Submit report</button></div></footer>
    </form>
  </div>;
}

function Overview({ onReport, onTab }) {
  return <>
    <div className="safety-metrics"><SafetyMetric label="Open reports" value="3" note="2 high priority" tone="attention" /><SafetyMetric label="Appeals waiting" value="2" note="Oldest · 46m" /><SafetyMetric label="Median first review" value="18m" note="Last 24 hours" tone="good" /><SafetyMetric label="Policy coverage" value="100%" note="Every action has a reason" /></div>
    <section className="safety-callout"><span className="safety-callout-icon"><ShieldCheck aria-hidden="true" /></span><div><span className="eyebrow">Safety posture</span><h2>Make room for difficult conversations.</h2><p>SautiLink safety tools protect people while keeping context, proportion and member agency visible. This preview models the review surface before any backend contract is connected.</p><div className="safety-callout-actions"><button className="small-primary" type="button" onClick={onReport}><Flag aria-hidden="true" />Report something</button><button className="small-secondary" type="button" onClick={() => onTab('admin')}><ClipboardCheck aria-hidden="true" />Review operations</button></div></div></section>
    <section className="safety-section"><div className="safety-section-heading"><div><span className="eyebrow">Decision model</span><h2>Clear steps for every case</h2></div><Info aria-hidden="true" /></div><div className="safety-policy-grid">{policyRows.map(([title, copy], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
    <section className="safety-section safety-controls-section"><div className="safety-section-heading"><div><span className="eyebrow">Member controls</span><h2>Tools people can use immediately</h2></div><SlidersHorizontal aria-hidden="true" /></div><div className="safety-control-grid"><article><span><Ban aria-hidden="true" /></span><div><h3>Mute and block</h3><p>Reduce unwanted contact without creating a public spectacle.</p></div><button type="button" onClick={onReport} aria-label="Preview mute and block controls"><ChevronRight aria-hidden="true" /></button></article><article><span><Flag aria-hidden="true" /></span><div><h3>Report with context</h3><p>Send a concern privately and see what happens next.</p></div><button type="button" onClick={onReport} aria-label="Open report flow"><ChevronRight aria-hidden="true" /></button></article><article><span><Gavel aria-hidden="true" /></span><div><h3>Appeal a decision</h3><p>Give members a structured route to request another look.</p></div><button type="button" onClick={() => onTab('appeals')} aria-label="Open appeals"><ChevronRight aria-hidden="true" /></button></article></div></section>
  </>;
}

function Reports({ reports, selectedId, onSelect, onAction, filter, onFilter }) {
  const filtered = useMemo(() => filter === 'All' ? reports : reports.filter((report) => report.status === filter), [filter, reports]);
  const selected = reports.find(({ id }) => id === selectedId) || filtered[0];
  return <div className="safety-workspace"><section className="safety-queue"><div className="safety-toolbar"><div><span className="eyebrow">Review queue</span><h2>Reports</h2></div><button className="icon-button" type="button" aria-label="Report queue filters"><SlidersHorizontal aria-hidden="true" /></button></div><div className="safety-filter-row" role="tablist" aria-label="Report status filter">{['All', 'Needs review', 'Assigned', 'Resolved'].map((item) => <button key={item} type="button" role="tab" aria-selected={filter === item} onClick={() => onFilter(item)}>{item}</button>)}</div><div className="safety-report-list">{filtered.length ? filtered.map((report) => <button className={`safety-report-row${selected?.id === report.id ? ' is-selected' : ''}`} key={report.id} type="button" onClick={() => onSelect(report.id)}><span className="safety-report-icon"><FileWarning aria-hidden="true" /></span><span><strong>{report.category}</strong><small>{report.surface} · {report.age}</small></span><SafetyBadge tone={report.status === 'Needs review' ? 'attention' : report.status === 'Resolved' ? 'good' : 'neutral'}>{report.status}</SafetyBadge><span className={`priority-dot priority-${report.priority.toLowerCase()}`} aria-label={`${report.priority} priority`} /></button>) : <div className="safety-empty"><CheckCircle2 aria-hidden="true" /><strong>Nothing in this view.</strong><p>Try another report status.</p></div>}</div></section>{selected ? <section className="safety-detail"><header><div><span className="eyebrow">Case {selected.id}</span><h2>{selected.category}</h2></div><button className="icon-button" type="button" onClick={() => onAction(selected.id, 'More case options')} aria-label="More case options"><MoreHorizontal aria-hidden="true" /></button></header><div className="safety-detail-meta"><SafetyBadge tone={selected.status === 'Resolved' ? 'good' : selected.status === 'Needs review' ? 'attention' : 'neutral'}>{selected.status}</SafetyBadge><span><Clock3 aria-hidden="true" />Opened {selected.age} ago</span><span><AlertTriangle aria-hidden="true" />{selected.priority} priority</span></div><div className="safety-detail-card"><span className="eyebrow">Reported context</span><p>{selected.excerpt}</p><dl><div><dt>Reporter</dt><dd>{selected.reporter}</dd></div><div><dt>Reported member</dt><dd>{selected.target}</dd></div><div><dt>Surface</dt><dd>{selected.surface}</dd></div></dl></div><div className="safety-action-panel"><span className="eyebrow">Reviewer actions</span><p>Actions are reversible in this preview and create an audit entry.</p><div><button className="small-secondary" type="button" onClick={() => onAction(selected.id, 'Dismissed with context')}><Check aria-hidden="true" />Dismiss</button><button className="small-secondary" type="button" onClick={() => onAction(selected.id, 'Visibility limited')}><SlidersHorizontal aria-hidden="true" />Limit visibility</button><button className="small-primary" type="button" onClick={() => onAction(selected.id, 'Escalated')}><Gavel aria-hidden="true" />Escalate</button></div></div></section> : null}</div>;
}

function Appeals({ appeals, onAction }) {
  return <section className="safety-section appeals-section"><div className="safety-toolbar"><div><span className="eyebrow">Member review</span><h2>Appeals</h2></div><SafetyBadge tone="attention">2 awaiting review</SafetyBadge></div><div className="appeal-list">{appeals.map((appeal) => <article className="appeal-card" key={appeal.id}><div className="appeal-card-header"><div><span className="eyebrow">{appeal.id}</span><h3>{appeal.member}</h3></div><SafetyBadge tone={appeal.status === 'Decided' ? 'good' : 'attention'}>{appeal.status}</SafetyBadge></div><div className="appeal-action"><span>Original action</span><strong>{appeal.action}</strong></div><p>“{appeal.reason}”</p><footer><span><Clock3 aria-hidden="true" />{appeal.sla}</span>{appeal.status === 'Decided' ? <button className="small-secondary" type="button" onClick={() => onAction(appeal.id, 'Opened decision history')}>View history</button> : <button className="small-primary" type="button" onClick={() => onAction(appeal.id, 'Appeal opened for review')}>Review appeal</button>}</footer></article>)}</div></section>;
}

function AdminOperations({ onAction }) {
  return <>
    <section className="safety-section admin-access"><div className="safety-toolbar"><div><span className="eyebrow">Least privilege</span><h2>Admin operations</h2></div><SafetyBadge tone="good"><LockKeyhole aria-hidden="true" />Protected preview</SafetyBadge></div><div className="admin-access-grid"><article><span className="admin-icon"><UserRoundCheck aria-hidden="true" /></span><div><h3>Reviewer workspace</h3><p>Can review reports, add notes and recommend a proportionate action.</p></div><SafetyBadge>Reviewer</SafetyBadge></article><article><span className="admin-icon"><Gavel aria-hidden="true" /></span><div><h3>Escalation workspace</h3><p>Can handle high-risk cases and approve sensitive enforcement decisions.</p></div><SafetyBadge>Senior reviewer</SafetyBadge></article><article><span className="admin-icon"><ClipboardCheck aria-hidden="true" /></span><div><h3>Audit workspace</h3><p>Can inspect immutable decision history without changing case outcomes.</p></div><SafetyBadge>Auditor</SafetyBadge></article></div></section>
    <section className="safety-section"><div className="safety-section-heading"><div><span className="eyebrow">Accountability</span><h2>Recent audit trail</h2></div><History aria-hidden="true" /></div><div className="audit-list">{auditSeed.map((item) => <div className="audit-row" key={`${item.time}-${item.event}`}><span className="audit-line" /><div><strong>{item.event}</strong><p>{item.detail}</p></div><span><small>{item.actor}</small><time>{item.time}</time></span></div>)}</div></section>
    <section className="safety-section data-boundary"><LockKeyhole aria-hidden="true" /><div><span className="eyebrow">Data boundary</span><h2>Review data stays controlled.</h2><p>This visual milestone uses seeded cases only. The production contract will require authenticated admin roles, RLS-protected case access, explicit audit records and no service-role key in the browser.</p></div><button className="small-secondary" type="button" onClick={() => onAction('security', 'Security contract opened')}>View contract</button></section>
  </>;
}

export default function SafetyPreview({ onPreviewAction }) {
  const [tab, setTab] = useState('overview');
  const [reports, setReports] = useState(reportSeed);
  const [appeals, setAppeals] = useState(appealSeed);
  const [selectedReportId, setSelectedReportId] = useState(reportSeed[0].id);
  const [reportFilter, setReportFilter] = useState('All');
  const [reportOpen, setReportOpen] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
    onPreviewAction?.(message);
  };

  const handleReport = ({ reason }) => {
    const newReport = { id: `report-preview-${reports.length + 1}`, status: 'Needs review', category: reason.replace(' or personal information', '').replace(' or manipulation', ''), priority: 'Medium', reporter: '@yourhandle', target: '@reported-member', surface: 'Preview report flow', age: 'now', excerpt: 'A new local report submitted from the member safety flow. No report was sent to a server.' };
    setReports((current) => [newReport, ...current]);
    setSelectedReportId(newReport.id);
    setReportOpen(false);
    setTab('reports');
    showToast('Report saved to this preview only.');
  };

  const handleAction = (id, action) => {
    if (id.startsWith('appeal-')) {
      setAppeals((current) => current.map((appeal) => appeal.id === id ? { ...appeal, status: 'Decided', sla: 'Closed' } : appeal));
    } else if (id.startsWith('report-')) {
      setReports((current) => current.map((report) => report.id === id ? { ...report, status: action === 'Escalated' ? 'Assigned' : 'Resolved' } : report));
    }
    showToast(`${action}. Audit entry simulated locally.`);
  };

  return <div className="safety-preview">
    <header className="safety-hero"><div><span className="eyebrow"><ShieldCheck aria-hidden="true" />Trust &amp; Safety · Preview 07</span><h1>Protect the conversation.</h1><p>A calm workspace for member reports, proportionate decisions and accountable review.</p></div><div className="safety-hero-actions"><SafetyBadge tone="neutral"><LockKeyhole aria-hidden="true" />Seeded simulation</SafetyBadge><button className="small-primary" type="button" onClick={() => setReportOpen(true)}><Flag aria-hidden="true" />Report something</button></div></header>
    <SafetyTabs tab={tab} onChange={setTab} />
    {tab === 'overview' ? <Overview onReport={() => setReportOpen(true)} onTab={setTab} /> : null}
    {tab === 'reports' ? <Reports reports={reports} selectedId={selectedReportId} onSelect={setSelectedReportId} onAction={handleAction} filter={reportFilter} onFilter={setReportFilter} /> : null}
    {tab === 'appeals' ? <Appeals appeals={appeals} onAction={handleAction} /> : null}
    {tab === 'admin' ? <AdminOperations onAction={handleAction} /> : null}
    {toast ? <div className="safety-local-toast" role="status" aria-live="polite"><CheckCircle2 aria-hidden="true" /><span>{toast}</span></div> : null}
    <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} onSubmit={handleReport} />
  </div>;
}
