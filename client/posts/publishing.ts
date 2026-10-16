// A post's publishing settings as every surface words and edits them (SPEC §4, §5): whether it
// is included in the archive, and its archive address. The editor's Post settings dialog and
// the Schedule and Send now dialogs edit a working copy through the same form, which reaches
// the post only when the publisher presses Save, Schedule, or Send now; the sent page's Add to
// archive dialog shares the address field. One module, so the choice reads the same
// everywhere (DESIGN §3).

import type { ListingBody, Post } from "../../shared/posts";
import { slugify } from "../../shared/slug";
import { postArchiveUrl } from "../deployment";
import { type Html, html, setHtml } from "../ui/html";

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
    ? html`Will be sent as email only.`
    : html`Will be in your archive at <code>${archiveBase()}${p.slug}</code>`;
}

/** How the Schedule and Send now dialogs' first line ends, in the future tense: a full
 *  sentence of its own, so the default is stated rather than implied. */
export function willAppearClause(emailOnly: boolean): string {
  return emailOnly ? " It will be sent as email only." : " It will be in your archive.";
}

/** The helper under Include in archive, in every dialog that shows the box. */
const INCLUDE_HELP =
  "Listed on your home page and in your public archive. Unchecked, it’s sent as email only: anyone with the email can still open its web version.";

/**
 * The address a working copy will have: the server's answer while the slug is the one it
 * checked (numbered past one another post holds), else the typed slug as the server will make
 * it, whose number, if any, comes when it is saved.
 */
function effectiveSlug(p: Publishing): string {
  if (p.slug === p.checkedSlug) {
    return p.archiveSlug;
  }
  return slugify(p.slug) || p.checkedSlug;
}

/** What the read-only address says under it: why it is numbered, that it is permanent, or that
 *  a slug typed since is checked when it is saved. */
function addressNoteHtml(p: Publishing, reservedNote: string): Html | null {
  if (p.reserved) {
    return html`<p class="pub-note">${reservedNote}</p>`;
  }
  if (p.slug !== p.checkedSlug) {
    return html`<p class="pub-note">Checked against your other posts when it’s saved.</p>`;
  }
  return p.archiveSlug !== p.slug
    ? html`<p class="pub-taken">Another post has <code>${p.slug}</code>, so this one gets a number.</p>`
    : null;
}

/** What a reserved address says under it, unless a surface says otherwise. */
const RESERVED_NOTE = "Permanent: this address has been public, so it can’t change.";

/** How a settings form is drawn: with or without the Include in archive box (Add to archive is
 *  itself that choice), and the words under a reserved address. */
export interface SettingsFormOptions {
  include?: boolean;
  reservedNote?: string;
  /** Called after each change to the working copy, for a line that says where it will go. */
  onChange?: () => void;
}

/**
 * The settings as a form over `p` (DESIGN §3): Include in archive and, while it is checked, the
 * address the post will have, read-only, with Auto-generate slug from subject; unchecking that
 * shows the Slug to type. `prefix` names the inputs (`<prefix>Include`, `<prefix>Auto`,
 * `<prefix>Slug`) and the address (`<prefix>Address`), so two forms never share an id.
 */
export function settingsFormHtml(
  p: Publishing,
  prefix: string,
  { include = true, reservedNote = RESERVED_NOTE }: SettingsFormOptions = {},
): Html {
  const box = include
    ? html`<label class="listing-check"><input type="checkbox" id="${prefix}Include"${p.emailOnly ? null : html` checked`}><span><strong>Include in archive</strong><span class="listing-help">${INCLUDE_HELP}</span></span></label>`
    : null;
  if (p.emailOnly) {
    return html`${box}`;
  }
  const slugControls = p.reserved
    ? null
    : html`<label class="slug-auto-toggle"><input type="checkbox" id="${prefix}Auto"${p.slugAuto ? html` checked` : null}>Auto-generate slug from subject</label>${
        p.slugAuto
          ? null
          : html`<label for="${prefix}Slug">Slug</label><input type="text" id="${prefix}Slug" class="slug-input" value="${p.slug}" spellcheck="false" autocomplete="off">`
      }`;
  return html`${box}<div class="pub-address"><span class="pub-label">${p.reserved ? "Archive address" : "Future archive address"}</span><div class="url-readonly" id="${prefix}Address">${archiveBase()}<strong>${effectiveSlug(p)}</strong></div><div id="${prefix}Note">${addressNoteHtml(p, reservedNote)}</div>${slugControls}</div>`;
}

/**
 * Wire a form `settingsFormHtml` drew inside `root` to the working copy `p`. `repaint` redraws
 * the form, for a change that shows or hides a part of it; typing a slug only updates the
 * address it previews, so the field keeps its cursor.
 */
export function wireSettingsForm(
  root: Element,
  p: Publishing,
  prefix: string,
  repaint: () => void,
  { reservedNote = RESERVED_NOTE, onChange }: SettingsFormOptions = {},
): void {
  const include = root.querySelector<HTMLInputElement>(`#${prefix}Include`);
  if (include) {
    include.onchange = () => {
      p.emailOnly = !include.checked;
      repaint();
      onChange?.();
    };
  }
  const auto = root.querySelector<HTMLInputElement>(`#${prefix}Auto`);
  if (auto) {
    auto.onchange = () => {
      p.slugAuto = auto.checked;
      if (auto.checked) {
        p.slug = slugify(p.subject) || p.checkedSlug;
      }
      repaint();
      if (!auto.checked) {
        root.querySelector<HTMLInputElement>(`#${prefix}Slug`)?.focus();
      }
    };
  }
  const slug = root.querySelector<HTMLInputElement>(`#${prefix}Slug`);
  const address = root.querySelector<HTMLElement>(`#${prefix}Address`);
  const note = root.querySelector<HTMLElement>(`#${prefix}Note`);
  if (slug && address && note) {
    slug.oninput = () => {
      p.slug = slug.value;
      setHtml(address, html`${archiveBase()}<strong>${effectiveSlug(p)}</strong>`);
      setHtml(note, addressNoteHtml(p, reservedNote) ?? html``);
    };
  }
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
 * Draw the settings form into `el` over the working copy `p`, and keep it wired: each change
 * that shows or hides a part redraws it. For a dialog that holds the form beside other fields.
 */
export function mountSettingsForm(
  el: HTMLElement,
  p: Publishing,
  prefix: string,
  options: SettingsFormOptions = {},
): void {
  const paint = () => {
    setHtml(el, settingsFormHtml(p, prefix, options));
    wireSettingsForm(el, p, prefix, paint, options);
  };
  paint();
}
