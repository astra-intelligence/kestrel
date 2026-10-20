import { SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpTool } from "../shared/mcp";
import { routeAnchor } from "../shared/reference";
import { createRouter } from "../src/app";
import { getConfig } from "../src/env";
import { MCP_INSTRUCTIONS } from "../src/mcp/instructions";
import { isTool, toolName } from "../src/mcp/tools";
import { buildReferenceResponse } from "../src/reference";
import { accessDeployment } from "./support/access";
import { resetDatabase } from "./support/fixtures";
import { adminAuth, base, readJson } from "./support/http";
import { fetchWith, withVars } from "./support/worker_env";

// The MCP server (SPEC §11): Claude Desktop and claude.ai reach the instance as a connector,
// and each tool is one route of the same API, called as the person signed in, via Claude.

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

const PERSON = { email: "you@example.com", client: "editor" };

let nextId = 1;

/** One JSON-RPC message to the server, with `headers` for the credential. */
async function rpc(
  method: string,
  params: unknown,
  headers: Record<string, string>,
  send: (init: RequestInit) => Promise<Response> = (init) => SELF.fetch(`${base}/api/mcp`, init),
): Promise<Response> {
  return send({
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
}

async function listTools(): Promise<McpTool[]> {
  const res = await rpc("tools/list", {}, await adminAuth(PERSON));
  expect(res.status).toBe(200);
  return (await readJson(res)).result.tools;
}

/** A tool call's result, as the server answers it. */
async function callTool(
  name: string,
  args: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<{ isError: boolean; text: string }> {
  const res = await rpc(
    "tools/call",
    { name, arguments: args },
    headers ?? (await adminAuth(PERSON)),
  );
  expect(res.status).toBe(200);
  const { result } = await readJson(res);
  return { isError: result.isError, text: result.content[0].text };
}

describe("the tools are the API's routes (SPEC §11)", () => {
  it("lists one tool for every authoring route but dev tooling, uploads, and the server's own", async () => {
    const config = getConfig(withVars({}));
    const routes = buildReferenceResponse(
      createRouter(config).routes.map((r) => r.def),
    ).groups.flatMap((g) => g.routes);
    const names = (await listTools()).map((t) => t.name);
    expect(names).toEqual(routes.filter(isTool).map((r) => toolName(routeAnchor(r))));
    expect(new Set(names).size).toBe(names.length);
    for (const name of [
      "create_post",
      "get_post",
      "schedule_post",
      "cancel_send",
      "commit_import",
    ]) {
      expect(names).toContain(name);
    }
    for (const name of ["upload_image", "upload_logo", "load_demo_dataset", "call_mcp_server"]) {
      expect(names).not.toContain(name);
    }
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9_]{1,64}$/);
    }
  });

  it("takes each tool's name, description, and arguments from the route's own reference", async () => {
    const tools = await listTools();
    const get = tools.find((t) => t.name === "get_post");
    expect(get?.title).toBe("Get a post");
    expect(get?.annotations).toEqual({
      title: "Get a post",
      readOnlyHint: true,
      openWorldHint: false,
    });
    expect(get?.inputSchema.required).toEqual(["id"]);
    const schedule = tools.find((t) => t.name === "schedule_post");
    expect(schedule?.description).toContain("Calls `POST /api/posts/:id/schedule`.");
    expect(schedule?.description).toContain("`fire_at_too_soon`");
    expect(Object.keys(schedule?.inputSchema.properties as object)).toEqual(
      expect.arrayContaining(["id", "fire_at"]),
    );
    expect(schedule?.annotations.destructiveHint).toBe(true);
    // Each schema stands alone: an object it names is under its own `$defs`.
    for (const t of tools) {
      const text = JSON.stringify(t.inputSchema);
      expect(text).not.toContain("#/components/");
      const defs = (t.inputSchema.$defs ?? {}) as Record<string, unknown>;
      for (const [, key] of text.matchAll(/"#\/\$defs\/(\w+)"/g)) {
        expect(Object.keys(defs)).toContain(key);
      }
    }
  });

  it("names, in what it tells Claude on connecting, only tools that exist", async () => {
    const res = await rpc("initialize", { protocolVersion: "2025-06-18" }, await adminAuth(PERSON));
    const { result } = await readJson(res);
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(result.instructions).toBe(MCP_INSTRUCTIONS);
    const names = (await listTools()).map((t) => t.name);
    for (const [named] of MCP_INSTRUCTIONS.matchAll(/\b(?:get|list)_[a-z_]+/g)) {
      expect(names).toContain(named);
    }
  });
});

