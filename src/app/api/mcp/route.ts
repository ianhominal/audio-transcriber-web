/**
 * Read-only remote MCP server: exposes the authenticated user's own transcriptions (text +
 * metadata, never audio) to external MCP clients (Claude Desktop, ChatGPT, etc.) over a single
 * Streamable-HTTP endpoint.
 *
 * Fixed path (`api/mcp/route.ts`), not a `[transport]` catch-all: this app reserves dynamic
 * segments for real resource ids, and a single Streamable-HTTP-only endpoint is all this phase
 * needs (`disableSse: true` below makes that explicit rather than implicit-via-missing-routes).
 *
 * Auth is a parallel, opaque bearer-token mechanism (`src/lib/mcp/token.ts`,
 * `src/lib/mcp/auth.ts`) — NOT `getApiUser`/Supabase session JWTs, since an external MCP client
 * has no browser session or Supabase JWT of its own. There is no logged-in user for these
 * requests, so every query in the tool handlers (`src/lib/mcp/tools.ts`) runs against the
 * service-role client and filters `user_id` explicitly, same discipline as
 * `src/app/api/cron/drive-sync/route.ts`.
 *
 * All actual query/business logic lives in `src/lib/mcp/tools.ts` and `src/lib/mcp/auth.ts` —
 * this file only wires the MCP protocol (`mcp-handler`) to those pure, independently-tested
 * functions, since Next.js route handlers may only export HTTP method handlers plus a few
 * reserved config names (no arbitrary named exports for direct unit testing here).
 */
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { resolveMcpAuth, authorizeMcpToolCall, MCP_READ_SCOPE } from "@/lib/mcp/auth";
import {
  listTranscriptions,
  getTranscription,
  searchTranscriptions,
  TRANSCRIPTION_ID_SCHEMA,
} from "@/lib/mcp/tools";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const runtime = "nodejs";

function unauthorized(): CallToolResult {
  return { content: [{ type: "text", text: "Unauthorized." }], isError: true };
}

function rateLimited(): CallToolResult {
  return {
    content: [{ type: "text", text: "Rate limit exceeded — try again in a bit." }],
    isError: true,
  };
}

/**
 * Authorizes ONE tool invocation (auth + per-call rate-limit consumption, see
 * `authorizeMcpToolCall`'s comment in `src/lib/mcp/auth.ts` for why this must run per TOOL CALL,
 * not once per HTTP request — CRITICAL fix, batching otherwise evades the rate limit/cost cap,
 * `.claude/resources/changelog/2026-07-11.md`). Every registered tool callback below calls this
 * FIRST, before touching any data.
 */
async function authorizeOrDeny(
  supabase: ReturnType<typeof createServiceRoleClient>,
  extra: Parameters<typeof authorizeMcpToolCall>[1]
): Promise<{ ok: true; userId: string } | { ok: false; result: CallToolResult }> {
  const authz = await authorizeMcpToolCall(supabase, extra);
  if (authz.ok) return { ok: true, userId: authz.userId };
  return { ok: false, result: authz.reason === "rate_limited" ? rateLimited() : unauthorized() };
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_transcriptions",
      {
        title: "List transcriptions",
        description:
          "List the authenticated user's own transcriptions: id, title, project, language, creation " +
          "date, and whether it was translated/summarized — metadata only, never the full text or " +
          "audio. Optionally filter by project id or a title search, and cap the result count.",
        inputSchema: {
          projectId: z.string().optional().describe("Only return transcriptions belonging to this project id."),
          search: z.string().optional().describe("Case-insensitive substring match against the transcription title."),
          limit: z.number().int().positive().optional().describe("Max results to return (default 20, capped at 50)."),
        },
      },
      async (input, extra) => {
        const supabase = createServiceRoleClient();
        const authz = await authorizeOrDeny(supabase, extra);
        if (!authz.ok) return authz.result;
        return listTranscriptions(supabase, authz.userId, input);
      }
    );

    server.registerTool(
      "get_transcription",
      {
        title: "Get transcription",
        description:
          "Get the full detail of ONE of the authenticated user's own transcriptions: complete text " +
          "plus metadata (title, description, language, translation, summary, project, timestamps). " +
          "Never returns audio. Returns a clean not-found result if the id doesn't exist or belongs " +
          "to another user — those two cases are indistinguishable by design.",
        inputSchema: {
          id: TRANSCRIPTION_ID_SCHEMA,
        },
      },
      async (input, extra) => {
        const supabase = createServiceRoleClient();
        const authz = await authorizeOrDeny(supabase, extra);
        if (!authz.ok) return authz.result;
        return getTranscription(supabase, authz.userId, input);
      }
    );

    server.registerTool(
      "search_transcriptions",
      {
        title: "Search transcriptions",
        description:
          "Search the authenticated user's own transcriptions by matching a query against title, body " +
          "text, and description (case-insensitive). Returns a short excerpt per match, not the full " +
          "text — follow up with get_transcription for the complete content.",
        inputSchema: {
          query: z.string().min(1).describe("The text to search for."),
          limit: z.number().int().positive().optional().describe("Max results to return (default 20, capped at 50)."),
        },
      },
      async (input, extra) => {
        const supabase = createServiceRoleClient();
        const authz = await authorizeOrDeny(supabase, extra);
        if (!authz.ok) return authz.result;
        return searchTranscriptions(supabase, authz.userId, input);
      }
    );
  },
  {
    serverInfo: { name: "audio-transcriber", version: "1.0.0" },
    capabilities: { tools: {} },
  },
  {
    basePath: "/api",
    maxDuration: 30,
    disableSse: true,
  }
);

/** Thin adapter: `resolveMcpAuth` (fully unit-tested in `src/lib/mcp/auth.test.ts`) does the real
 * work against a Supabase client — this just supplies that client, since a route.ts file itself
 * can't expose the testable function directly (see file header). */
const verifyToken = async (_req: Request, bearerToken?: string) => {
  return resolveMcpAuth(createServiceRoleClient(), bearerToken);
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  requiredScopes: [MCP_READ_SCOPE],
});

/** Only POST is exported on purpose. `mcp-handler`'s own bundled implementation (confirmed by
 * reading the installed `node_modules/mcp-handler/dist/index.js`) unconditionally 405s GET/DELETE
 * on this endpoint — but that 405 happens INSIDE `handler`, which `withMcpAuth` only calls AFTER
 * `verifyToken` (`resolveMcpAuth`) has already run, which itself does a real `mcp_tokens` lookup
 * by hash. Without this, a GET/DELETE request that can never succeed still burns that DB query for
 * nothing. Exporting only POST makes Next.js itself return a framework-level 405 for GET/DELETE
 * without ever invoking `withMcpAuth`/touching Supabase at all. Safe: `disableSse: true` above
 * already means no legitimate Streamable-HTTP client behavior depends on GET/DELETE reaching this
 * route (SSE — the one transport that used GET — is explicitly off).
 *
 * Note this is no longer a RATE-LIMIT-griefing concern the way it originally was: `resolveMcpAuth`
 * doesn't touch the rate limit at all anymore (see its comment in `src/lib/mcp/auth.ts`) — only
 * `authorizeOrDeny`, called from inside an actual registered-tool callback, does, and GET/DELETE
 * never reach one. */
export { authHandler as POST };
