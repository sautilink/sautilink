import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  MailCheck,
  ShieldCheck,
  UserRoundCheck,
  X,
} from 'lucide-react';
import {
  displayNameError,
  emailError,
  friendlyAuthError,
  normalizeEmail,
  normalizeUsername,
  passwordError,
  usernameError,
} from '../../src/auth-validation.js';
import { DEMO_CODE } from './demo-auth-service.js';

const previewStates = [
  ['login', 'Sign in'],
  ['signup', 'Create account'],
  ['verify', 'Verify'],
  ['recovery', 'Recovery'],
  ['password', 'New password'],
  ['onboarding', 'Onboarding'],
];

const seededPending = {
  email: 'member@sautilink.test',
  username: 'yourhandle',
  displayName: 'SautiLink Member',
};

const emptySignup = { username: '', displayName: '', email: '', password: '', confirm: '' };

function readableError(error) {
  return error?.code === 'VALIDATION_ERROR' ? error.message : friendlyAuthError(error);
}

function PasswordField({ id, label, value, onChange, autoComplete = 'current-password', placeholder = 'Your password' }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="identity-field" htmlFor={id}>
      <span>{label}</span>
      <span className="identity-input-with-action">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={autoComplete === 'new-password' ? 12 : undefined}
          maxLength={72}
          placeholder={placeholder}
          required
        />
        <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </span>
    </label>
  );
}

function SubmitButton({ busy, busyLabel, children }) {
  return (
    <button className="identity-submit" type="submit" disabled={busy} aria-busy={busy}>
      {busy ? <LoaderCircle className="identity-spinner" aria-hidden="true" /> : null}
      <span>{busy ? busyLabel : children}</span>
      {!busy ? <ArrowRight aria-hidden="true" /> : null}
    </button>
  );
}

