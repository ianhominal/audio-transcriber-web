import { splitSpeakerBlocks } from "@/lib/polish/speakers";
import { assignSpeakerColors } from "@/lib/transcript/speakerColor";

/**
 * Vista "Leer" de una transcripción: el texto como DOCUMENTO, no como un `<textarea>`.
 *
 * Dos formas, según qué haya en el texto:
 * - Con hablantes (transcripción diarizada del desktop, etiquetas "Persona N:" — ver
 *   `splitSpeakerBlocks`): cada turno va con su nombre en color y su párrafo. Seguir quién dice qué
 *   en una reunión deja de ser imposible.
 * - Sin hablantes (una nota normal, o una transcripción grabada en la web, que no trae etiquetas):
 *   documento plano, igual de legible — serif, ancho de lectura acotado, interlineado generoso.
 *
 * Puramente presentación: NO edita ni guarda nada. La edición sigue siendo el `<textarea>` de
 * siempre (ver el toggle Leer/Editar en `transcription-detail.tsx`), a propósito — el texto tiene
 * que poder volver a texto plano para pulir, aplicar formatos y chatear, y un editor rich-text
 * (contenteditable) sobre 60-180 mil caracteres es un pozo de bugs que no vale la pena acá.
 */
export function TranscriptReader({ text }: { text: string }) {
  const blocks = splitSpeakerBlocks(text);

  if (!blocks) {
    return (
      <div className="mx-auto max-w-[65ch] whitespace-pre-wrap font-serif text-lg leading-[1.85] text-foreground [text-wrap:pretty]">
        {text}
      </div>
    );
  }

  const colors = assignSpeakerColors(blocks.map((b) => b.label));

  return (
    <div className="mx-auto max-w-[65ch]">
      {blocks.map((block, i) => (
        <div key={i} className="mb-7 last:mb-0">
          <div
            className={`mb-1.5 text-xs font-semibold uppercase tracking-wide ${
              colors.get(block.label) ?? "text-tertiary"
            }`}
          >
            {block.label}
          </div>
          <p className="whitespace-pre-wrap font-serif text-lg leading-[1.85] text-foreground [text-wrap:pretty]">
            {block.text}
          </p>
        </div>
      ))}
    </div>
  );
}
