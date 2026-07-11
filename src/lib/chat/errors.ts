const GENERIC_CHAT_ERROR_MESSAGE = "No pudimos generar la respuesta. Probá de nuevo.";

/**
 * Extrae un mensaje de error humano a partir del `Error` que lanza `useChat`/`DefaultChatTransport`
 * ante una respuesta HTTP no-2xx de `/api/chat`. El AI SDK arma ese `Error` con el BODY crudo de la
 * respuesta como `message` (`throw new Error(await response.text())`) — como el route devuelve JSON
 * (`NextResponse.json({ error: "..." })`, mismo formato que el resto de las rutas de esta app), acá
 * se intenta parsear ese JSON para mostrar el motivo REAL (ej. "Llegaste al límite diario...") en vez
 * de un genérico que no explica nada.
 *
 * Corrección del review adversarial (WARNING de UX): antes `chat-panel.tsx` mostraba el mismo
 * cartel genérico para CUALQUIER error, incluido el límite diario — la usuaria veía un botón
 * "Reintentar" que iba a fallar exactamente igual, sin entender por qué.
 *
 * Si el mensaje no es JSON parseable, o no tiene la forma esperada, se cae al genérico — nunca se
 * muestra el `message` crudo tal cual (podría ser HTML de un error 5xx de infraestructura, o texto
 * de un fallo de red sin sentido para la usuaria).
 */
export function parseChatErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || !error.message) return GENERIC_CHAT_ERROR_MESSAGE;

  try {
    const parsed: unknown = JSON.parse(error.message);
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string" &&
      (parsed as { error: string }).error.trim()
    ) {
      return (parsed as { error: string }).error;
    }
  } catch {
    /* `error.message` no era JSON (ej. fallo de red) — se usa el genérico. */
  }

  return GENERIC_CHAT_ERROR_MESSAGE;
}
