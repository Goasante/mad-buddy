# Mad Buddy Journal

Public `/blog` and `/blog/[slug]`; owner-only `/admin/blog`.

## Editorial approach

Each article identifies a reader, a question they search for, and one relevant
product feature. Useful advice comes first; an app invitation closes the article.
No keyword stuffing, invented venues, guaranteed matches, or ranking promises.

## Publishing

Admin → Journal → New article → Save draft → Preview → Publish.
Edits are working drafts until Publish update. Shareable slugs are fixed after
the first save. Unpublish keeps the draft and revision history; no delete action
is provided. The editor shows unsaved changes and does not silently autosave.
Use blank paragraphs, `## Section headings`, and `- Bullet items`.
HTML, scripts, video embeds, and arbitrary authored links are deliberately
unsupported. Calls to action use the canonical feature
catalogue and public signup, safety, and privacy routes.

Saved versions can be loaded into the working editor (last 30 revisions).
Loading is not publishing. Stale editors are rejected via optimistic version
checks and row locking. Privileged actions require an audit event before mutation.

## Security and search

Both tables have RLS and no anon/authenticated grants or policies. Only the
server service role can read/write them. Every authoring page/action checks the
existing canonical owner role. Public readers receive only published snapshots,
never drafts or saved versions. Public article HTML is server-rendered with
canonical metadata, Open Graph article dates, nonce-bearing escaped BlogPosting
JSON-LD, and headings. Sitemap includes only live articles. No login is needed
for public articles, and signed-in visitors can read them too.

Publishing is manual: no scheduling or autosave.
It adds no packages and changes no social-product workflows or access rules.

## Lightweight images

Add cover image supplies both the article hero/card and social sharing metadata.
Insert image places an opaque `[[image:UUID]]` marker at the text cursor and
registers the asset in the article. Image descriptions are required to publish;
captions/photo credits are optional. A cover and up to eight inline assets are
supported. Removing an image removes its attachment/marker, not historical files.

Sources: JPEG, PNG, or WebP up to 5 MiB and 24 million pixels. Still images only.
Phone orientation is baked in, metadata/GPS removed, PNG transparency flattened
onto white, and dimensions capped at 1600×1200 without enlargement. Progressive
quality/dimension reduction enforces at most 200 KiB per stored JPEG. Small
images are never padded. One JPEG serves the article and social preview; no
full-size source or separate thumbnail is stored. Equal processed bytes share
one immutable storage object and registry entry.

The journal-images bucket is private, JPEG-only, with a 200 KiB bucket limit.
The registry is RLS-locked, service-role-only. Uploads are owner-authorized,
rate-limited, audited, decoded/re-encoded, and verified after storage. No remote
URL fetch is supported. Public media endpoints serve only assets referenced by
the current published snapshot; drafts/revisions require an owner session and
no-store caching. Public images cache for five minutes (a previously public
image can remain cached that long after unpublishing). Inline images lazy-load
with explicit dimensions; the cover loads eagerly. Historical and abandoned
uploads remain private for reuse/restoration rather than deleting unique work.

## Release verification

The additive `editorial_blog` migration was tested on staging before production.
Rolled-back database transaction proofs verified private grants, draft/live
separation, publication, stale version rejection, revision preservation, and
unpublishing. Both roles are denied direct article reads and RPC execution.
Security advisors report only the expected informational no-policy notices for
these service-only tables; no new blog warning was reported.
The seed in `scripts/blog/starter-articles.sql` is insert-only and conflict-safe:
one finished Accra guide is live; four editorial outlines remain private drafts.
