# Trust, Safety & Admin Operations Preview

Preview 07 is a seeded, network-disabled product contract for SautiLink moderation surfaces. It is intentionally separate from production authentication, Supabase, Workers, R2 and the public homepage.

## Included in the visual milestone

- Member report flow with reason, optional context, privacy notice and local confirmation.
- Reports queue with status filters, priority, context, reporter, target and review actions.
- Proportionate actions: dismiss with context, limit visibility and escalate.
- Appeals queue with review status, original action, member explanation and SLA state.
- Least-privilege admin workspaces for reviewer, senior reviewer and auditor roles.
- Audit trail and explicit data-boundary copy.
- Light/dark mode and mobile layout through the shared app shell.

## Production contract to validate later

The UI must not be treated as a moderation implementation. A later backend milestone needs authenticated admin roles in `raw_app_meta_data` or an equivalent server-owned authorization source, RLS-protected case access, bounded pagination, idempotent decisions, immutable audit records, private report identity and rate limits. The browser must never receive a Supabase service-role credential.

Recommended case fields include `report_id`, `reported_by`, `subject_type`, `subject_id`, `category`, `context_snapshot`, `status`, `priority`, `assigned_to`, `decision`, `decision_reason`, `created_at`, `updated_at` and `resolved_at`. Decisions should reference a policy version and be append-only in the audit stream.

No table, migration, Worker route, R2 object or production notification is created by this preview.
