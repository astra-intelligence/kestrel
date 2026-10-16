// A post's publishing settings as every surface words and edits them (SPEC §4, §5): whether it
// is included in the archive, and its archive address. The editor's Post settings dialog and
// the Schedule and Send now dialogs edit a working copy through the same form, which reaches
// the post only when the publisher presses Save, Schedule, or Send now; the sent page's Add to
// archive dialog shares the address field. One module, so the choice reads the same
// everywhere (DESIGN §3).

import type { ListingBody, Post } from "../../shared/posts";
import { slugify } from "../../shared/slug";
import { postArchiveUrl, postUnlistedUrl } from "../deployment";
import { type Html, html } from "../ui/html";
import { icon } from "../ui/icons";

/** An address as the app shows it: without its scheme, which says nothing to a publisher. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/** The archive's base as the address field shows it before the slug (`host/archive/`). */
export function archiveBase(): string {
  const url = postArchiveUrl("");
  return url ? shortUrl(url) : "/archive/";
}

/**
 * A post's publishing settings, as stored or as a dialog's working copy. `archiveSlug` is the
 * server's answer for `checkedSlug`: the address that slug would take now, numbered past one
 * another post holds. A slug typed since has no answer yet, so it gets no warning.
 */
export interface Publishing {
  emailOnly: boolean;
  slug: string;
  slugAuto: boolean;
  reserved: boolean;
  subject: string;
  archiveSlug: string;
  checkedSlug: string;
}

/** A post's settings as the server answered them. */
export function publishingOf(post: Post, archiveSlug: string): Publishing {
  return {
    emailOnly: post.email_only,
    slug: post.slug,
    slugAuto: post.slug_auto,
    reserved: post.slug_reserved,
    subject: post.subject,
    archiveSlug,
    checkedSlug: post.slug,
  };
}

/**
 * Where a scheduled post is going, in the future tense, for the line under its locked
 * subject: its archive address, or that it will be sent as email only.
 */
export function destinationHtml(p: Publishing): Html {
  return p.emailOnly
    ? html`Will be sent as email only, not in your archive.`
    : html`Will be in your archive at <code>${archiveBase()}${p.slug}</code>`;
}

/** How the Schedule and Send now dialogs' first line ends, in the future tense: a full
 *  sentence of its own, so the default is stated rather than implied. */
export function willAppearClause(emailOnly: boolean): string {
  return emailOnly
    ? " It will be sent as email only, not in your archive."
    : " It will be in your archive.";
}

/**
 * The archive address as a URL field: the base, then the slug. `id` names the input, so a
 * surface can read it back. `readonly` is for a reserved address, which can no longer change.
 */
export function addressFieldHtml(
  slug: string,
  { id, readonly = false }: { id?: string; readonly?: boolean } = {},
): Html {
  return html`<div class="url-field${readonly ? " readonly" : ""}"><span class="url-base">${archiveBase()}</span><input type="text"${id ? html` id="${id}"` : null} value="${slug}" spellcheck="false" autocomplete="off" aria-label="Archive address"${readonly ? html` readonly` : null}></div>`;
}

/**
 * The warning beside an address another post already holds: the server numbers it when it is
 * reserved, and `archiveSlug` (from the post's read) is what it will take. Null while the
 * address is free.
 */
export function takenNoteHtml(slug: string, archiveSlug: string): Html | null {
  return archiveSlug !== slug
    ? html`<p class="pub-taken">Another post has this address, so this one will be <code>${archiveSlug}</code>.</p>`
    : null;
}

/** The helper under Include in archive, in every dialog that shows the box. */
const INCLUDE_HELP =
  "Listed on your home page and in your public archive, at the address below. Unchecked, it’s sent as email only: anyone with the email can still open its web version.";

/**
 * The two settings as a form over `p`: Include in archive and, while it is checked, the archive
 * address with Auto-generate from subject. `prefix` names the inputs (`<prefix>Include`,
 * `<prefix>Slug`, `<prefix>Auto`), so two forms on one page never share an id.
 */
