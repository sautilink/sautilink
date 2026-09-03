# Settings, Privacy & Account Controls preview

**Status:** Phase 10 seeded web preview

This phase makes the privacy-first promise visible and controllable before the
real account backend is connected.

## Included

- Verified account identity and password-recovery entry point
- Active session review and sign-out-other-sessions interaction
- Discoverability, external indexing, message access, read receipt, and
  activity-status preferences
- Replies, Messages, follower, Circle, security, and email-summary preferences
- Private blocked and muted account lists
- Data export request state
- Protected delete-account confirmation

## Preview boundary

Every setting is held in local React state. The preview has no network request,
Supabase client, Worker API call, analytics event, or production identifier.
Session, export, password, and deletion actions are demonstrations only.

## Backend requirements

Before these controls become real, the backend must enforce recent
authentication for sensitive actions, owner-scoped row-level security,
auditable session revocation, idempotent export jobs, private notification
preferences, a documented retention policy, and a recoverable deletion window.

The frontend must never receive a Supabase service-role credential. Account
deletion and export orchestration must pass through authenticated server-side
boundaries with rate limits and abuse monitoring.

## Deferred

- Advertising or tracking preferences, because the MVP has neither
- Advanced recommendation tuning
- Enterprise session management
- Automatic cross-service data portability
