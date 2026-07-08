import { describe, it, expect } from "vitest";
import { canConnectFolderLevel, validateNewFolderName, DRIVE_ROOT_ID } from "./folder-connect";

describe("canConnectFolderLevel", () => {
  it("no permite conectar la raíz 'Mi unidad' (importaría todo el Drive)", () => {
    expect(canConnectFolderLevel(DRIVE_ROOT_ID)).toBe(false);
    expect(canConnectFolderLevel("root")).toBe(false);
  });

  it("permite conectar cualquier carpeta puntual (id distinto de root)", () => {
    expect(canConnectFolderLevel("folder-123")).toBe(true);
    expect(canConnectFolderLevel("")).toBe(true); // defensivo: solo "root" está bloqueado
  });
});

describe("validateNewFolderName", () => {
  it("rechaza vacíos o solo espacios", () => {
    expect(validateNewFolderName("")).toEqual({ ok: false, error: "El nombre no puede estar vacío." });
    expect(validateNewFolderName("   ")).toEqual({ ok: false, error: "El nombre no puede estar vacío." });
  });

  it("recorta espacios y acepta nombres válidos", () => {
    expect(validateNewFolderName("  Notas de la semana  ")).toEqual({ ok: true, value: "Notas de la semana" });
  });

  it("rechaza nombres demasiado largos (>60)", () => {
    const largo = "a".repeat(61);
    expect(validateNewFolderName(largo)).toEqual({
      ok: false,
      error: "El nombre no puede superar los 60 caracteres.",
    });
  });
});
