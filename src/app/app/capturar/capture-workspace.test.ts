import { describe, it, expect } from "vitest";
import { statusAnnouncement } from "./capture-workspace";

// `capture-workspace.tsx` es un componente cliente (requiere DOM) y el proyecto usa Vitest solo
// para lógica pura (environment "node" — UI/flujos van por Playwright, ver vitest.config.mts). Acá
// se testea la ÚNICA pieza de lógica pura que expone: el texto de la región `aria-live` que anuncia
// cada fase de la captura sin fricción a un lector de pantalla.
describe("statusAnnouncement", () => {
  it("anuncia cada fase con un texto fijo (no depende de segundos)", () => {
    expect(statusAnnouncement("requesting", "")).toBe("Pidiendo permiso de micrófono.");
    expect(statusAnnouncement("recording", "")).toBe("Grabando.");
    expect(statusAnnouncement("uploading", "")).toBe("Transcribiendo tu idea.");
    expect(statusAnnouncement("done", "")).toBe("Listo, quedó guardada.");
  });

  it("en fase 'recording' NO cambia con el tiempo — evita que un lector de pantalla reanuncie cada segundo (review adversarial, hallazgo MEDIUM)", () => {
    // Antes esta función tomaba `seconds` y lo embebía en el texto ("Grabando, 0:05.") — el string
    // cambiaba en cada tick del cronómetro (cada 1000ms mientras graba), y una región
    // `aria-live="assertive"` volvía a interrumpir/anunciar en cada cambio. El fix fue sacar
    // `seconds` de la firma: llamar dos veces con la misma fase debe dar SIEMPRE el mismo string.
    expect(statusAnnouncement("recording", "")).toBe(statusAnnouncement("recording", ""));
  });

  // Fase agregada junto con la biblioteca del dispositivo (`src/lib/recordings/`): entre "Detener"
  // y la subida ahora hay una escritura a IndexedDB, y esa espera tiene que anunciarse — si no, un
  // lector de pantalla se queda mudo justo en el momento en que se está poniendo el audio a salvo.
  it("anuncia el guardado en el dispositivo como una fase propia, distinta de la subida", () => {
    expect(statusAnnouncement("saving", "")).toBe("Guardando la grabación en el dispositivo.");
    expect(statusAnnouncement("saving", "")).not.toBe(statusAnnouncement("uploading", ""));
  });

  it("en fase 'error' devuelve el mensaje recibido, o un fallback genérico si viene vacío", () => {
    expect(statusAnnouncement("error", "Permiso de micrófono denegado.")).toBe("Permiso de micrófono denegado.");
    expect(statusAnnouncement("error", "")).toBe("Ocurrió un error.");
  });
});
