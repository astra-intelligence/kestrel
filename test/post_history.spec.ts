import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { HistoryEntry } from "../shared/posts";
import { DEV_TOKEN_ID } from "../src/auth/dev_token";
import * as posts from "../src/db/posts";
import { getConfig } from "../src/env";
import { freeze } from "../src/send/schedule";
import { resetDatabase } from "./support/fixtures";
import { adminAuth, base, readJson } from "./support/http";

// A post's history (SPEC §6, §11): every revision and every recorded act on its sends, newest
// first, each with who acted, in the shape whoami answers.

beforeEach(resetDatabase);

const EDITOR = { email: "you@example.com", client: "editor" };
const CLAUDE_CODE = { email: "you@example.com", client: "claude-code" };
const SERVICE = { client: "claude-code" };

async function call(
  who: { email?: string; client?: string },
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const headers = await adminAuth(who);
  return SELF.fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function historyOf(id: string): Promise<{ entries: HistoryEntry[]; incomplete: boolean }> {
  const res = await call(EDITOR, "GET", `/api/posts/${id}/history`);
  expect(res.status).toBe(200);
  return readJson(res);
}

describe("a post's history (SPEC §6, §11)", () => {
  it("lists every revision and every act on its sends, newest first, with who acted", async () => {
    const created = await readJson(
      await call(EDITOR, "POST", "/api/posts", { subject: "S", markdown: "# One" }),
    );
    const id: string = created.post.id;
    await call(CLAUDE_CODE, "PUT", `/api/posts/${id}`, {
      markdown: "# Two",
      base_revision: created.revision_id,
    });
    const scheduled = await readJson(
      await call(CLAUDE_CODE, "POST", `/api/posts/${id}/schedule`, { fire_at: inHours(1) }),
    );
    const sendId: string = scheduled.send.id;
    const moved = await readJson(
      await call(SERVICE, "POST", `/api/sends/${sendId}/reschedule`, { fire_at: inHours(2) }),
    );
    await call(EDITOR, "POST", `/api/sends/${sendId}/cancel`);

    const { entries, incomplete } = await historyOf(id);
    expect(incomplete).toBe(false);
    expect(entries.map((e) => [e.kind, e.actor, e.revision, e.send_id])).toEqual([
      ["canceled", { kind: "human", email: "you@example.com", client: "editor" }, null, sendId],
      ["moved", { kind: "service", token_id: DEV_TOKEN_ID, client: null }, null, sendId],
      [
        "scheduled",
        { kind: "human", email: "you@example.com", client: "claude-code" },
        null,
        sendId,
      ],
      ["edited", { kind: "human", email: "you@example.com", client: "claude-code" }, 2, null],
      ["created", { kind: "human", email: "you@example.com", client: "editor" }, 1, null],
    ]);
    expect(entries.map((e) => e.fire_at)).toEqual([
      null,
      moved.send.fire_at,
      scheduled.send.fire_at,
      null,
      null,
    ]);
    expect(entries.map((e) => e.at)).toEqual([...entries.map((e) => e.at)].sort((a, b) => b - a));
  });

  it("names a Send now and a Resolve's resolution", async () => {
    const id: string = (
      await readJson(await call(EDITOR, "POST", "/api/posts", { subject: "S", markdown: "# One" }))
    ).post.id;
    await call(CLAUDE_CODE, "POST", `/api/posts/${id}/send`);
    const sendId: string = (await historyOf(id)).entries[0]?.send_id ?? "";
    // Wedge the send on one recipient the provider never answered for, then Resolve it.
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO deliveries (send_id, email, status, attempts, updated_at) VALUES (?, 'a@example.com', 'dispatched', 0, ?)",
      ).bind(sendId, Date.now()),
      env.DB.prepare(
        "UPDATE sends SET status = 'sending', fire_at = ?, started_at = ?, audience_resolved_at = ?, c_in_flight = 1 WHERE id = ?",
      ).bind(Date.now() - 1000, Date.now(), Date.now(), sendId),
    ]);
    await call(EDITOR, "POST", `/api/sends/${sendId}/resolve`, { resolution: "unsent" });
    const { entries } = await historyOf(id);
    expect(entries.slice(0, 2).map((e) => [e.kind, e.resolution])).toEqual([
      ["resolved", "unsent"],
      ["sent_now", null],
    ]);
  });

  it("says when a send's acts were made before they were recorded", async () => {
    const { post } = await posts.createPost(env.DB, { subject: "Old", markdown: "# Hi" }, "t");
    // A freeze that records no act, as a send made before acts were recorded.
    await freeze(env, getConfig(env), post, Date.now() + 3_600_000);
    const { entries, incomplete } = await historyOf(post.id);
    expect(incomplete).toBe(true);
    expect(entries.map((e) => e.kind)).toEqual(["created"]);
  });

  it("reads a revision saved by a service token as one, and one with no author as no one", async () => {
    const { post } = await posts.createPost(env.DB, { subject: "S", markdown: "# Hi" }, null);
    await call(SERVICE, "PUT", `/api/posts/${post.id}`, {
      markdown: "# Two",
      base_revision: post.current_revision,
    });
    const { entries } = await historyOf(post.id);
    expect(entries.map((e) => e.actor)).toEqual([{ kind: "service", client: null }, null]);
  });

  it("answers 404 for a post that isn't there", async () => {
    expect((await call(EDITOR, "GET", "/api/posts/nope/history")).status).toBe(404);
  });
});
