import { useMemo, useState } from 'react';
import { LogIn, LogOut, ShieldCheck } from 'lucide-react';
import App from '../app-shell/App.jsx';
import IdentityGate from './IdentityGate.jsx';
import { createDemoAuthService } from './demo-auth-service.js';

export default function IdentityPreview() {
  const service = useMemo(() => createDemoAuthService(), []);
  const [member, setMember] = useState(null);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [gateVersion, setGateVersion] = useState(0);

  const authenticate = (profile) => {
    setMember(profile);
    setOpen(false);
    setGateVersion((current) => current + 1);
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await service.signOut();
      setMember(null);
      setGateVersion((current) => current + 1);
      setOpen(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="identity-preview-root">
      <div className="identity-shell-background" inert={open ? true : undefined} aria-hidden={open ? 'true' : undefined}>
        <App />
      </div>

      {!open ? (
        <aside className="identity-session-controller" aria-label="Identity preview session">
          <span className="identity-session-icon"><ShieldCheck aria-hidden="true" /></span>
          <span><small>Identity preview</small><strong>{member ? `${member.name} · ${member.handle}` : 'Signed out'}</strong></span>
          <button type="button" onClick={() => setOpen(true)}><LogIn aria-hidden="true" />View identity</button>
          {member ? <button type="button" onClick={signOut} disabled={busy}><LogOut aria-hidden="true" />{busy ? 'Signing out…' : 'Sign out'}</button> : null}
        </aside>
      ) : null}

      <IdentityGate key={gateVersion} open={open} service={service} onClose={() => setOpen(false)} onAuthenticated={authenticate} />
    </div>
  );
}
