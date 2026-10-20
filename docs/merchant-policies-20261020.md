# Public Merchant Policies

`/merchant-policies` is an English public document served by the existing root
static asset Worker, alongside Terms and Privacy. It uses the shared Inter
brand, light/dark theme, accessible document navigation and animated public
icons. Its only new stylesheet is scoped to `.merchant-policy-page`.

The policy records the product owner's Marketplace rules: app-only access;
business verification with mandatory TIN, optional VAT, applicable evidence,
document review and a business-site visit; a special merchant checkmark and
platform certificate; and the normal blue-tick route for small/startup
entrepreneurs without their own office. All SautiLink services are free, and
Marketplace listings are separate from an advertising service, which SautiLink
does not currently offer. Verification never replaces legal trading obligations.

Terms and Help reconcile the old future-paid-feature copy with these rules.
Privacy explains business-verification evidence and site-visit findings. Existing
public Legal directories and the static sitemap expose the policy. No merchant
application form, new selling capability, backend, API, account route, app UI or
deployment configuration is introduced.

Validation: the canonical `npm run check` passes all 1,044 tests without failures
or skips. Browser review covers desktop, 390px and 320px layouts, light/dark
themes, mobile contents disclosure, target focus, local icons and assets.
Screenshots and release receipts belong in
`outputs/SautiLink-Merchant-Policies-20261020` outside the repository.

Release through an exact-head reviewed PR and existing Git-linked pipelines.
Verify the root `Workers Builds: sautilink` check for the merged source SHA;
social Worker deployment success alone does not establish that public static
documents are live. Compare production HTML and the new stylesheet with the
reviewed files, and smoke-check the unchanged app routes and health endpoint.
