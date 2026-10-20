// A post's history (SPEC §6, §11; DESIGN §3): the drawer the editor's History button opens,
// listing every revision and every recorded act on the post's sends, newest first, with who
// acted. Read-only. On a wide screen it opens at the right beside the page, which stays usable
// (the banner's Cancel included); on a narrow one it opens from the bottom, over the page.

import type { HistoryEntry, Post, PostHistoryResponse } from "../../shared/posts";
import type { Actor } from "../../shared/who_acted";
import { api, describeError } from "../api";
import { agoStr, fmt } from "../ui/format";
import { type Html, html, setHtml } from "../ui/html";
import { type IconName, icon } from "../ui/icons";
import { actorLabel, isYouInEditor, whoActed } from "../who_acted";

/** One row of the drawer: an entry, or a run of edits by one actor folded into one. */
export interface HistoryRow {
  what: string;
  who: string;
  at: number;
  icon: IconName;
  /** A schedule act, in the banner's violet, or an edit, in grey. */
  tone: "send" | "edit";
}

const RESOLUTION_WORDS = { unsent: "assumed not sent", accepted: "assumed sent" } as const;

function what(e: HistoryEntry): string {
  switch (e.kind) {
    case "created":
      return "Created";
    case "edited":
      return `Edited · version ${e.revision}`;
    case "scheduled":
      return `Scheduled for ${fmt(e.fire_at)}`;
    case "sent_now":
      return `Send now, for ${fmt(e.fire_at)}`;
    case "rescheduled":
      return `Rescheduled for ${fmt(e.fire_at)}`;
    case "canceled":
      return "Canceled the schedule";
    case "resolved":
      return `Resolved: ${e.resolution ? RESOLUTION_WORDS[e.resolution] : "settled"}`;
  }
}

const ICON: Record<HistoryEntry["kind"], IconName> = {
  created: "plus",
  edited: "editable",
  scheduled: "calendar",
  sent_now: "send",
  rescheduled: "calendar",
  canceled: "calendar-x",
  resolved: "circle-check",
};

const sameActor = (a: Actor | null, b: Actor | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The drawer's rows, newest first: each act on a send on its own, and a run of consecutive
 * edits by one actor folded into one row ("Edited · versions 3–9"), since every save is a
 * revision and a session of editing would otherwise fill the list.
 */
export function historyRows(entries: HistoryEntry[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  let run: { first: HistoryEntry; last: HistoryEntry } | null = null;
  const flush = () => {
    if (run) {
      const { first, last } = run;
      const span =
        first === last
          ? `Edited · version ${first.revision}`
          : `Edited · versions ${last.revision}–${first.revision}`;
      rows.push({
        what: span,
        who: actorLabel0(first.actor),
        at: first.at,
        icon: "editable",
        tone: "edit",
      });
      run = null;
    }
  };
  for (const e of entries) {
    if (e.kind === "edited") {
      if (run && sameActor(run.last.actor, e.actor)) {
        run.last = e;
        continue;
      }
      flush();
      run = { first: e, last: e };
      continue;
    }
    flush();
    rows.push({
      what: what(e),
      who: actorLabel0(e.actor),
      at: e.at,
      icon: ICON[e.kind],
      tone: e.kind === "created" ? "edit" : "send",
    });
  }
  flush();
  return rows;
}

const actorLabel0 = (a: Actor | null) => (a ? actorLabel(a) : "No one recorded");

/**
 * The History button's words on a draft (DESIGN §3): "History" while the last edit was yours in
 * the editor, and who made it otherwise ("Last edit by you@example.com via Claude Code · 2 min
 * ago"), by the same rule as the scheduled banner's who-acted line.
 */
export function historyButtonLabel(
  post: Pick<Post, "author" | "author_client" | "authored_at">,
  you: Actor | null,
): string {
  if (post.author === null) {
    return "History";
  }
  const actor: Actor =
    post.author === "service"
      ? { kind: "service", client: null }
      : { kind: "human", email: post.author, client: post.author_client };
  if (isYouInEditor(actor, you)) {
    return "History";
  }
  const who = `Last edit by ${whoActed(post.author, post.author_client)}`;
  return post.authored_at === null ? who : `${who} · ${agoStr(post.authored_at)}`;
}

function rowsHtml(body: PostHistoryResponse): Html {
  const rows = historyRows(body.entries);
  return html`<ol class="history-list">${rows.map(
    (r) =>
      html`<li class="history-row history-${r.tone}"><span class="history-icon">${icon(r.icon)}</span><div class="history-text"><span class="history-what">${r.what}</span><span class="history-who">${r.who} · ${agoStr(r.at)}</span></div></li>`,
  )}</ol>${body.incomplete ? html`<p class="history-foot">Earlier changes to this post's sends weren't recorded.</p>` : null}`;
}

/**
 * Open the post's history, or close it when it is already open: a drawer beside the page on a
 * wide screen, a sheet over it on a narrow one. It closes with its × button, Escape, a second
 * press of `opener`, the backdrop on a narrow screen, or when the view goes (`signal`), and
 * hands focus back to `opener`.
 */
export function toggleHistory(postId: string, opener: HTMLElement, signal: AbortSignal): void {
  const open = document.querySelector<HTMLElement>(".history-drawer");
  if (open) {
    open.dispatchEvent(new Event("history-close"));
    return;
  }
  const own = new AbortController();
  const stop = () => own.abort();
  signal.addEventListener("abort", stop, { once: true });

  const backdrop = document.createElement("div");
  backdrop.className = "history-backdrop";
  const drawer = document.createElement("aside");
  drawer.className = "history-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-labelledby", "historyTitle");
  drawer.tabIndex = -1;
  setHtml(
    drawer,
    html`<div class="history-head"><h2 id="historyTitle">History of this post</h2><button type="button" class="ghost history-close" aria-label="Close history">${icon("x")}</button></div><div class="history-body" id="historyBody"><p class="muted">Loading…</p></div>`,
  );
  document.body.append(backdrop, drawer);
  document.body.classList.add("history-open");
  opener.setAttribute("aria-expanded", "true");
  drawer.focus();

  const close = () => {
    if (own.signal.aborted) {
      return;
    }
    own.abort();
  };
  own.signal.addEventListener("abort", () => {
    signal.removeEventListener("abort", stop);
    drawer.remove();
    backdrop.remove();
    document.body.classList.remove("history-open");
    opener.setAttribute("aria-expanded", "false");
    if (!signal.aborted && opener.isConnected) {
      opener.focus();
    }
  });
  drawer.addEventListener("history-close", close, { signal: own.signal });
  backdrop.addEventListener("click", close, { signal: own.signal });
  drawer
    .querySelector<HTMLButtonElement>(".history-close")
    ?.addEventListener("click", close, { signal: own.signal });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        close();
      }
    },
    { signal: own.signal },
  );

  const body = drawer.querySelector<HTMLElement>("#historyBody");
  api<PostHistoryResponse>(`/api/posts/${postId}/history`, { signal: own.signal })
    .then((res) => {
      if (body && !own.signal.aborted) {
        setHtml(body, rowsHtml(res));
      }
    })
    .catch((err: unknown) => {
      if (body && !own.signal.aborted) {
        setHtml(body, html`<p class="error">${describeError(err)}</p>`);
      }
    });
}
