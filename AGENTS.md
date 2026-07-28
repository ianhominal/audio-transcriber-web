<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project context

Audio Transcriber (web) is the Next.js frontend **and** backend/API for an audio-transcription
product: upload or record audio, transcribe it with Groq Whisper, then search/summarize/chat over the
resulting notes with an LLM — including notes with speaker diarization synced from a companion
Windows desktop client (separate repo, WPF/.NET 8), which records locally (including meeting audio,
with auto-detection of Meet/Zoom/Teams/Discord) and diarizes speakers before syncing here.

### Stack

- Next.js 16 (App Router, Turbopack) · React 19 · TypeScript 5.
- Tailwind CSS v4, CSS-first: no `tailwind.config`, everything lives in `src/app/globals.css`.
- Supabase: Auth (Google OAuth), Postgres with Row Level Security on every table, Storage (private
  `audios` bucket). Migrations in `supabase/migrations/`, applied automatically on push to `main` via
  the Supabase↔GitHub integration.
- Groq for AI:
  - Transcription: raw `fetch` to the Groq REST API (Whisper). Does not go through the AI SDK.
  - Chat: Vercel AI SDK (`ai`, `@ai-sdk/groq`, `@ai-sdk/react`) with `streamText` + streaming.
  - Short structured tasks (summary, translation, vocabulary correction, auto title/tags): raw
    `fetch`, `llama-3.1-8b-instant`. Conversational chat/RAG: `llama-3.3-70b-versatile`.
- MCP: `@modelcontextprotocol/sdk` + `mcp-handler` (remote, read-only MCP server).
- Sentry (`@sentry/nextjs`), always wrapped in `next.config.ts`, no-op without a DSN.
- Testing: Vitest (unit, pure logic) + Playwright (e2e). Validation: zod v4.

### Repo structure

```
src/
├── app/
│   ├── api/            → endpoints (see below), all runtime "nodejs"
│   ├── app/             → authenticated dashboard (settings/, t/[id]/ detail+chat, transcribe/)
│   ├── auth/callback/  → exchanges the OAuth code for a session
│   ├── descargar/      → download landing page for the desktop app
│   └── login/
├── components/ui/      → Button, Modal, Skeleton, Spinner, EmptyState, CopyButton, MarkdownContent
├── lib/                 → business logic (see below)
└── proxy.ts             → Next 16 "middleware" (auth/session), delegates to lib/supabase/middleware.ts
```

### API endpoints (`src/app/api/`, all `runtime = "nodejs"`)

| Route | What it does |
|---|---|
| `transcribe/` | Transcribes with Groq Whisper and saves (dedupe + optional translation/vocabulary/auto title-tags in parallel with the upload). |
| `chat/` | Streaming chat scoped to ONE transcription. Client sends only the latest message; server rebuilds history from `chat_messages`. |
| `brain/` | RAG chat over ALL of a user's notes (full-text search retrieval), optionally scoped to a single project via `projectId`. Stateless by design — no persisted history. |
| `notes/`, `notes/merge/` | `notes/` creates a text-only note (e.g. "save this chat reply as a note"); `notes/merge` combines several notes into one AI-generated document. |
| `summarize/` | Generates/regenerates an AI summary (cached by content hash, daily caps). |
| `vocabulary/`, `vocabulary/[id]/` | CRUD for custom vocabulary terms used to correct transcription output. |
| `settings/` | Transcription defaults (engine/quality/language). |
| `mcp/` | Remote, read-only MCP server (Streamable HTTP), opaque bearer-token auth (not JWT). |
| `mcp-tokens/`, `mcp-tokens/[id]/` | Create/list/revoke a user's MCP tokens. |
| `sync/pull/`, `sync/push/` | Metadata sync with the desktop client (projects/transcriptions, tombstones). |
| `drive/*` | Google Drive OAuth + folder import/export sync. |
| `cron/purge/`, `cron/drive-sync/` | Scheduled trash purge and the Drive sync engine (the latter is triggered externally, not via `vercel.json`). |

### Key `src/lib/` modules

- `supabase/` — clients (browser/server/service-role). `getApiUser(req)` (`api.ts`) is THE auth entry
  point for API routes: cookies for the web client, `Authorization: Bearer <jwt>` for the desktop
  client. `schema-compat.ts` handles graceful degradation during migration rollout.
- `brain/` — retrieval + context-building for the "ask across notes" RAG chat; pure functions, no
  Supabase calls in this module (the route does the querying).
- `merge/` — "combine notes into a document" feature: request/streaming, candidate queries, validation
  (min/max note count, text truncation).
- `chat/`, `summary/`, `translate/`, `vocabulary/`, `titleTags/` — LLM feature configs/prompts/parsing.
- `format.ts` — `buildMarkdownExport`/`parseMarkdownExport`: this exact format is read back by Drive
  sync. Don't add new sections without also updating the Drive sync parser, or notes will corrupt on
  the next sync. Full-note export (with summary) uses the separate `noteExport.ts` instead.
