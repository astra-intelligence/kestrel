import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { SendView } from "../shared/sends";
import type { Actor } from "../shared/who_acted";
import { DEV_TOKEN_ID } from "../src/auth/dev_token";
import * as sends from "../src/db/sends";
import { frozenSend, resetDatabase } from "./support/fixtures";
import { adminAuth, base, readJson } from "./support/http";

// Who acted on a send (SPEC §6, §11): each act that changes a send records the person or the
// service token behind it, with the client a person came through, and every read of the send
// shows it. The latest of each act is kept; an act that changes nothing records no one.

beforeEach(resetDatabase);

/** Who acts, as the request's credential and `Kestrel-Client` say, and what the send records. */
interface Who {
  name: string;
  auth: { email?: string; client?: string };
  actor: Actor;
}

const EDITOR: Who = {
  name: "a person in the editor",
  auth: { email: "you@example.com", client: "editor" },
  actor: { kind: "human", email: "you@example.com", client: "editor" },
};
const CLAUDE_CODE: Who = {
  name: "a person via Claude Code",
  auth: { email: "you@example.com", client: "claude-code" },
  actor: { kind: "human", email: "you@example.com", client: "claude-code" },
};
const NO_CLIENT: Who = {
  name: "a person through a client that names nothing",
  auth: { email: "you@example.com" },
  actor: { kind: "human", email: "you@example.com", client: null },
};
const SERVICE: Who = {
  name: "a service token",
  // The client's name on a service token's request changes nothing.
  auth: { client: "claude-code" },
  actor: { kind: "service", token_id: DEV_TOKEN_ID, client: null },
};
const EVERYONE = [EDITOR, CLAUDE_CODE, NO_CLIENT, SERVICE];

