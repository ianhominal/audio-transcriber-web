/**
 * Turns a pasted Google Drive folder link (or a bare id) into a folder id.
 *
 * This exists because of a real gap, not just for convenience: the folder browser in Ajustes walks
 * DOWN from `root` ("My Drive", see /api/drive/folders), and a folder someone shared with you is not
 * a child of root — it lives under "Shared with me". So browsing can never reach it. Pasting the
 * link is the only path to those folders.
 *
 * Pure string work, no I/O. Whether the id is reachable AND actually a folder is decided server-side
 * by the Drive API — this only rejects what is obviously not a folder link, so the user gets an
 * instant, specific message instead of a round trip that fails.
 */

import { DRIVE_ROOT_ID } from "./folder-connect";

/**
 * Drive ids are URL-safe base64-ish: letters, digits, `-` and `_`. Length varies by vintage (older
 * ids are shorter), so no length check — an id that looks right but does not exist is the server's
 * problem to report, and guessing a minimum here would reject legitimate old folders.
 */
const DRIVE_ID = /^[A-Za-z0-9_-]+$/;

/** Host allowlist: a `drive.google.com`-looking path on someone else's domain is not a Drive link. */
const DRIVE_HOSTS = new Set(["drive.google.com"]);

/**
 * Returns the folder id, or `null` when the input is not a usable Drive FOLDER reference (empty, a
 * file/doc link, another site, or the root alias — connecting root would import the whole Drive,
 * same guard as `canConnectFolderLevel`).
 */
export function parseDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Not a URL: treat it as a bare id pasted by hand.
  if (!/^https?:\/\//i.test(trimmed)) {
    return isUsableId(trimmed) ? trimmed : null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (!DRIVE_HOSTS.has(url.hostname.toLowerCase())) return null;

  // `/drive/folders/<id>` and `/drive/u/<n>/folders/<id>`. Reading the segment AFTER "folders" (as
  // opposed to matching a whole path) is what makes the `/u/<n>/` variant work for free — anyone
  // signed into several Google accounts copies links in that shape.
  const segments = url.pathname.split("/").filter(Boolean);
  const foldersAt = segments.indexOf("folders");
  if (foldersAt !== -1) {
    const candidate = segments[foldersAt + 1];
    return candidate && isUsableId(candidate) ? candidate : null;
  }

  // Legacy `?id=<id>` form (still what some "share" dialogs and old bookmarks produce).
  const queryId = url.searchParams.get("id");
  if (queryId && isUsableId(queryId)) return queryId;

  // Anything else on drive.google.com (a `/file/d/<id>/view`, `/drive/my-drive`, …) is not a folder.
  return null;
}

function isUsableId(value: string): boolean {
  return value !== DRIVE_ROOT_ID && DRIVE_ID.test(value);
}
