-- 0008_unlisted_links: every post gets its own unlisted link, and a post's archive address
-- is reserved only once it has been public (SPEC §4, §5).
--
-- Every email's "view in browser" link used to be the post's archive address,
-- `/archive/<slug>`. That made an email-only post's page guessable from its subject, made
-- every draft hold a unique slug because a test email already carried it, and tied every
-- email ever sent to the archive base path. Now each post has an unlisted link,
-- `/email/<token>` on the app's own origin, which every test and send carries instead, and
-- the archive address answers only while the post is listed.
--
-- posts.unlisted_token: about 128 bits of randomness, made with the post and never changed.
-- The column's default makes it, so every way a post is inserted gets one.
--
-- posts.slug_reserved: whether the slug is the post's permanent archive address. A slug is
-- reserved, and numbered if another post holds it, when a listed send starts or the post is
-- added to the archive after its send; until then it can change, and two drafts may want
-- the same one. Only reserved slugs are unique (`idx_posts_reserved_slug`), which is why the
-- table is rebuilt: the old column-level UNIQUE on every slug can't be dropped in place.
-- A reserved slug never follows the subject again, so slug_auto is off for each one.
--
-- An upgrade reserves the slug of every post whose send was scheduled or went out before
-- it: those emails carry `/archive/<slug>`, so that address must stay theirs. Every other
-- post, a draft or one whose sends were all canceled, keeps its slug unreserved.
--
-- sends.web_link: which address the send's email carries as its "view in browser" link,
-- `unlisted` from this release on, or `archive` for a send frozen before it. A post whose
-- published send carries `archive` keeps its archive address answering whatever its
-- listing, since every copy of that email links there. A re-make freezes a new copy, so it
-- moves a scheduled send to `unlisted`.
--
-- D1 enforces foreign keys, and post_revisions, images, and sends reference posts, so the
-- rebuild defers the check to the end of the migration. The rows go back into a table already
-- named `posts`, since only a row inserted under the name the foreign keys reference counts
-- as their parent again; a table renamed into place afterwards would leave every child row
-- counted as orphaned.

PRAGMA defer_foreign_keys = true;

CREATE TABLE posts_0008 AS SELECT * FROM posts;
DROP TABLE posts;

CREATE TABLE posts (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL,
  slug_auto        INTEGER NOT NULL DEFAULT 0 CHECK (slug_auto IN (0, 1)),
  slug_reserved    INTEGER NOT NULL DEFAULT 0 CHECK (slug_reserved IN (0, 1)),
  unlisted_token   TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  subject          TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'scheduled', 'sent')),
  email_only       INTEGER NOT NULL DEFAULT 0 CHECK (email_only IN (0, 1)),
  current_revision TEXT,                       -- -> post_revisions.id (nullable until first save)
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
) STRICT;

INSERT INTO posts (id, slug, slug_auto, slug_reserved, subject, status, email_only,
                   current_revision, created_at, updated_at)
SELECT id, slug, slug_auto,
       EXISTS (SELECT 1 FROM sends s
                WHERE s.post_id = posts_0008.id AND s.status IN ('scheduled', 'sending', 'sent')),
       subject, status, email_only, current_revision, created_at, updated_at
  FROM posts_0008;
UPDATE posts SET slug_auto = 0 WHERE slug_reserved = 1;
DROP TABLE posts_0008;

CREATE INDEX idx_posts_status ON posts (status);
CREATE INDEX idx_posts_updated ON posts (updated_at);   -- the post list's default sort
CREATE UNIQUE INDEX idx_posts_reserved_slug ON posts (slug) WHERE slug_reserved = 1;

ALTER TABLE sends ADD COLUMN web_link TEXT NOT NULL DEFAULT 'unlisted'
  CHECK (web_link IN ('unlisted', 'archive'));
UPDATE sends SET web_link = 'archive';