export function settingsFormHtml(p: Publishing, prefix: string): Html {
  const address = p.emailOnly
    ? null
    : html`<label for="${prefix}Slug">Archive address</label>${addressFieldHtml(p.slug, {
        id: `${prefix}Slug`,
        readonly: p.reserved,
      })}${
        p.reserved
          ? html`<p class="pub-note">Permanent: this address has been public, so it can’t change.</p>`
          : html`<label class="slug-auto-toggle"><input type="checkbox" id="${prefix}Auto"${p.slugAuto ? html` checked` : null}>Auto-generate from subject</label>`
      }<div id="${prefix}Taken">${p.slug === p.checkedSlug ? takenNoteHtml(p.slug, p.archiveSlug) : null}</div>`;
  return html`<label class="listing-check"><input type="checkbox" id="${prefix}Include"${p.emailOnly ? null : html` checked`}><span><strong>Include in archive</strong><span class="listing-help">${INCLUDE_HELP}</span></span></label>${address}`;
}

/**
 * Wire a form `settingsFormHtml` drew inside `root` to the working copy `p`. `repaint` redraws
 * the form, for a change that shows or hides the address. Typing an address takes it by hand;
 * ticking Auto-generate hands it back to the subject.
 */
export function wireSettingsForm(
  root: Element,
  p: Publishing,
  prefix: string,
  repaint: () => void,
): void {
  const include = root.querySelector<HTMLInputElement>(`#${prefix}Include`);
  if (include) {
    include.onchange = () => {
      p.emailOnly = !include.checked;
      repaint();
    };
  }
  const slug = root.querySelector<HTMLInputElement>(`#${prefix}Slug`);
  const auto = root.querySelector<HTMLInputElement>(`#${prefix}Auto`);
  const taken = root.querySelector<HTMLElement>(`#${prefix}Taken`);
  if (!slug || !auto || p.reserved) {
    return;
  }
  slug.oninput = () => {
    p.slug = slug.value;
    p.slugAuto = false;
    auto.checked = false;
    taken?.replaceChildren(); // the server hasn't checked this one yet
  };
  auto.onchange = () => {
    p.slugAuto = auto.checked;
    if (auto.checked) {
      p.slug = slugify(p.subject) || p.checkedSlug;
    }
    repaint();
  };
}

/**
 * What a working copy changes about the stored settings, as `PUT /api/posts/:id/listing` takes
 * it, or null when it changes nothing. A reserved address never changes, and an empty one hands
 * the address back to the subject.
 */
export function settingsChange(saved: Publishing, working: Publishing): ListingBody | null {
  const body: ListingBody = {};
  if (working.emailOnly !== saved.emailOnly) {
    body.email_only = working.emailOnly;
  }
  if (!saved.reserved && !working.emailOnly) {
    const auto = working.slugAuto || working.slug.trim() === "";
    if (auto && !saved.slugAuto) {
      body.slug_auto = true;
    } else if (!auto && (working.slug !== saved.slug || saved.slugAuto)) {
      body.slug = working.slug;
    }
  }
  return Object.keys(body).length ? body : null;
}

/**
 * Where the post will go, as the Schedule and Send now dialogs say it, with the Change… that
 * opens the settings in place: its archive address (and the number it will take, when another
 * post holds it), or its unlisted link while it is email only.
 */
export function whereHtml(p: Publishing, token: string, changeId: string): Html {
  const unlisted = postUnlistedUrl(token);
  const what = p.emailOnly
    ? html`<span class="where-text where-link">${icon("link")}<span>Email only. Its web version is at <code>${unlisted ? shortUrl(unlisted) : `/email/${token}`}</code>, for anyone with the email.</span></span>`
    : html`<span class="where-text">In your archive at <code>${archiveBase()}${p.slug}</code>${
        p.slug === p.checkedSlug && p.archiveSlug !== p.slug
          ? html` <span class="pub-taken">(will be <code>${p.archiveSlug}</code>)</span>`
          : null
      }</span>`;
  return html`<div class="where">${what}<button type="button" class="linkbtn where-change" id="${changeId}">Change…</button></div>`;
}
