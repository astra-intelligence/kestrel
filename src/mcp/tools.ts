/**
 * The MCP server's tools, each one API route (SPEC §11): a fourth projection of the OpenAPI
 * document, which is itself generated from the route manifest, so a tool's name, description,
 * and input schema can't drift from the route it calls. A tool is called by building the request
 * the route takes and handing it to the router, so it meets the route's own gate, door, and
 * handler, and nothing here decides what a call may do.
 *
 * Which routes are tools is one rule (`isTool`): the authoring API, less the dev routes, the
 * routes that take an upload, and the MCP server's own. An upload is a file's bytes, which a tool
 * call's JSON arguments can't carry; Claude Code, which can, uploads through `kestrel api`.
 */

import type { McpTool, ToolResult } from "../../shared/mcp";
import type { ReferenceEntry, ReferenceResponse } from "../../shared/reference";
import { concretePath } from "../../shared/reference";
import { CLAUDE_CLIENT, CLIENT_HEADER } from "../../shared/who_acted";
import { ACCESS_JWT_HEADER } from "../auth/access";
import { type OpenApiDocument, openApiPath, type Schema } from "../reference/openapi";
import { REFUSAL_MOVE, type RefusalCode } from "../reference/refusals";

/** The path the MCP server answers at, which no tool calls. */
export const MCP_PATH = "/api/mcp";

/** A tool, and how its arguments become the route's request. */
export interface ToolRoute {
  tool: McpTool;
  method: string;
  /** The manifest path, its `:name` parameters still to fill. */
  path: string;
  pathParams: string[];
  queryParams: string[];
  /** The route takes a JSON body, so the arguments left over are its fields. */
  takesBody: boolean;
}

/** Whether a route is a tool: the authoring API, less dev tooling, uploads, and this server. */
export function isTool(
  r: Pick<ReferenceEntry, "access" | "resource" | "path" | "accepts">,
): boolean {
  return (
    r.access === "admin" &&
    r.resource !== "dev" &&
    !r.path.startsWith(MCP_PATH) &&
    (r.accepts ?? []).every((type) => type === "application/json")
  );
}

/** A tool's name: the route's anchor in the reference (its `operationId`), in underscores. */
export function toolName(operationId: string): string {
  return operationId.replace(/-/g, "_");
}

const COMPONENT_REF = "#/components/schemas/";

/** The objects a schema names by `$ref`, and the ones they name in turn. */
function referencedObjects(schema: unknown, components: Record<string, Schema>): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    const text = JSON.stringify(node);
    for (const [, key] of text.matchAll(/"#\/components\/schemas\/(\w+)"/g)) {
      if (key && !found.has(key)) {
        found.add(key);
        walk(components[key]);
      }
    }
  };
  walk(schema);
  return [...found].sort();
}

/** A schema with its `$ref`s pointed at its own `$defs`, so it stands without the document. */
function standalone(schema: Schema, components: Record<string, Schema>): Record<string, unknown> {
  const keys = referencedObjects(schema, components);
  const rewrite = (node: unknown): unknown =>
    JSON.parse(JSON.stringify(node).replaceAll(`"${COMPONENT_REF}`, `"#/$defs/`));
  const out = rewrite(schema) as Record<string, unknown>;
  if (keys.length) {
    out.$defs = Object.fromEntries(keys.map((k) => [k, rewrite(components[k])]));
  }
  return out;
}

/**
 * One route as a tool: its path parameters, query parameters, and body fields as one object of
 * arguments, its summary and its own refusals (each with the next move) as the description.
 * Throws when two of those share a name, since a call couldn't say which it meant.
 */
