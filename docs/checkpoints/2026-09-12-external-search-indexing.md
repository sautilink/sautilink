# External Search Indexing — 2026-09-12

## Goal

Make explicitly opted-in public SautiLink profiles and public posts discoverable by search engines and AI/web crawlers without reopening member-only social tables to anonymous reads.

## Eligibility contract

A profile may be externally indexed only when all of the following are true:

- `social_profiles.is_discoverable = true`
- `social_profiles.allow_external_indexing = true`
- there is no pending account-deletion request

A post may be externally indexed only when all of the following are true:

- the post is `public`
- it is not a Sautify/circle post
- it is published, not deleted and moderation state is `visible`
- the author satisfies the profile indexing contract
- the thread audience owner also satisfies the profile indexing contract

Followers-only posts, Sautify posts, moderated posts, deleted posts, hidden profiles and public profiles that opted out of indexing are excluded.

## Database boundary

Anonymous SELECT access to `social_posts` remains revoked. This change adds narrow `SECURITY DEFINER` read-only RPC projections instead of broadening table RLS/grants:

- `external_index_profile_v1`
- `external_index_post_v1`
- `external_index_sitemap_counts_v1`
- `external_index_profiles_page_v1`
- `external_index_posts_page_v1`

The RPCs use an empty search path and fully-qualified relations.

## Public URLs and metadata

Canonical URLs remain clean and stable:

- profile: `https://sautilink.com/u/<username>`
- post: `https://sautilink.com/post/<uuid>`

Eligible pages receive server-generated title, description, canonical, Open Graph, Twitter metadata, Schema.org JSON-LD and `X-Robots-Tag: index, follow` directives. Verified profiles receive explicit verified/official wording and structured verification signals. Search engines remain authoritative for final ranking; SautiLink does not claim it can force a verified profile into the first result.

Legacy `/app/u/...` and `/app/sauti/...` routes remain usable by the app but are `noindex` to prevent duplicate canonical URLs.

## Sitemap discovery

The root `sitemap.xml` becomes a sitemap index containing:

- `sitemap-static.xml` for existing public site pages
- `/api/public-index/sitemap.xml` for dynamic profile/post sitemap pages

Dynamic sitemap rows are generated from the same privacy predicates used by public SEO pages. Verified profiles/authors are ordered first in the database projection, while external search ranking remains outside SautiLink control.

`robots.txt` allows normal public crawling, explicitly allows public profile media and public indexing sitemap endpoints, and blocks the rest of `/api/`.

## Staging

`test.sautilink.com` remains globally `noindex, nofollow, noarchive`; its robots response disallows crawling and the indexing handler never publishes production index metadata there.

## Rollback

1. Revert the Worker indexing files, root sitemap index and robots file.
2. Restore the previous `sitemap.xml` URL set if needed.
3. Drop the five `external_index_*_v1` RPCs in a follow-up migration.

Base social table grants and existing RLS policies do not need rollback because this change does not loosen them.
