import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildMultipartBody,
  getAccessToken,
  getStartPageToken,
  listChanges,
  createFolder,
  listFolderChildren,
  isDriveFolder,
  uploadFile,
  updateFile,
  getFileContent,
  trashFile,
  deleteFile,
} from "./api";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 400);
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/** `URLSearchParams` codifica el espacio como `+`, no `%20` — decodificar ambos para comparar el `q` legible. */
function decodeUrlQuery(url: string): string {
  return decodeURIComponent(url.replace(/\+/g, " "));
}

function textResponse(body: string, init: { ok?: boolean; status?: number } = {}): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 400);
  return { ok, status, text: async () => body, json: async () => ({}) } as Response;
}

describe("buildMultipartBody", () => {
  it("incluye parents en el metadata cuando se pasa", () => {
    const { body } = buildMultipartBody({
      name: "Nota.md",
      mimeType: "text/markdown",
      content: "hola",
      parents: ["folder-1"],
      boundary: "B",
    });
    expect(body).toContain('"parents":["folder-1"]');
    expect(body).toContain('"name":"Nota.md"');
  });

  it("omite name cuando no se pasa (caso updateFile, solo contenido)", () => {
    const { body } = buildMultipartBody({ mimeType: "text/markdown", content: "hola", boundary: "B" });
    expect(body).not.toContain('"name"');
    expect(body).toContain('"mimeType":"text/markdown"');
  });
});

