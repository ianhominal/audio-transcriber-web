import { describe, expect, it } from "vitest";
import { FILE_ACCEPT, SUPPORTED_EXTENSIONS } from "./accept";

/**
 * Regression tests for a real mobile bug: on Android the file picker offered ONLY "Camera
 * Camcorder" and "Photos & videos", with no way to browse for an audio file. The `accept`
 * attribute listed extensions only (".mp3,.wav,..."), and Chrome on Android maps `accept` to MIME
 * types to build the picker intent — bare extensions resolve to nothing, and the video extensions
 * (.mp4/.webm/.mpeg) made it infer "video", hence the camera-and-gallery picker.
 */
describe("FILE_ACCEPT", () => {
  it("includes the audio/* MIME wildcard so Android offers a real file browser", () => {
    // The single most important entry: without a MIME type, Android has nothing to resolve.
    expect(FILE_ACCEPT.split(",")).toContain("audio/*");
  });

  it("includes MIME types for the video containers Whisper accepts", () => {
    // Whisper extracts audio from these, so they must stay selectable — but declared as MIME
    // types, not as bare extensions.
    const entries = FILE_ACCEPT.split(",");
    expect(entries).toContain("video/mp4");
    expect(entries).toContain("video/mpeg");
    expect(entries).toContain("video/webm");
  });

  it("still lists every supported extension, for desktop browsers that filter by them", () => {
    const entries = FILE_ACCEPT.split(",");
    for (const ext of SUPPORTED_EXTENSIONS) {
      expect(entries).toContain(ext);
    }
  });

  it("puts MIME types before extensions", () => {
    // Android reads the list in order; leading with MIME types keeps the resolved intent broad.
    const entries = FILE_ACCEPT.split(",");
    const lastMime = entries.findLastIndex((e) => e.includes("/"));
    const firstExtension = entries.findIndex((e) => e.startsWith("."));
    expect(lastMime).toBeLessThan(firstExtension);
  });

  it("has no duplicate or empty entries", () => {
    const entries = FILE_ACCEPT.split(",");
    expect(entries).not.toContain("");
    expect(new Set(entries).size).toBe(entries.length);
  });

  it("keeps the extensions Groq documents as supported", () => {
    // Guard against someone trimming the list: these are the formats the API takes natively.
    expect(SUPPORTED_EXTENSIONS).toEqual([
      ".mp3", ".wav", ".ogg", ".opus", ".m4a", ".mp4",
      ".mpeg", ".mpga", ".flac", ".webm",
    ]);
  });
});