function FormMessage({ message }) {
  if (!message?.text) return null;
  return <div className={`identity-message is-${message.type || 'error'}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div>;
}

export default function IdentityGate({ open, service, onClose, onAuthenticated }) {
  const [view, setView] = useState('login');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [login, setLogin] = useState({ email: '', password: '' });
  const [signup, setSignup] = useState(emptySignup);
  const [pending, setPending] = useState(seededPending);
  const [code, setCode] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [newPassword, setNewPassword] = useState({ password: '', confirm: '' });
  const [onboarding, setOnboarding] = useState({ username: 'yourhandle', displayName: 'SautiLink Member' });
  const [usernameState, setUsernameState] = useState({ kind: 'idle', text: '3–30 lowercase letters, numbers, dots or underscores.' });
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    window.setTimeout(() => dialogRef.current?.querySelector('input, button')?.focus(), 0);
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const moveTo = (next) => {
    setMessage(null);
    setBusy(false);
    if (next === 'verify' && !pending) setPending(seededPending);
    setView(next);
  };

  const run = async (action, busyLabel) => {
    setBusy(true);
    setMessage(null);
    try {
      return await action();
    } catch (error) {
      setMessage({ type: 'error', text: readableError(error) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const finish = (result) => {
    if (result?.member) onAuthenticated(result.member);
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    const issue = emailError(login.email) || (!login.password ? 'Enter your password.' : '');
    if (issue) return setMessage({ type: 'error', text: issue });
    finish(await run(() => service.signIn(login), 'Signing in…'));
  };

  const useDemoAccount = async () => {
    const credentials = { email: 'member@sautilink.test', password: 'Preview-Identity9!' };
    setLogin(credentials);
    finish(await run(() => service.signIn(credentials), 'Opening preview…'));
  };

  const handleSignup = async (event) => {
    event.preventDefault();
    const normalized = { ...signup, username: normalizeUsername(signup.username), email: normalizeEmail(signup.email), displayName: signup.displayName.trim() };
    const issue = usernameError(normalized.username)
      || displayNameError(normalized.displayName)
      || emailError(normalized.email)
      || passwordError(normalized.password, { username: normalized.username, email: normalized.email })
      || (normalized.confirm !== normalized.password ? 'Passwords do not match.' : '');
    if (issue) return setMessage({ type: 'error', text: issue });
    const result = await run(() => service.signUp(normalized), 'Creating account…');
    if (result?.status === 'verification-required') {
      setPending(result.pending);
      setCode('');
      moveTo('verify');
    } else finish(result);
  };

  const checkUsername = async () => {
    const username = normalizeUsername(signup.username);
    setSignup((current) => ({ ...current, username }));
    const issue = usernameError(username);
    if (issue) return setUsernameState({ kind: 'bad', text: issue });
    setUsernameState({ kind: 'checking', text: 'Checking availability…' });
    try {
      const result = await service.checkUsername(username);
      setUsernameState(result.available
        ? { kind: 'good', text: `@${result.username} is available.` }
        : { kind: 'bad', text: result.issue || `@${result.username} is already taken.` });
    } catch {
      setUsernameState({ kind: 'bad', text: 'Unable to check that username right now.' });
    }
  };

  const handleVerify = async (event) => {
    event.preventDefault();
    const result = await run(() => service.verifySignup({ pending, code }), 'Verifying…');
    finish(result);
  };

  const resendCode = async () => {
    const success = await run(() => service.resendSignup(pending.email), 'Sending code…');
    if (success !== null) setMessage({ type: 'success', text: `A new preview code was prepared. Use ${DEMO_CODE}.` });
  };

  const handleRecovery = async (event) => {
    event.preventDefault();
    const success = await run(() => service.recover(recoveryEmail), 'Sending link…');
    if (success !== null) setMessage({ type: 'success', text: 'If this email belongs to an account, a secure recovery link is on its way.' });
  };

  const handlePassword = async (event) => {
    event.preventDefault();
    const issue = passwordError(newPassword.password) || (newPassword.password !== newPassword.confirm ? 'Passwords do not match.' : '');
    if (issue) return setMessage({ type: 'error', text: issue });
    finish(await run(() => service.updatePassword(newPassword.password), 'Saving password…'));
  };

  const handleOnboarding = async (event) => {
    event.preventDefault();
    const clean = { username: normalizeUsername(onboarding.username), displayName: onboarding.displayName.trim() };
    const issue = usernameError(clean.username) || displayNameError(clean.displayName);
    if (issue) return setMessage({ type: 'error', text: issue });
    const member = await run(() => service.completeOnboarding(clean), 'Setting up profile…');
    if (member) onAuthenticated(member);
  };

  return (
    <div className="identity-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="identity-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="identity-title">
        <button className="identity-close" type="button" onClick={onClose} aria-label="Close identity preview"><X aria-hidden="true" /></button>

        <aside className="identity-story">
          <div className="identity-brand"><img src="/logo.png" alt="" width="46" height="46" /><strong>SautiLink</strong></div>
          <span className="identity-kicker">Identity milestone</span>
          <h1 id="identity-title">One account.<br />A voice that is yours.</h1>
          <p>Private account details stay separate from the public profile people discover across SautiLink.</p>
          <div className="identity-trust-list">
            <span><ShieldCheck aria-hidden="true" /><b>Verified email</b><small>Required before social onboarding</small></span>
            <span><LockKeyhole aria-hidden="true" /><b>Private by default</b><small>No production data in this preview</small></span>
            <span><UserRoundCheck aria-hidden="true" /><b>One public identity</b><small>Username claimed transactionally</small></span>
          </div>
          <div className="identity-preview-label"><i />Interactive preview · Nothing is submitted</div>
        </aside>

        <div className="identity-workspace">
          <header className="identity-mobile-brand"><img src="/logo.png" alt="" width="36" height="36" /><strong>SautiLink</strong></header>

          {view === 'login' ? (
            <section className="identity-panel">
              <div className="identity-heading"><span>Welcome back</span><h2>Sign in to SautiLink</h2><p>Continue to your Stream, Circles and private conversations.</p></div>
              <form onSubmit={handleLogin} noValidate>
                <label className="identity-field" htmlFor="identity-login-email"><span>Email address</span><input id="identity-login-email" type="email" inputMode="email" autoComplete="email" value={login.email} onChange={(event) => setLogin((current) => ({ ...current, email: event.target.value }))} placeholder="you@example.com" required /></label>
                <PasswordField id="identity-login-password" label="Password" value={login.password} onChange={(password) => setLogin((current) => ({ ...current, password }))} />
                <div className="identity-form-row"><span><ShieldCheck aria-hidden="true" />Secure browser session</span><button type="button" onClick={() => moveTo('recovery')}>Forgot password?</button></div>
                <FormMessage message={message} />
                <SubmitButton busy={busy} busyLabel="Signing in…">Sign in</SubmitButton>
                <button className="identity-demo-action" type="button" onClick={useDemoAccount} disabled={busy}>Use preview account</button>
              </form>
              <p className="identity-switch">New to SautiLink? <button type="button" onClick={() => moveTo('signup')}>Create an account</button></p>
            </section>
          ) : null}

          {view === 'signup' ? (
            <section className="identity-panel">
              <button className="identity-back" type="button" onClick={() => moveTo('login')}><ArrowLeft aria-hidden="true" />Sign in</button>
              <div className="identity-heading"><span>Claim your identity</span><h2>Create your account</h2><p>Your username belongs to one verified SautiLink identity.</p></div>
              <form onSubmit={handleSignup} noValidate>
                <label className="identity-field" htmlFor="identity-signup-username"><span>Username</span><span className="identity-username"><b>@</b><input id="identity-signup-username" type="text" autoComplete="username" autoCapitalize="none" spellCheck="false" maxLength="30" value={signup.username} onChange={(event) => { setSignup((current) => ({ ...current, username: normalizeUsername(event.target.value) })); setUsernameState({ kind: 'idle', text: '3–30 lowercase letters, numbers, dots or underscores.' }); }} onBlur={checkUsername} placeholder="yourname" required /></span><small className={`identity-hint is-${usernameState.kind}`}>{usernameState.text}</small></label>
                <label className="identity-field" htmlFor="identity-signup-name"><span>Display name</span><input id="identity-signup-name" type="text" autoComplete="name" maxLength="80" value={signup.displayName} onChange={(event) => setSignup((current) => ({ ...current, displayName: event.target.value }))} placeholder="How people will know you" required /></label>
                <label className="identity-field" htmlFor="identity-signup-email"><span>Email address</span><input id="identity-signup-email" type="email" inputMode="email" autoComplete="email" value={signup.email} onChange={(event) => setSignup((current) => ({ ...current, email: event.target.value }))} placeholder="you@example.com" required /></label>
                <PasswordField id="identity-signup-password" label="Password" value={signup.password} onChange={(password) => setSignup((current) => ({ ...current, password }))} autoComplete="new-password" placeholder="12+ strong characters" />
                <PasswordField id="identity-signup-confirm" label="Confirm password" value={signup.confirm} onChange={(confirm) => setSignup((current) => ({ ...current, confirm }))} autoComplete="new-password" placeholder="Repeat your password" />
                <FormMessage message={message} />
                <SubmitButton busy={busy} busyLabel="Creating account…">Create account</SubmitButton>
                <p className="identity-legal">By creating an account, you agree to the <a href="/terms">Terms</a> and acknowledge the <a href="/privacy">Privacy Policy</a>.</p>
              </form>
            </section>
          ) : null}

          {view === 'verify' ? (
            <section className="identity-panel identity-centered-panel">
              <span className="identity-state-icon"><MailCheck aria-hidden="true" /></span>
              <div className="identity-heading"><span>Check your inbox</span><h2>Verify your email</h2><p>Enter the code sent to <strong>{pending?.email || seededPending.email}</strong>.</p></div>
              <form onSubmit={handleVerify} noValidate>
                <label className="identity-field" htmlFor="identity-code"><span>Verification code</span><input className="identity-code" id="identity-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength="10" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" required /><small className="identity-hint is-good">Preview code: {DEMO_CODE}</small></label>
                <FormMessage message={message} />
                <SubmitButton busy={busy} busyLabel="Verifying…">Verify and continue</SubmitButton>
                <button className="identity-demo-action" type="button" onClick={resendCode} disabled={busy}>Resend code</button>
              </form>
              <button className="identity-bottom-back" type="button" onClick={() => moveTo('signup')}><ArrowLeft aria-hidden="true" />Change account details</button>
            </section>
          ) : null}

          {view === 'recovery' ? (
            <section className="identity-panel identity-centered-panel">
              <span className="identity-state-icon"><KeyRound aria-hidden="true" /></span>
              <div className="identity-heading"><span>Account recovery</span><h2>Reset your password</h2><p>We will prepare a secure recovery link without revealing whether an email is registered.</p></div>
              <form onSubmit={handleRecovery} noValidate>
                <label className="identity-field" htmlFor="identity-recovery-email"><span>Email address</span><input id="identity-recovery-email" type="email" inputMode="email" autoComplete="email" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} placeholder="you@example.com" required /></label>
                <FormMessage message={message} />
                <SubmitButton busy={busy} busyLabel="Sending link…">Send recovery link</SubmitButton>
                <button className="identity-demo-action" type="button" onClick={() => moveTo('password')}>Preview verified recovery</button>
              </form>
              <button className="identity-bottom-back" type="button" onClick={() => moveTo('login')}><ArrowLeft aria-hidden="true" />Back to sign in</button>
            </section>
          ) : null}

          {view === 'password' ? (
            <section className="identity-panel identity-centered-panel">
              <span className="identity-state-icon"><ShieldCheck aria-hidden="true" /></span>
              <div className="identity-heading"><span>Recovery verified</span><h2>Choose a new password</h2><p>Use a unique password that is not part of your username or email.</p></div>
              <form onSubmit={handlePassword} noValidate>
                <PasswordField id="identity-new-password" label="New password" value={newPassword.password} onChange={(password) => setNewPassword((current) => ({ ...current, password }))} autoComplete="new-password" placeholder="12+ strong characters" />
                <PasswordField id="identity-new-password-confirm" label="Confirm new password" value={newPassword.confirm} onChange={(confirm) => setNewPassword((current) => ({ ...current, confirm }))} autoComplete="new-password" placeholder="Repeat your password" />
                <FormMessage message={message} />
                <SubmitButton busy={busy} busyLabel="Saving password…">Save new password</SubmitButton>
              </form>
            </section>
          ) : null}

          {view === 'onboarding' ? (
            <section className="identity-panel identity-centered-panel">
              <span className="identity-state-icon"><UserRoundCheck aria-hidden="true" /></span>
              <div className="identity-heading"><span>One last step</span><h2>Set up your public identity</h2><p>Your verified account stays private. Confirm what other people can discover.</p></div>
              <form onSubmit={handleOnboarding} noValidate>
                <label className="identity-field" htmlFor="identity-onboarding-username"><span>Username</span><span className="identity-username"><b>@</b><input id="identity-onboarding-username" type="text" autoComplete="username" value={onboarding.username} onChange={(event) => setOnboarding((current) => ({ ...current, username: normalizeUsername(event.target.value) }))} required /></span></label>
                <label className="identity-field" htmlFor="identity-onboarding-name"><span>Display name</span><input id="identity-onboarding-name" type="text" autoComplete="name" value={onboarding.displayName} onChange={(event) => setOnboarding((current) => ({ ...current, displayName: event.target.value }))} required /></label>
                <div className="identity-boundary"><Check aria-hidden="true" /><span><strong>Public:</strong> username and display name</span><span><strong>Private:</strong> email and account preferences</span></div>
                <FormMessage message={message} />
                <SubmitButton busy={busy} busyLabel="Setting up profile…">Enter SautiLink</SubmitButton>
              </form>
            </section>
          ) : null}

          <footer className="identity-state-switcher" aria-label="Identity preview states">
            <span>Preview states</span>
            <div>{previewStates.map(([id, label]) => <button className={view === id ? 'is-active' : ''} type="button" key={id} onClick={() => moveTo(id)}>{label}</button>)}</div>
          </footer>
        </div>
      </section>
    </div>
  );
}