describe("cliente Drive API (fetch mockeado)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getAccessToken", () => {
    it("renueva el access token con grant_type=refresh_token", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "AT123" }));
      const token = await getAccessToken("refresh-token", "client-id", "client-secret");
      expect(token).toBe("AT123");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://oauth2.googleapis.com/token");
      const bodyParams = new URLSearchParams(init.body as string);
      expect(bodyParams.get("grant_type")).toBe("refresh_token");
      expect(bodyParams.get("refresh_token")).toBe("refresh-token");
    });

    it("lanza DriveApiError con code='invalid_grant' si el refresh token fue revocado", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: "invalid_grant", error_description: "Token expirado" }, { ok: false, status: 400 })
      );
      await expect(getAccessToken("bad", "id", "secret")).rejects.toMatchObject({
        code: "invalid_grant",
      });
    });
  });

  describe("getStartPageToken", () => {
    it("devuelve el startPageToken", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ startPageToken: "12345" }));
      const token = await getStartPageToken("AT");
      expect(token).toBe("12345");
      expect(fetchMock.mock.calls[0][0]).toContain("/changes/startPageToken");
    });
  });

  describe("listChanges", () => {
    it("pagina con pageToken y devuelve changes + cursores", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          changes: [{ fileId: "f1", removed: false, file: { name: "a.md", md5Checksum: "abc" } }],
          nextPageToken: "next",
          newStartPageToken: undefined,
        })
      );
      const result = await listChanges("AT", "cursor-1");
      expect(result.changes).toHaveLength(1);
      expect(result.nextPageToken).toBe("next");
      expect(result.newStartPageToken).toBeNull();
      expect(fetchMock.mock.calls[0][0]).toContain("pageToken=cursor-1");
    });
  });

  describe("createFolder", () => {
    it("hace POST con mimeType de carpeta y parents opcional", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: "folder-1", name: "Audio Transcriber" }));
      const folder = await createFolder("AT", "Audio Transcriber");
      expect(folder).toEqual({ id: "folder-1", name: "Audio Transcriber" });

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.mimeType).toBe("application/vnd.google-apps.folder");
      expect(body.parents).toBeUndefined();
    });
  });

  describe("listFolderChildren", () => {
    it("arma el query q con el folderId y filtra trashed=false", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ files: [{ id: "f1", name: "audio1.ogg", mimeType: "audio/ogg" }] })
      );
      const children = await listFolderChildren("AT", "folder-1");
      expect(children).toEqual([{ id: "f1", name: "audio1.ogg", mimeType: "audio/ogg" }]);

      const url = fetchMock.mock.calls[0][0] as string;
      expect(decodeUrlQuery(url)).toContain("q='folder-1' in parents and trashed = false");
    });

    it("incluye subcarpetas junto con archivos en el mismo listado", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          files: [
            { id: "sub-1", name: "Semana 1", mimeType: "application/vnd.google-apps.folder" },
            { id: "f1", name: "audio1.ogg", mimeType: "audio/ogg" },
          ],
        })
      );
      const children = await listFolderChildren("AT", "folder-1");
      expect(children).toHaveLength(2);
      expect(isDriveFolder(children[0])).toBe(true);
      expect(isDriveFolder(children[1])).toBe(false);
    });

    it("pagina hasta agotar nextPageToken y junta todos los hijos", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ files: [{ id: "f1", name: "a", mimeType: "audio/ogg" }], nextPageToken: "p2" }))
        .mockResolvedValueOnce(jsonResponse({ files: [{ id: "f2", name: "b", mimeType: "audio/ogg" }] }));

      const children = await listFolderChildren("AT", "folder-1");
      expect(children.map((c) => c.id)).toEqual(["f1", "f2"]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toContain("pageToken=p2");
    });

    it("escapa comillas simples del folderId en el query q", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ files: [] }));
      await listFolderChildren("AT", "folder'raro");
      const url = fetchMock.mock.calls[0][0] as string;
      expect(decodeUrlQuery(url)).toContain("q='folder\\'raro' in parents and trashed = false");
    });
  });

  describe("uploadFile / updateFile", () => {
    it("uploadFile sube con parents=[folderId] y devuelve md5Checksum/modifiedTime", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ id: "file-1", name: "Nota.md", md5Checksum: "abc123", modifiedTime: "2026-07-07T00:00:00Z" })
      );
      const result = await uploadFile("AT", "folder-1", "Nota.md", "text/markdown", "contenido");
      expect(result.id).toBe("file-1");
      expect(result.md5Checksum).toBe("abc123");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("uploadType=multipart");
      expect(init.body as string).toContain('"parents":["folder-1"]');
    });

    it("updateFile hace PATCH sobre el fileId sin renombrar", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: "file-1", name: "Nota.md", md5Checksum: "def456" }));
      const result = await updateFile("AT", "file-1", "contenido nuevo");
      expect(result.md5Checksum).toBe("def456");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("/files/file-1");
      expect(init.method).toBe("PATCH");
    });
  });

  describe("getFileContent", () => {
    it("baja el contenido con alt=media", async () => {
      fetchMock.mockResolvedValueOnce(textResponse("# contenido del archivo"));
      const content = await getFileContent("AT", "file-1");
      expect(content).toBe("# contenido del archivo");
      expect(fetchMock.mock.calls[0][0]).toContain("alt=media");
    });
  });

  describe("trashFile / deleteFile", () => {
    it("trashFile hace PATCH con trashed:true", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await trashFile("AT", "file-1");
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body as string)).toEqual({ trashed: true });
    });

    it("deleteFile hace DELETE", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await deleteFile("AT", "file-1");
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe("DELETE");
    });
  });

  describe("manejo de errores", () => {
    it("lanza DriveApiError con el mensaje de Google en un 404", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { message: "File not found." } }, { ok: false, status: 404 })
      );
      await expect(getFileContent("AT", "no-existe")).rejects.toMatchObject({
        name: "DriveApiError",
        message: "File not found.",
        status: 404,
      });
    });

    it("reintenta con backoff en 429 (rateLimitExceeded) y termina OK", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ error: { message: "Rate limit", errors: [{ reason: "rateLimitExceeded" }] } }, { ok: false, status: 429 })
        )
        .mockResolvedValueOnce(jsonResponse({ startPageToken: "999" }));

      const token = await getStartPageToken("AT");
      expect(token).toBe("999");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("no reintenta un 400 normal (no es de cuota)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "Bad request" } }, { ok: false, status: 400 }));
      await expect(getStartPageToken("AT")).rejects.toThrow("Bad request");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
