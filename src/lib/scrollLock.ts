/**
 * Bloqueo de scroll del body con contador de referencias.
 *
 * El drawer mobile (`dashboard-shell.tsx`) y el `Modal` (`components/ui/Modal.tsx`) pueden
 * anidarse: en mobile es normal abrir un Modal (ej. "Nueva carpeta") desde dentro del sidebar que
 * vive en el drawer. Si cada uno escribiera `document.body.style.overflow` de forma
 * independiente, cerrar el que se abrió último podría restaurar el scroll aunque el otro siga
 * abierto (o viceversa, según el orden de montaje/desmontaje). Este contador evita tener que
 * razonar ese orden: el scroll solo se restaura cuando el ÚLTIMO lock activo se libera.
 */
let lockCount = 0;
let previousOverflow = "";

export function lockBodyScroll(): () => void {
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount++;

  let released = false;
  return function unlock() {
    if (released) return; // evita descontar dos veces si el cleanup corre más de una vez
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = previousOverflow;
    }
  };
}
