import { describe, it, expect } from "vitest";
import type { UIMessage } from "ai";
import { resolveChatRequestConfig } from "./scope";

const message: UIMessage = {
  id: "msg-1",
  role: "user",
  parts: [{ type: "text", text: "¿De qué habla esto?" }],
};

describe("resolveChatRequestConfig", () => {
  it("scope 'note' con transcriptionId devuelve /api/chat con transcriptionId y message", () => {
    const config = resolveChatRequestConfig("note", "trans-1", message);
    expect(config.api).toBe("/api/chat");
    expect(config.body).toEqual({ transcriptionId: "trans-1", message });
  });

  it("scope 'all' devuelve /api/brain con solo message, sin transcriptionId en el body", () => {
    const config = resolveChatRequestConfig("all", undefined, message);
    expect(config.api).toBe("/api/brain");
    expect(config.body).toEqual({ message });
    expect(Object.prototype.hasOwnProperty.call(config.body, "transcriptionId")).toBe(false);
  });

  it("scope 'all' ignora un transcriptionId pasado igual — nunca aparece en el body", () => {
    const config = resolveChatRequestConfig("all", "trans-1", message);
    expect(config.api).toBe("/api/brain");
    expect(config.body).toEqual({ message });
    expect(Object.prototype.hasOwnProperty.call(config.body, "transcriptionId")).toBe(false);
  });

  it("scope 'note' sin transcriptionId lanza", () => {
    expect(() => resolveChatRequestConfig("note", undefined, message)).toThrow(
      "Chat scope 'note' requires a transcriptionId."
    );
  });

  it("scope 'project' con projectId devuelve /api/brain con message y projectId en el body", () => {
    const config = resolveChatRequestConfig("project", undefined, message, "proj-1");
    expect(config.api).toBe("/api/brain");
    expect(config.body).toEqual({ message, projectId: "proj-1" });
  });

  it("scope 'project' ignora un transcriptionId pasado igual — nunca aparece en el body", () => {
    const config = resolveChatRequestConfig("project", "trans-1", message, "proj-1");
    expect(config.api).toBe("/api/brain");
    expect(config.body).toEqual({ message, projectId: "proj-1" });
    expect(Object.prototype.hasOwnProperty.call(config.body, "transcriptionId")).toBe(false);
  });

  it("scope 'project' sin projectId lanza", () => {
    expect(() => resolveChatRequestConfig("project", undefined, message)).toThrow(
      "Chat scope 'project' requires a projectId."
    );
  });

  it("scope 'all' sin projectId sigue devolviendo solo message, sin cambios", () => {
    const config = resolveChatRequestConfig("all", undefined, message, "proj-1");
    expect(config.api).toBe("/api/brain");
    expect(config.body).toEqual({ message });
    expect(Object.prototype.hasOwnProperty.call(config.body, "projectId")).toBe(false);
  });
});