function toolFor(r: ReferenceEntry, doc: OpenApiDocument): ToolRoute {
  const op = doc.paths[openApiPath(r.path)]?.[r.method.toLowerCase()];
  if (!op) {
    throw new Error(`the OpenAPI document has no ${r.method} ${r.path}`);
  }
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  const add = (name: string, schema: Schema, needed: boolean): void => {
    if (Object.hasOwn(properties, name)) {
      throw new Error(`${r.method} ${r.path} takes two arguments named ${name}`);
    }
    properties[name] = schema;
    if (needed) {
      required.push(name);
    }
  };
  const pathParams: string[] = [];
  const queryParams: string[] = [];
  for (const p of op.parameters ?? []) {
    if (p.in === "path") {
      pathParams.push(p.name);
      add(p.name, { type: "string", description: `The \`${p.name}\` in the route's path.` }, true);
    } else if (p.in === "query") {
      queryParams.push(p.name);
      add(p.name, { ...p.schema, description: p.description }, p.required);
    }
  }
  const body = op.requestBody?.content["application/json"]?.schema;
  for (const [name, schema] of Object.entries(body?.properties ?? {})) {
    add(name, schema, body?.required?.includes(name) ?? false);
  }

  const refusals = Object.entries(op.responses)
    .filter(([status]) => status !== "2XX" && status !== "default")
    .map(([, answer]) => answer.description);
  const description = [
    op.description,
    `Calls \`${r.method} ${concretePath(r.path)}\`.`,
    ...(refusals.length ? [`Refusals of its own:\n\n${refusals.join("\n\n")}`] : []),
  ].join("\n\n");
  const readOnly = r.method === "GET";
  return {
    tool: {
      name: toolName(op.operationId),
      title: r.title,
      description,
      inputSchema: {
        ...standalone(
          { type: "object", properties, ...(required.length ? { required } : {}) },
          doc.components.schemas,
        ),
        type: "object",
      },
      annotations: {
        title: r.title,
        readOnlyHint: readOnly,
        ...(readOnly ? {} : { destructiveHint: r.method !== "PUT" }),
        ...(r.method === "PUT" || r.method === "DELETE" ? { idempotentHint: true } : {}),
        openWorldHint: false,
      },
    },
    method: r.method,
    path: r.path,
    pathParams,
    queryParams,
    takesBody: r.accepts?.includes("application/json") ?? false,
  };
}

/** Every tool the reference's routes make, in the reference's order. */
export function toolsFrom(ref: ReferenceResponse, doc: OpenApiDocument): ToolRoute[] {
  return ref.groups.flatMap((g) => g.routes.filter(isTool).map((r) => toolFor(r, doc)));
}

/** An argument as a query or path value: a list as a comma list, anything else as text. */
function asText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(asText).join(",");
  }
  return JSON.stringify(value);
}

/** The credential headers a tool call carries on, from the request that reached the server. */
const CREDENTIAL_HEADERS = [ACCESS_JWT_HEADER, "Authorization"];

/**
 * The request a tool call makes of its route: the arguments split into the path, the query, and
 * the body, as the tool's schema says, under the caller's own credential and Claude's name as
 * the client. An argument the route doesn't take goes where its door will refuse it by name: the
 * body of a route that takes one, the query of one that doesn't. Returns a refusal's words
 * instead when a path argument is missing, since the route can't be found without it.
 */
export function toolRequest(
  t: ToolRoute,
  args: Record<string, unknown>,
  origin: string,
  from: Headers,
): Request | string {
  const rest = { ...args };
  let path = concretePath(t.path);
  for (const name of t.pathParams) {
    const value = rest[name];
    delete rest[name];
    if (value === undefined || value === null || asText(value) === "") {
      return `${name} is required: it is the \`${name}\` in the route's path.`;
    }
    const encoded = encodeURIComponent(asText(value));
    path = path.replace(new RegExp(`:${name}\\b`), () => encoded);
  }
  const url = new URL(path, origin);
  const query = t.takesBody ? t.queryParams : Object.keys(rest);
  for (const name of query) {
    const value = rest[name];
    delete rest[name];
    if (value !== undefined && value !== null) {
      url.searchParams.set(name, asText(value));
    }
  }
  const headers = new Headers({ [CLIENT_HEADER]: CLAUDE_CLIENT });
  for (const name of CREDENTIAL_HEADERS) {
    const value = from.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  if (!t.takesBody) {
    return new Request(url, { method: t.method, headers });
  }
  headers.set("content-type", "application/json");
  return new Request(url, { method: t.method, headers, body: JSON.stringify(rest) });
}

/**
 * A route's answer as a tool result: its body as it came, and a refusal marked an error and led
 * by its status, code, words, and the next move the reference gives it, so Claude reads what to
 * do from the refusal itself.
 */
export async function toolResult(res: Response): Promise<ToolResult> {
  const text = await res.text();
  if (res.ok) {
    return {
      content: [{ type: "text", text: text === "" ? `Done (HTTP ${res.status}).` : text }],
      isError: false,
    };
  }
  let code: string | undefined;
  let message: string | undefined;
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    code = typeof body.error === "string" ? body.error : undefined;
    message = typeof body.message === "string" ? body.message : undefined;
  } catch {
    // Not a refusal's JSON body: its text is all there is to say.
  }
  const move = code && Object.hasOwn(REFUSAL_MOVE, code) ? REFUSAL_MOVE[code as RefusalCode] : null;
  const lead = [
    `Refused: HTTP ${res.status}${code ? ` ${code}` : ""}.${message ? ` ${message}` : ""}`,
    ...(move ? [`Next move: ${move}.`] : []),
  ].join("\n");
  return {
    content: [{ type: "text", text: text === "" ? lead : `${lead}\n\n${text}` }],
    isError: true,
  };
}
