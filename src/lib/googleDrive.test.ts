import { describe, it, expect } from "vitest";
import { buildDriveMultipartUpload } from "./googleDrive";

describe("buildDriveMultipartUpload", () => {
  it("arma el multipart/related con metadata JSON + contenido, boundary fijo para el test", () => {
    const req = buildDriveMultipartUpload({
      fileName: "Nota.md",
      mimeType: "text/markdown",
      content: "# Hola\n\nMundo.",
      boundary: "TESTBOUNDARY",
    });

    expect(req.url).toBe("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart");
    expect(req.headers).toEqual({
      "Content-Type": "multipart/related; boundary=TESTBOUNDARY",
    });
    expect(req.body).toBe(
      [
        "--TESTBOUNDARY",
        "Content-Type: application/json; charset=UTF-8",
        "",
        '{"name":"Nota.md","mimeType":"text/markdown"}',
        "--TESTBOUNDARY",
        "Content-Type: text/markdown",
        "",
        "# Hola\n\nMundo.",
        "--TESTBOUNDARY--",
      ].join("\r\n")
    );
  });

  it("escapa comillas dobles del nombre de archivo dentro del JSON de metadata", () => {
    const req = buildDriveMultipartUpload({
      fileName: 'Reunión "importante".md',
      mimeType: "text/markdown",
      content: "x",
      boundary: "B",
    });
    expect(req.body).toContain('"name":"Reunión \\"importante\\".md"');
  });

  it("genera un boundary distinto por llamado cuando no se pasa uno explícito", () => {
    const a = buildDriveMultipartUpload({ fileName: "a.md", mimeType: "text/markdown", content: "x" });
    const b = buildDriveMultipartUpload({ fileName: "a.md", mimeType: "text/markdown", content: "x" });
    const boundaryOf = (req: { headers: Record<string, string> }) =>
      req.headers["Content-Type"].split("boundary=")[1];
    expect(boundaryOf(a)).not.toBe(boundaryOf(b));
  });
});
