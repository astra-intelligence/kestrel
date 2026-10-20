import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "../../shared/posts";
import type { Actor } from "../../shared/who_acted";
import { historyButtonLabel, historyRows } from "./history";

const NOW = new Date("2026-10-19T12:00:00Z").getTime();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const YOU: Actor = { kind: "human", email: "you@example.com", client: "editor" };
const CLAUDE: Actor = { ...YOU, client: "claude-code" };
const TOKEN: Actor = { kind: "service", token_id: "ci.access", client: null };

const entry = (over: Partial<HistoryEntry> & Pick<HistoryEntry, "kind">): HistoryEntry => ({
  at: NOW - 60_000,
  actor: YOU,
  revision: null,
  send_id: null,
  fire_at: null,
  resolution: null,
  ...over,
});

describe("historyRows (DESIGN §3)", () => {
  it("folds a run of edits by one actor into one row, newest version last in the range", () => {
    const rows = historyRows([
      entry({ kind: "edited", revision: 4, actor: CLAUDE }),
      entry({ kind: "edited", revision: 3, actor: CLAUDE }),
      entry({ kind: "edited", revision: 2, actor: YOU }),
      entry({ kind: "created", revision: 1 }),
    ]);
    expect(rows.map((r) => [r.what, r.who, r.tone])).toEqual([
      ["Edited · versions 3–4", "you@example.com via Claude Code", "edit"],
      ["Edited · version 2", "you@example.com", "edit"],
      ["Created", "you@example.com", "edit"],
    ]);
  });

  it("never folds edits across an act on a send", () => {
    const rows = historyRows([
      entry({ kind: "edited", revision: 3 }),
      entry({ kind: "canceled", send_id: "s1" }),
      entry({ kind: "edited", revision: 2 }),
    ]);
    expect(rows.map((r) => r.what)).toEqual([
      "Edited · version 3",
      "Canceled the schedule",
      "Edited · version 2",
    ]);
  });

  it("words each act on a send with who took it, and gives it the schedule's tone", () => {
    const rows = historyRows([
      entry({ kind: "resolved", actor: TOKEN, resolution: "unsent" }),
      entry({ kind: "sent_now", fire_at: NOW + 360_000 }),
      entry({ kind: "edited", revision: 2, actor: null }),
    ]);
    expect(rows.map((r) => [r.what.replace(/, for .*$/, ""), r.who, r.tone, r.icon])).toEqual([
      ["Resolved: assumed not sent", "the service token ci.access", "send", "circle-check"],
      ["Send now", "you@example.com", "send", "send"],
      ["Edited · version 2", "No one recorded", "edit", "editable"],
    ]);
  });
});

describe("historyButtonLabel (SPEC §11, DESIGN §3)", () => {
  const post = (author: string | null, author_client: string | null) => ({
    author,
    author_client,
    authored_at: NOW - 120_000,
  });

  it("reads History while the last edit was yours in the editor, or no one's recorded", () => {
    expect(historyButtonLabel(post("you@example.com", "editor"), YOU)).toBe("History");
    expect(historyButtonLabel(post(null, null), YOU)).toBe("History");
  });

  it("names the last edit when anyone else made it, or you through another client", () => {
    expect(historyButtonLabel(post("you@example.com", "claude-code"), YOU)).toBe(
      "Last edit by you@example.com via Claude Code · 2 min ago",
    );
    expect(historyButtonLabel(post("them@example.com", "editor"), YOU)).toBe(
      "Last edit by them@example.com · 2 min ago",
    );
    expect(historyButtonLabel(post("service", null), YOU)).toBe(
      "Last edit by a service token · 2 min ago",
    );
  });
});