async function call(who: Who, method: string, path: string, body?: unknown): Promise<Response> {
  const headers = await adminAuth(who.auth);
  return SELF.fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A draft, made in the editor, its id. */
async function draft(): Promise<string> {
  const res = await call(EDITOR, "POST", "/api/posts", { subject: "S", markdown: "# Hi" });
  return (await readJson(res)).post.id;
}

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
const inTwoHours = () => new Date(Date.now() + 7_200_000).toISOString();

/** A send's view as `GET /api/sends/:id` reads it. */
async function view(id: string): Promise<SendView> {
  return (await readJson(await call(EDITOR, "GET", `/api/sends/${id}`))).send;
}

/** Who acted on a send, as its view reports each act. */
const actedBy = (v: SendView) => ({
  scheduled_by: v.scheduled_by,
  moved_by: v.moved_by,
  canceled_by: v.canceled_by,
  resolved_by: v.resolved_by,
});

/** A scheduled send, made by `who`, its id. */
async function scheduled(who: Who): Promise<string> {
  const res = await call(who, "POST", `/api/posts/${await draft()}/schedule`, {
    fire_at: inAnHour(),
  });
  expect(res.status).toBe(201);
  return (await readJson(res)).send.id;
}

/** A send wedged on one recipient the provider never answered for, its id. */
async function wedged(): Promise<string> {
  const send = await frozenSend(Date.now() - 1000);
  await env.DB.prepare(
    "INSERT INTO deliveries (send_id, email, status, attempts, updated_at) VALUES (?, 'a@example.com', 'dispatched', 0, ?)",
  )
    .bind(send.id, Date.now())
    .run();
  await env.DB.prepare(
    "UPDATE sends SET status = 'sending', started_at = ?, audience_resolved_at = ? WHERE id = ?",
  )
    .bind(Date.now(), Date.now(), send.id)
    .run();
  await sends.recomputeSendCounters(env.DB, send.id);
  return send.id;
}

describe("a send records who acted on it (SPEC §6, §11)", () => {
  for (const who of EVERYONE) {
    it(`records ${who.name} as who scheduled it, and answers it on the schedule`, async () => {
      const res = await call(who, "POST", `/api/posts/${await draft()}/schedule`, {
        fire_at: inAnHour(),
      });
      const send: SendView = (await readJson(res)).send;
      expect(send.scheduled_by).toEqual(who.actor);
      expect(actedBy(await view(send.id))).toEqual({
        scheduled_by: who.actor,
        moved_by: null,
        canceled_by: null,
        resolved_by: null,
      });
    });

    it(`records ${who.name} as who sent it now`, async () => {
      const res = await call(who, "POST", `/api/posts/${await draft()}/send`);
      expect(res.status).toBe(201);
      const id: string = (await readJson(res)).send.id;
      expect((await view(id)).scheduled_by).toEqual(who.actor);
    });

    it(`records ${who.name} as who moved it`, async () => {
      const id = await scheduled(EDITOR);
      const res = await call(who, "POST", `/api/sends/${id}/reschedule`, { fire_at: inTwoHours() });
      expect((await readJson(res)).send.moved_by).toEqual(who.actor);
      expect(actedBy(await view(id))).toEqual({
        scheduled_by: EDITOR.actor,
        moved_by: who.actor,
        canceled_by: null,
        resolved_by: null,
      });
    });

    it(`records ${who.name} as who canceled it`, async () => {
      const id = await scheduled(EDITOR);
      const res = await call(who, "POST", `/api/sends/${id}/cancel`);
      expect((await readJson(res)).send.canceled_by).toEqual(who.actor);
      expect(actedBy(await view(id))).toEqual({
        scheduled_by: EDITOR.actor,
        moved_by: null,
        canceled_by: who.actor,
        resolved_by: null,
      });
    });

    it(`records ${who.name} as who resolved it while wedged`, async () => {
      const id = await wedged();
      const res = await call(who, "POST", `/api/sends/${id}/resolve`, { resolution: "unsent" });
      expect(res.status).toBe(200);
      expect((await readJson(res)).send.resolved_by).toEqual(who.actor);
      expect((await view(id)).resolved_by).toEqual(who.actor);
    });
  }

  it("keeps each act's actor apart, and the latest of each", async () => {
    const id = await scheduled(SERVICE);
    await call(CLAUDE_CODE, "POST", `/api/sends/${id}/reschedule`, { fire_at: inTwoHours() });
    await call(NO_CLIENT, "POST", `/api/sends/${id}/reschedule`, { fire_at: inAnHour() });
    await call(EDITOR, "POST", `/api/sends/${id}/cancel`);
    expect(actedBy(await view(id))).toEqual({
      scheduled_by: SERVICE.actor,
      moved_by: NO_CLIENT.actor,
      canceled_by: EDITOR.actor,
      resolved_by: null,
    });
  });

  it("records no one for an act that changes nothing", async () => {
    const id = await scheduled(EDITOR);
    const fireAt = (await view(id)).fire_at;
    // A move to the time it already has.
    await call(CLAUDE_CODE, "POST", `/api/sends/${id}/reschedule`, { fire_at: fireAt });
    expect((await view(id)).moved_by).toBeNull();
    // A cancel repeated keeps who canceled it first.
    await call(EDITOR, "POST", `/api/sends/${id}/cancel`);
    await call(SERVICE, "POST", `/api/sends/${id}/cancel`);
    expect((await view(id)).canceled_by).toEqual(EDITOR.actor);
    // A repeated Send now answers the send it made, and keeps who made it.
    const post = await draft();
    const first = (await readJson(await call(EDITOR, "POST", `/api/posts/${post}/send`))).send;
    const repeat = await readJson(await call(SERVICE, "POST", `/api/posts/${post}/send`));
    expect(repeat.idempotent).toBe(true);
    expect(repeat.send.scheduled_by).toEqual(EDITOR.actor);
    expect((await view(first.id)).scheduled_by).toEqual(EDITOR.actor);
  });

  it("records no one for a refused act", async () => {
    const id = await scheduled(EDITOR);
    const tooSoon = new Date(Date.now() + 1000).toISOString();
    const res = await call(SERVICE, "POST", `/api/sends/${id}/reschedule`, { fire_at: tooSoon });
    expect((await readJson(res)).error).toBe("fire_at_too_soon");
    expect((await view(id)).moved_by).toBeNull();
  });

  it("shows who acted on every read of the send: the list and the feed as well", async () => {
    const before = (await readJson(await call(EDITOR, "GET", "/api/sends"))).cursor;
    const id = await scheduled(CLAUDE_CODE);
    const list = await readJson(await call(EDITOR, "GET", "/api/sends"));
    expect(list.sends.map((s: SendView) => [s.id, s.scheduled_by])).toEqual([
      [id, CLAUDE_CODE.actor],
    ]);
    const feed = await readJson(await call(EDITOR, "GET", `/api/sends/feed?since=${before}`));
    expect(feed.sends.map((s: SendView) => [s.id, s.scheduled_by])).toEqual([
      [id, CLAUDE_CODE.actor],
    ]);
  });

  it("reads a send no act was recorded on as acted on by no one", async () => {
    const send = await frozenSend(Date.now() + 3_600_000);
    expect(actedBy(await view(send.id))).toEqual({
      scheduled_by: null,
      moved_by: null,
      canceled_by: null,
      resolved_by: null,
    });
  });
});
