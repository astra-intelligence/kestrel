// The Model Context Protocol as the instance's MCP server speaks it (POST /api/mcp, SPEC §11):
// the JSON-RPC envelope, the protocol versions it serves, and a tool as `tools/list` lists it.
// Only the parts a stateless server of tools and read-only resources uses. The Worker answers in
// these shapes; a spec reads them back, so the two are held to one definition.

/** The protocol revisions served, newest first: the ones opened by an `initialize` handshake
 *  that take one message a request. 2025-03-26 also took batches, which this server doesn't, so
 *  it isn't claimed. A client asking for another is answered with the newest, as the protocol's
 *  negotiation says. */
export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18"] as const;

/** The header a client names its protocol version in, on every request after `initialize`. */
export const MCP_VERSION_HEADER = "MCP-Protocol-Version";

/** JSON-RPC's error codes, as MCP uses them. */
export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

/** A request's or a response's id: a string or a number, never null. */
export type JsonRpcId = string | number;

/** A JSON-RPC answer: its result, or its error. */
export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | {
      jsonrpc: "2.0";
      id: JsonRpcId | null;
      error: { code: number; message: string; data?: unknown };
    };

/** What a tool's annotations hint to the client, so it can ask before a change: whether it only
 *  reads, whether a change it makes is one to undo with care, and whether it reaches past the
 *  instance (an email to someone). */
export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
}

/** A tool as `tools/list` lists it: one task, over one or more API routes. */
export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown> & { type: "object" };
  annotations: ToolAnnotations;
}

/** What `tools/call` answers: the route's own body as text, marked an error when refused. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError: boolean;
}
