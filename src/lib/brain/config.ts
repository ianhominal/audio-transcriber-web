/**
 * "Segundo cerebro" (feature 2026-07-13, see brief): ask the AI about ALL of the user's notes, not
 * just one. This module is PURE (no network, no Supabase) — same split as `src/lib/chat/config.ts`:
 * caps, question validation, and the system prompt builder live here; `src/app/api/brain/route.ts`
 * does the retrieval (Postgres full-text search) and the actual `streamText` call.
 *
 * Retrieval strategy: Postgres full-text search (`search_vector`, `spanish` config — see migration
 * `20260713150000_search_vector.sql`), NOT semantic search. Same reasoning as
 * `src/lib/search/query.ts`: a FREE MVP with no new embeddings provider. Semantic search
 * (embeddings/pgvector) is the natural follow-up, documented in ROADMAP.md.
 *
 * PURE on purpose (no `@ai-sdk/groq` import here either) — same split as `src/lib/chat/config.ts`:
 * the route builds `groq(BRAIN_MODEL)` itself when calling `streamText`.
 */

/** Same model as the per-transcription chat (`CHAT_MODEL`, `src/lib/chat/config.ts`) — open-ended
 * conversation quality matters here too, and it's the model already proven for this app's chat UX. */
export const BRAIN_MODEL = "llama-3.3-70b-versatile";

/** How many notes the FTS retrieval brings back as candidate context per question — same order of
 * magnitude as `MAX_MERGE_NOTES`/10 (`src/lib/merge/validate.ts`), small enough that the model can
 * actually reason over all of them, large enough to cover "gather my ideas about Y" across a handful
 * of separate notes. */
export const RETRIEVAL_TOP_K = 8;

/** Cap on the combined context (all retrieved notes concatenated) sent to the model — same value and
 * same "hard cost/abuse defense" criteria as `MAX_CHAT_CONTEXT_INPUT_CHARS`/`MAX_MERGE_INPUT_CHARS`. */
export const MAX_BRAIN_CONTEXT_CHARS = 40_000;

/** Cap on a single question's length — same value and criteria as `MAX_CHAT_MESSAGE_CHARS`: a
 * legitimate question is short, a huge one is either a client bug or an abuse attempt. */
export const MAX_BRAIN_QUESTION_CHARS = 4_000;

/** Output token ceiling per answer — same value and criteria as `CHAT_MAX_OUTPUT_TOKENS`. */
export const BRAIN_MAX_OUTPUT_TOKENS = 2_048;

/** Minimum number of FTS retrieval results before also fetching the user's most recent notes as
 * extra candidate context (see `shouldFetchRecentFallback`/`mergeWithRecentNotes` in
 * `src/lib/brain/retrieval.ts`). This is a PALLIATIVE for FTS's keyword-matching limitation, not a
 * fix: `websearch_to_tsquery` only matches shared vocabulary, so a question like "cuántos audios de
 * test hice" finds nothing against a note that says "intento de grabación" even though the user's
 * notes could still answer it — falling back to recent notes when retrieval is sparse gives the model
 * something to reason over instead of a guaranteed "no encontré nada". The real fix is SEMANTIC
 * search (embeddings/pgvector), already tracked as a follow-up in `.claude/resources/ROADMAP.md`
 * under "Segundo cerebro" ("La búsqueda SEMÁNTICA (embeddings/pgvector) queda como follow-up"). */
export const MIN_RETRIEVAL_RESULTS_BEFORE_FALLBACK = 3;

/** true if `text` is a valid question to send to the Segundo cerebro: non-empty after trim and within
 * `MAX_BRAIN_QUESTION_CHARS`. Pure — called from the route BEFORE touching Supabase/Groq, same
 * criteria as `isValidChatMessageText`. */
export function isValidBrainQuestionText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_BRAIN_QUESTION_CHARS;
}

/**
 * Builds the system prompt for a Segundo cerebro answer: grounds the model STRICTLY in the retrieved
 * notes (anti-hallucination, same explicit "if it's not in the text, say so" rule as
 * `buildChatSystemPrompt`/`buildMergePrompt`) — this is the ONLY defense against the model answering
 * from its own general knowledge instead of the user's actual notes, since there's no other guardrail
 * between the retrieved context and the model's output.
 *
 * `contextText` is the ALREADY-CAPPED combined block of retrieved notes (see `buildBrainContext` in
 * `src/lib/brain/retrieval.ts`) — this function does not re-slice it, it only decides what to do when
 * it's empty: retrieval found NOTHING relevant, so the prompt instructs the model to say exactly that
 * instead of inventing an answer from thin air (still costs one Groq call, kept simple — see the
 * route's header comment for why this isn't special-cased into a non-LLM response).
 */
export function buildBrainSystemPrompt(contextText: string): string {
  if (!contextText.trim()) {
    return (
      "Sos un asistente que responde preguntas basándote ÚNICAMENTE en las notas de audio " +
      "transcriptas de la usuaria. Para esta pregunta no se encontró NINGUNA nota relacionada en su " +
      "archivo. Respondé con honestidad que no encontraste notas sobre ese tema — no inventes ni " +
      "supongas contenido. Respondé siempre en español, de forma breve y directa."
    );
  }

  return (
    "Sos un asistente que ayuda a una usuaria a explorar y recordar el contenido de SUS PROPIAS notas " +
    "de audio transcriptas (su \"segundo cerebro\"). Tu única fuente de información es el conjunto de " +
    "notas que te paso más abajo — cada una es un FRAGMENTO real de algo que ella grabó y transcribió " +
    "en un momento distinto. No inventes datos, nombres, cifras ni hechos que no estén en esas notas. " +
    "Si la pregunta no la responde ninguna nota de las que tenés abajo, decilo con honestidad en vez " +
    "de inventar o suponer — aunque el tema te resulte familiar por conocimiento general.\n\n" +
    "Podés: responder preguntas puntuales citando de qué nota sale la información (por título), juntar " +
    "ideas relacionadas que aparecen repartidas en varias notas, y señalar contradicciones entre notas " +
    "si las hay.\n\n" +
    "Respondé siempre en español, de forma clara y directa, sin tecnicismos innecesarios — quien te lee " +
    "no es técnica. Mantené las respuestas breves y al grano.\n\n" +
    "Notas encontradas (pueden no estar en orden de relevancia):\n" +
    '"""\n' +
    contextText +
    '\n"""'
  );
}