describe("a tool call is its route, as the person, via Claude (SPEC §11, Who acted)", () => {
  it("records a change made through a tool as the signed-in person via Claude, whatever client the caller named", async () => {
    const { vars, assertion } = await accessDeployment();
    const headers = {
      ...(await assertion({ email: "you@example.com" })),
      "Kestrel-Client": "editor",
    };
    const send = (init: RequestInit) => fetchWith(vars, "/api/mcp", init);
    const res = await rpc(
      "tools/call",
      { name: "create_post", arguments: { subject: "Via a tool" } },
      headers,
      send,
    );
    const { result } = await readJson(res);
    expect(result.isError).toBe(false);
    const created = JSON.parse(result.content[0].text);
    expect(created.post).toMatchObject({
      subject: "Via a tool",
      author: "you@example.com",
      author_client: "claude",
    });
    const read = await rpc(
      "tools/call",
      { name: "get_post", arguments: { id: created.post.id } },
      headers,
      send,
    );
    expect(JSON.parse((await readJson(read)).result.content[0].text).post.id).toBe(created.post.id);
  });

  it("passes a tool's arguments to the route's path, query, and body", async () => {
    const created = JSON.parse((await callTool("create_post", { subject: "One" })).text);
    const saved = await callTool("update_post", {
      id: created.post.id,
      markdown: "Hello",
      base_revision: created.revision_id,
    });
    expect(saved.isError).toBe(false);
    const read = JSON.parse((await callTool("get_post", { id: created.post.id })).text);
    expect(read.markdown).toBe("Hello");
    const listed = JSON.parse((await callTool("list_posts", { status: "draft", limit: 1 })).text);
    expect(listed.posts.map((p: { id: string }) => p.id)).toEqual([created.post.id]);
  });

  it("refuses an argument the route doesn't take, naming it, as the route itself does", async () => {
    const body = await callTool("create_post", { subject: "S", title: "T" });
    expect(body.isError).toBe(true);
    expect(body.text).toContain("Refused: HTTP 400 bad_request. title isn’t a field this takes");
    const query = await callTool("list_posts", { colour: "red" });
    expect(query.isError).toBe(true);
    expect(query.text).toContain("colour isn’t a query parameter this takes");
    const path = await callTool("get_post", {});
    expect(path).toEqual({
      isError: true,
      text: "id is required: it is the `id` in the route's path.",
    });
  });

  it("gives Claude a refusal as a tool error carrying its code, its words, and the next move", async () => {
    const file = { name: "l.txt", text: "a@x.io\n" };
    const plan = JSON.parse((await callTool("plan_import", { file })).text);
    const refused = await callTool("commit_import", { file, plan_hash: plan.plan_hash });
    expect(refused.isError).toBe(true);
    const [lead, move, , body] = refused.text.split("\n");
    expect(lead).toMatch(/^Refused: HTTP 409 attestation_required\. /);
    expect(move).toBe("Next move: Confirm, then send again.");
    expect(JSON.parse(body ?? "")).toMatchObject({
      error: "attestation_required",
      attestation: plan.attestation,
    });
  });

  it("can never let an import grow a send, since a tool call isn't the editor (SPEC §7)", async () => {
    const created = JSON.parse((await callTool("create_post", { subject: "Soon" })).text);
    const fireAt = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      (await callTool("schedule_post", { id: created.post.id, fire_at: fireAt })).isError,
    ).toBe(false);
    const file = { name: "l.txt", text: "a@x.io\n" };
    const plan = JSON.parse((await callTool("plan_import", { file })).text);
    expect(plan.sends_growing.length).toBe(1);
    const refused = await callTool("commit_import", {
      file,
      plan_hash: plan.plan_hash,
      attestation: { version: plan.attestation.version, accepted: true },
      acknowledge_sends: plan.sends_growing.map((s: { id: string }) => s.id),
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/^Refused: HTTP 409 sends_acknowledgement_required\. /);
  });
});

describe("the server's door (SPEC §11)", () => {
  it("refuses a request with no credential before any tool runs", async () => {
    const res = await rpc("tools/call", { name: "create_post", arguments: { subject: "S" } }, {});
    expect(res.status).toBe(401);
    const { vars } = await accessDeployment();
    const access = await rpc("tools/list", {}, {}, (init) => fetchWith(vars, "/api/mcp", init));
    expect(access.status).toBe(401);
    // Nothing the refused call named was made.
    expect(JSON.parse((await callTool("list_posts", {})).text).posts).toEqual([]);
  });

  it("refuses a request another site's page sent", async () => {
    const res = await rpc(
      "tools/list",
      {},
      { ...(await adminAuth(PERSON)), Origin: "https://evil.example" },
    );
    expect(res.status).toBe(403);
  });

  it("takes a notification with no answer, and opens no stream", async () => {
    const res = await SELF.fetch(`${base}/api/mcp`, {
      method: "POST",
      headers: { ...(await adminAuth(PERSON)), "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
    const get = await SELF.fetch(`${base}/api/mcp`, { headers: await adminAuth(PERSON) });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });

  it("answers a protocol version it doesn't speak with a 400, so a newer client falls back to initialize", async () => {
    const headers = { ...(await adminAuth(PERSON)), "MCP-Protocol-Version": "2026-07-28" };
    const res = await rpc("tools/list", {}, headers);
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe(-32600);
    const init = await rpc("initialize", { protocolVersion: "2026-07-28" }, headers);
    expect((await readJson(init)).result.protocolVersion).toBe("2025-11-25");
  });

  it("answers an unknown method or tool as JSON-RPC errors", async () => {
    const auth = await adminAuth(PERSON);
    expect((await readJson(await rpc("resources/list", {}, auth))).error.code).toBe(-32601);
    expect((await readJson(await rpc("tools/call", { name: "nope" }, auth))).error.code).toBe(
      -32602,
    );
    expect((await readJson(await rpc("ping", {}, auth))).result).toEqual({});
  });
});
