// A post's publishing options as every surface words them (SPEC §4, §5): the future-tense
// line saying where a post will appear, the archive address field (editable in the editor's
// Publishing options and the Add to archive dialog, read-only in the Schedule dialog), the
// warning that an address will be numbered, and the unlisted link's line. The editor, the
// Schedule and Send now dialogs, and the sent post's page all build from these, so the same
// choice reads the same everywhere (DESIGN §3).

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
 * The editor's one line under Subject, in the future tense: where the post will appear once
 * it is sent. Email only says so; a listed post names the address it will have.
 */
export function willAppearHtml(emailOnly: boolean, slug: string): Html {
  return emailOnly
    ? html`Will be sent as email only, not listed in your archive.`
    : html`Will be listed in your archive at <code>${archiveBase()}${slug}</code>`;
}

/** How the Schedule and Send now dialogs' first line ends, in the future tense: a full
 *  sentence of its own, so the default is stated rather than implied by an unchecked box. */
export function willAppearClause(emailOnly: boolean): string {
  return emailOnly
    ? ". It will be sent as email only, not listed in your archive."
    : ". It will be listed in your archive.";
}

/**
 * The archive address as a URL field: the base, then the slug. `id` names the input, so a
 * surface can read it back. `readonly` is for a dialog that shows the address the editor set,
 * and for a reserved address, which can no longer change.
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

/** The unlisted link's line, where an email-only post shows the address its email carries. */
export function unlistedLineHtml(token: string): Html {
  const url = postUnlistedUrl(token);
  return html`<div class="unlisted-line">${icon("link")}<span class="unlisted-text"><code>${url ? shortUrl(url) : `/email/${token}`}</code> · anyone with the email can open it.</span></div>`;
}
