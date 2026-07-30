import { describe, expect, it } from "vitest";
import { parseDriveFolderId } from "./folder-link";

/**
 * Pasting a Drive folder link is the ONLY way to reach a folder someone shared with you: the folder
 * browser walks down from `root` ("My Drive"), and shared folders are not children of root — they
 * live under "Shared with me". So this parser is not a convenience, it is an access path.
 *
 * Everything here is pure string work: verifying the id actually IS a reachable folder is the
 * server's job (see /api/drive/folders).
 */
describe("parseDriveFolderId", () => {
  it("reads the canonical folder URL", () => {
    expect(parseDriveFolderId("https://drive.google.com/drive/folders/1a2B3c4D5e6F7g8H9i")).toBe(
      "1a2B3c4D5e6F7g8H9i"
    );
  });

  it("ignores the sharing query string Drive appends when you copy a link", () => {
    // This is literally what the "Copy link" button gives you.
    expect(
      parseDriveFolderId("https://drive.google.com/drive/folders/1a2B3c4D5e6F7g8H9i?usp=sharing")
    ).toBe("1a2B3c4D5e6F7g8H9i");
    expect(
      parseDriveFolderId("https://drive.google.com/drive/folders/1a2B3c4D5e6F7g8H9i?usp=drive_link")
    ).toBe("1a2B3c4D5e6F7g8H9i");
  });

  it("handles the multi-account /u/<n>/ form", () => {
    // Anyone signed into more than one Google account copies links shaped like this.
    expect(
      parseDriveFolderId("https://drive.google.com/drive/u/0/folders/1a2B3c4D5e6F7g8H9i")
    ).toBe("1a2B3c4D5e6F7g8H9i");
    expect(
      parseDriveFolderId("https://drive.google.com/drive/u/3/folders/1a2B3c4D5e6F7g8H9i")
    ).toBe("1a2B3c4D5e6F7g8H9i");
  });

  it("reads the legacy ?id= form", () => {
    expect(parseDriveFolderId("https://drive.google.com/open?id=1a2B3c4D5e6F7g8H9i")).toBe(
      "1a2B3c4D5e6F7g8H9i"
    );
    expect(
      parseDriveFolderId("https://drive.google.com/drive/folders/x?id=1a2B3c4D5e6F7g8H9i")
    ).toBe("x");
  });

  it("accepts a bare id, so pasting just the id also works", () => {
    expect(parseDriveFolderId("1a2B3c4D5e6F7g8H9i")).toBe("1a2B3c4D5e6F7g8H9i");
  });

  it("trims surrounding whitespace from a pasted value", () => {
    expect(parseDriveFolderId("  https://drive.google.com/drive/folders/1a2B3c4D5e6F7g8H9i \n")).toBe(
      "1a2B3c4D5e6F7g8H9i"
    );
    expect(parseDriveFolderId("  1a2B3c4D5e6F7g8H9i  ")).toBe("1a2B3c4D5e6F7g8H9i");
  });

  it("keeps ids containing - and _, which Drive uses", () => {
    expect(parseDriveFolderId("https://drive.google.com/drive/folders/1a-2B_3c4D5e")).toBe(
      "1a-2B_3c4D5e"
    );
  });

  it("returns null for empty or blank input", () => {
    expect(parseDriveFolderId("")).toBeNull();
    expect(parseDriveFolderId("   ")).toBeNull();
  });

  it("returns null for a link to a FILE instead of a folder", () => {
    // A document link would otherwise resolve to an id that is not a folder; better to reject it
    // here with a clear message than to let the server fail on it.
    expect(parseDriveFolderId("https://drive.google.com/file/d/1a2B3c4D5e/view")).toBeNull();
    expect(parseDriveFolderId("https://docs.google.com/document/d/1a2B3c4D5e/edit")).toBeNull();
  });

  it("returns null for anything that is not a Drive link", () => {
    expect(parseDriveFolderId("https://example.com/drive/folders/1a2B3c")).toBeNull();
    expect(parseDriveFolderId("no soy un link")).toBeNull();
    expect(parseDriveFolderId("https://drive.google.com/drive/my-drive")).toBeNull();
  });

  it("refuses the root alias, which would mean importing the entire Drive", () => {
    // Same guard as canConnectFolderLevel: connecting "root" would pull in everything.
    expect(parseDriveFolderId("root")).toBeNull();
    expect(parseDriveFolderId("https://drive.google.com/drive/folders/root")).toBeNull();
  });
});
