/**
 * The instance's MCP server (SPEC §11): how Claude Desktop and claude.ai, which reach an outside
 * service only as a connector, work the same API the editor and Claude Code do. It answers MCP's
 * Streamable HTTP transport at `POST /api/mcp`, statelessly: every request stands alone, so no
 * session is kept, nothing is held between calls, and nothing streams. The access layer signs
 * the person in, through its managed OAuth, and the route's gate re-verifies the assertion as it
 * does on every admin route, so this module never sees a credential it has to judge.
 *
 * It speaks the protocol revisions opened by an `initialize` handshake (`MCP_PROTOCOL_VERSIONS`).
 * A client that asks for another in the version header is refused with a plain 400, which a
 * newer client takes as its sign to fall back to `initialize`. The tools are `tools.ts`; this is
 * only the envelope around them.
 */

import {
  JSON_RPC_ERRORS,
  type JsonRpcId,
  type JsonRpcResponse,
  MCP_PROTOCOL_VERSIONS,
  MCP_VERSION_HEADER,
  type ToolResult,
} from "../../shared/mcp";
import type { ReferenceResponse } from "../../shared/reference";
import { buildInfo } from "../build";
import { readJsonObject } from "../lib/body";
import { json } from "../lib/errors";
import { log } from "../lib/log";
import { openApiDocument } from "../reference/openapi";
import type { RequestContext, Router } from "../router";
import { MCP_INSTRUCTIONS } from "./instructions";
import { type ToolRoute, toolRequest, toolResult, toolsFrom } from "./tools";

export { MCP_PATH } from "./tools";

// The tools a router's manifest makes, built once per router: the manifest is fixed once built.
const toolsByRouter = new WeakMap<Router, ToolRoute[]>();

/** The tools `router` serves, from the reference and OpenAPI document its manifest generates. */
export function routerTools(router: Router, reference: () => ReferenceResponse): ToolRoute[] {
  let tools = toolsByRouter.get(router);
  if (!tools) {
    const ref = reference();
    tools = toolsFrom(ref, openApiDocument(ref, "", buildInfo().version));
    toolsByRouter.set(router, tools);
  }
  return tools;
}

const SUPPORTED: readonly string[] = MCP_PROTOCOL_VERSIONS;

function result(id: JsonRpcId, value: unknown): Response {
  const body: JsonRpcResponse = { jsonrpc: "2.0", id, result: value };
  return json(body);
}

function error(id: JsonRpcId | null, code: number, message: string, status = 200): Response {
  const body: JsonRpcResponse = { jsonrpc: "2.0", id, error: { code, message } };
  return json(body, status);
}

/** A message the server takes and answers with nothing: a notification, or a client's response. */
function accepted(): Response {
  return new Response(null, { status: 202 });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `GET /api/mcp`: refused, since the server sends nothing a client didn't ask for. */
export function stream(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

/**
 * `POST /api/mcp`: one JSON-RPC message. `tools` are the router's; a tool call is handed back to
 * `router` as the request its route takes.
 */
export async function handle(
  c: RequestContext,
  router: Router,
  tools: readonly ToolRoute[],
): Promise<Response> {
  const msg = await readJsonObject(c);
  const version = c.req.headers.get(MCP_VERSION_HEADER);
  if (msg.method !== "initialize" && version !== null && !SUPPORTED.includes(version)) {
    return error(
      null,
      JSON_RPC_ERRORS.invalidRequest,
      `${MCP_VERSION_HEADER} ${version} isn't served; this server speaks ${SUPPORTED.join(", ")}, opened by initialize`,
      400,
    );
  }
  if (msg.jsonrpc !== "2.0") {
    return error(null, JSON_RPC_ERRORS.invalidRequest, 'jsonrpc must be "2.0"', 400);
  }
  // A client's response to a request of ours (we make none) or a notification: taken, no answer.
  if (msg.method === undefined || msg.id === undefined) {
    return accepted();
  }
  const { id, method } = msg;
  if ((typeof id !== "string" && typeof id !== "number") || typeof method !== "string") {
    return error(null, JSON_RPC_ERRORS.invalidRequest, "id must be a string or a number", 400);
  }
  const params = isObject(msg.params) ? msg.params : {};

  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return result(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "kestrel", title: "Kestrel", version: buildInfo().version },
        instructions: MCP_INSTRUCTIONS,
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: tools.map((t) => t.tool) });
    case "tools/call": {
      const t = tools.find((x) => x.tool.name === params.name);
      if (!t) {
        return error(id, JSON_RPC_ERRORS.invalidParams, `no tool is named ${String(params.name)}`);
      }
      return result(id, await call(c, router, t, params.arguments));
    }
    default:
      return error(
        id,
        JSON_RPC_ERRORS.methodNotFound,
        `${method} isn't a method this server takes`,
      );
  }
}

/** One tool call: its route's request, through the router, and the answer as a tool result. */
async function call(
  c: RequestContext,
  router: Router,
  t: ToolRoute,
  args: unknown,
): Promise<ToolResult> {
  if (args !== undefined && !isObject(args)) {
    return { content: [{ type: "text", text: "arguments must be an object" }], isError: true };
  }
  const req = toolRequest(t, args ?? {}, c.url.origin, c.req.headers);
  if (typeof req === "string") {
    return { content: [{ type: "text", text: req }], isError: true };
  }
  const res = await router.handle(req, c.env, c.ctx);
  log.info("mcp.call", { tool: t.tool.name, status: res.status });
  return toolResult(res);
}
