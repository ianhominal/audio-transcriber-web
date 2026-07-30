import { describe, expect, it } from "vitest";
import { shouldExportAudioToDrive, driveMimeTypeForAudio } from "./audio-export";

/**
 * Uploading the audio to Drive closes the loop the other direction: importing a Drive folder already
 * brings its recordings in (see `tree.ts`), but an audio created inside the app never travelled back,
 * so a connected folder ended up holding notes and no recordings.
 */
describe("shouldExportAudioToDrive", () => {
  it("exports when the project lives under a connected Drive folder", () => {
    expect(
      shouldExportAudioToDrive({ driveFolderId: "folder-1", driveAudioFileId: null, storagePath: "u/1.m4a" })
    ).toBe(true);
  });

  it("does not export when the project is not connected to Drive", () => {
    expect(
      shouldExportAudioToDrive({ driveFolderId: null, driveAudioFileId: null, storagePath: "u/1.m4a" })
    ).toBe(false);
  });

  it("does not re-upload an audio that CAME from Drive", () => {
    // This is what stops the loop: a recording imported from Drive already carries its file id, so
    // sending it back would create a duplicate next to the original on every run.
    expect(
      shouldExportAudioToDrive({ driveFolderId: "folder-1", driveAudioFileId: "drive-file-9", storagePath: "u/1.m4a" })
    ).toBe(false);
  });

  it("does not export when there is no stored audio to read", () => {
    // A text-only note has no audio at all; nothing to send.
    expect(shouldExportAudioToDrive({ driveFolderId: "folder-1", driveAudioFileId: null, storagePath: null })).toBe(
      false
    );
    expect(shouldExportAudioToDrive({ driveFolderId: "folder-1", driveAudioFileId: null, storagePath: "" })).toBe(
      false
    );
  });
});

describe("driveMimeTypeForAudio", () => {
  it("maps the formats the app accepts", () => {
    expect(driveMimeTypeForAudio("charla.mp3")).toBe("audio/mpeg");
    expect(driveMimeTypeForAudio("charla.m4a")).toBe("audio/mp4");
    expect(driveMimeTypeForAudio("charla.wav")).toBe("audio/wav");
    expect(driveMimeTypeForAudio("charla.ogg")).toBe("audio/ogg");
    expect(driveMimeTypeForAudio("charla.opus")).toBe("audio/opus");
    expect(driveMimeTypeForAudio("charla.flac")).toBe("audio/flac");
    expect(driveMimeTypeForAudio("charla.webm")).toBe("audio/webm");
    expect(driveMimeTypeForAudio("charla.mp4")).toBe("video/mp4");
  });

  it("ignores the case of the extension", () => {
    expect(driveMimeTypeForAudio("GRABACION.M4A")).toBe("audio/mp4");
  });

  it("falls back to a generic binary type for anything unknown", () => {
    // Drive accepts the upload either way; a wrong specific type would be worse than an honest
    // generic one, because Drive uses it to decide previews.
    expect(driveMimeTypeForAudio("raro.xyz")).toBe("application/octet-stream");
    expect(driveMimeTypeForAudio("sin-extension")).toBe("application/octet-stream");
  });
});