- `markdown.ts` — the only sanitized Markdown→HTML renderer in the app (escapes always, no raw
  links/images/HTML). Rendered exclusively through `components/ui/MarkdownContent.tsx`, the only place
  in the app that calls `dangerouslySetInnerHTML`.
- `aiUsage.ts` — per-user daily AI usage caps, enforced atomically by Postgres `BEFORE INSERT` triggers
  on `ai_usage_log` (one trigger per `kind`).

### Database (Supabase)

- Every table uses Row Level Security, filtered by `auth.uid()`.
- Main tables: `profiles`, `projects`, `transcriptions`, `user_settings`, `vocabulary_terms`,
  `chat_messages`, `ai_usage_log` (append-only — RLS allows only SELECT/INSERT, no UPDATE/DELETE),
  `mcp_tokens`, `drive_connections`, `drive_file_map`, `drive_folders`.
- The Supabase↔GitHub migration integration occasionally fails to apply a migration on push — if a new
  feature "doesn't persist" in production, check whether the SQL actually ran in the Supabase SQL
  Editor.

### Auth

- Web: `src/proxy.ts` refreshes the Supabase session on every request; no session under `/app` →
  redirect to `/login`.
- API routes: `getApiUser(req)` (`src/lib/supabase/api.ts`) — cookies for the web client, JWT bearer
  for the desktop client. Always respects RLS. New endpoints should always use `getApiUser`, never a
  service-role client without an explicit user filter.
- MCP (`/api/mcp`): separate auth path via opaque tokens resolved against `mcp_tokens`, so
  `lib/mcp/tools.ts` filters `user_id` manually on every query instead of relying on RLS alone.
- Crons: constant-time `CRON_SECRET` comparison, bypasses `getApiUser` entirely.

### Run, test, deploy

```bash
npm install
# .env.local needs at least the vars below — see .env.example for the full list
npm run dev          # dev server (Turbopack) → http://localhost:3000
npm run build        # production build
npm test             # vitest run (unit, pure logic)
npm run test:watch   # vitest watch
npm run test:e2e     # playwright (spins up `next dev` itself)
npm run lint         # eslint
```

Before pushing: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` should all be clean.

Deploy is automatic: pushing to `main` triggers a Vercel deployment and applies pending Supabase
migrations via the Supabase↔GitHub integration. There is no separate staging/preview promotion step in
this repo's workflow.

Key env vars (see `.env.example`): `GROQ_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`,
`NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DRIVE_TOKEN_KEY`,
`MCP_TOKEN_HASH_SECRET`. All secrets are server-side only — never sent to the client.

### Conventions

- Code, identifiers, and comments: **English**. User-facing UI copy: **neutral Rioplatense Spanish**,
  no technical jargon leaking into user-facing text (no "engine", "Groq", "defaults", etc.).
- Conventional commits (`feat:`, `fix:`, `chore:`, …). No AI co-authorship/attribution in commits.
- Next.js 16 has real breaking changes vs. older training data — check `node_modules/next/dist/docs/`
  when in doubt (e.g. middleware is `src/proxy.ts`, not `middleware.ts`; route params are async).

### Gotchas

1. `format.ts`'s `buildMarkdownExport` is read back by Drive sync — don't add new sections to it, or
   you'll corrupt notes on the next sync. Full-note export (with summary) uses `noteExport.ts` instead.
2. `ai_usage_log` is append-only by RLS design (no UPDATE/DELETE) — daily AI usage caps are enforced by
   `BEFORE INSERT` triggers, one per `kind`.
3. Chat history is never trusted from the client: the server always reconstructs it itself
   (`chat_messages` for `/api/chat`) instead of accepting a client-supplied message array.
4. MCP rate-limiting is per **tool call**, not per HTTP request — JSON-RPC batching could otherwise be
   used to bypass a per-request limit. A token's `revoked_at` is immutable once set.
5. `/api/brain` validates `projectId` with a shape regex (`^[0-9a-fA-F]{8}-...-{12}$`), not strict
   `z.uuid()`. The desktop client generates deterministic ids (SHA-256 → UUID) whose version/variant
   nibbles can land outside strict RFC ranges due to how `.NET`'s `Guid(byte[])` constructor lays out
   bytes — strict `z.uuid()` rejected otherwise-valid ids from that client. Ownership safety still
   comes entirely from the `user_id` filter (taken from the authenticated session, never the request
   body) plus RLS, not from the UUID version bits.
6. `/api/sync/push` upserts transcriptions (rather than update-only) when the client sends
   `audio_name`: a transcription created entirely client-side (no server-side Groq call ever happened)
   has no pre-existing row, so an update-only write would silently touch zero rows and the note would
   be lost with no error surfaced.
7. Tailwind v4 is CSS-first — there is no `tailwind.config`; everything lives in `globals.css`.
8. Transcription uses a raw `fetch` to the Groq REST API; the AI SDK is used only for chat/RAG. Don't
   mix the two code paths.
9. The `drive-sync` cron is triggered externally with `CRON_SECRET` (not listed in `vercel.json`); the
   `purge` cron is the one configured there.
