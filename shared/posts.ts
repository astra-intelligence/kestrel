// Posts as the API carries them (SPEC §4): the row both clients read, the list row with its
// active send, and the bodies of the post routes. The Worker's routes produce these shapes
// and the editor consumes them; one definition, so neither can drift.

import type { PageMeta } from "./list";

export type PostStatus = "draft" | "scheduled" | "sent";

export interface Post {
  id: string;
  /**
   * The post's archive address, `<archive origin><base path>/<slug>` (SPEC §4). It can change
   * until it is reserved; see `archive_slug` on the post's own reads for the address it would
   * take now.
   */
  slug: string;
  /**
   * Whether the slug follows the subject: derived from it again on every draft save. False
   * once a slug is set by hand, and once it is reserved.
   */
  slug_auto: boolean;
  /**
   * Whether the slug is the post's permanent archive address: true from when a listed send
   * starts, or the post is added to the archive after its send (SPEC §4). A reserved slug
   * never changes, and stays the post's when it is made email only.
   */
  slug_reserved: boolean;
  /**
   * The post's unlisted link is `<app origin>/email/<unlisted_token>` (SPEC §5): made with the
   * post, never changed, and carried as "view in browser" by every test and send.
   */
  unlisted_token: string;
  subject: string;
  status: PostStatus;
  /**
   * The post's listing (SPEC §5): true when it is email only, mailed as usual but left out of
   * the archive index and the landing page, its archive address answering nothing; false,
   * the default, when it is listed in the archive. Not part of the frozen render, so it can
   * change in any state, a sent post's included (`PUT /api/posts/:id/listing`).
   */
  email_only: boolean;
  /** The current revision's id; the editor carries it on every save (optimistic concurrency). */
  current_revision: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * A post plus its active send, if any. `fire_at` is the send's fire time; `active_send_*`
 * identify it and carry its status, so a post whose send is in flight (`sending`) can be
 * told apart from one still merely `scheduled` even though the post's own status is
 * `scheduled` for both until the send completes (SPEC §6).
 */
export interface PostListItem extends Post {
  fire_at: number | null;
  active_send_id: string | null;
  active_send_status: "scheduled" | "sending" | null;
  /** The current revision's author ("Claude" surfaces as `service`; SPEC §4). */
  author: string | null;
}

/** GET /api/posts */
export interface PostListResponse {
  posts: PostListItem[];
  page: PageMeta;
  /**
   * Where this read stood among the changes to sends (`<seq>.<at>`, as on `GET /api/sends`), to
   * follow the listed posts' sends from with `GET /api/sends/feed`.
   */
  cursor: string;
}

/**
 * The archive address a post would take if it became public now: its slug, or the slug
 * numbered (`spring-update-2`) when another post already holds that address. Equal to
 * `post.slug` once the slug is reserved. The server works it out, so a client warns from it
 * rather than guessing (SPEC §4).
 */
export type ArchiveSlug = string;

/** GET /api/posts/:id: the post, its current text, and where its send stands. */
export interface PostResponse {
  post: Post;
  archive_slug: ArchiveSlug;
  markdown: string;
  /** Who wrote the current revision; the freshness poll names them. */
  author: string | null;
  /** The scheduled send that soft-locks this post, and when a template or identity change last re-made it. */
  scheduled: { id: string; fire_at: number; remade_at: number | null } | null;
  /** The send in flight: the editor redirects to the live watch. */
  sending: { id: string } | null;
  /** The send that sent it: the editor redirects to the record. */
  sent: { id: string } | null;
}

/**
 * What POST /api/posts and PUT /api/posts/:id accept: any subset of the fields, and the revision
 * the client loaded, which the server checks before it writes (optimistic concurrency). A PUT
 * must name it, here or as `If-Match`; a create has nothing to be based on.
 */
export interface PostEditBody {
  subject?: string;
  /** A slug set by hand; sending one turns `slug_auto` off. Refused beside `slug_auto: true`. */
  slug?: string;
  /**
   * Have the slug follow the subject (true) or keep it as it stands (false). Absent, a create
   * follows the subject unless it names a slug, and an edit keeps the post's mode.
   */
  slug_auto?: boolean;
  markdown?: string;
  base_revision?: string | null;
}

/** POST /api/posts and PUT /api/posts/:id: the post as saved, and the revision the save wrote. */
export interface PostSavedResponse {
  post: Post;
  archive_slug: ArchiveSlug;
  revision_id: string;
}

/** GET /api/posts/:id/preview: where the rendered page is, and whether it is a frozen send's copy. */
export interface PreviewResponse {
  url: string;
  subject: string;
  warnings: string[];
  frozen: boolean;
}

/** POST /api/posts/:id/test: one test delivery through the same render as a real send (I5). */
export interface TestSendResponse {
  sent: boolean;
  provider: string;
  to: string;
  subject: string;
  warnings: string[];
  frozen: boolean;
}

/** The 428 a save gets when it names no base revision: the post as it stands, to read and save against. */
export interface BaseRequiredError {
  error: "base_required";
  message: string;
  /** The request field to add, as every refusal about the request names it (docs/API.md). */
  field: "base_revision";
  post: Post;
}

/** The 409 a save gets when its base revision is no longer the newest. */
export interface StaleRevisionError {
  error: "stale_revision";
  message: string;
  current_revision: string | null;
  updated_at: number;
  author: string | null;
}

/**
 * What PUT /api/posts/:id/listing takes: the post's publishing options (SPEC §4, §5), any
 * subset of them. Neither is part of the frozen email, so both can change while the post is
 * scheduled or once it is sent; the slug only until it is reserved.
 */
export interface ListingBody {
  email_only?: boolean;
  /** An archive address set by hand, as for a save; turns `slug_auto` off. */
  slug?: string;
  /** Have the slug follow the subject again (true), or keep it as it stands (false). */
  slug_auto?: boolean;
}

/** PUT /api/posts/:id/listing: the post as it now stands, and whether the act changed it. */
export interface ListingResponse {
  post: Post;
  archive_slug: ArchiveSlug;
  /** False when the post was already listed as asked: nothing was written. */
  changed: boolean;
}
