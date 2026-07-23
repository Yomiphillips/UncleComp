/**
 * UncleComp Core Service — library layout on the shared drive.
 *
 * One place that knows where things live, so the rest of the service never
 * hand-builds paths. Mirrors the store layout in ARCHITECTURE.md §4.
 *
 *   <libraryRoot>/
 *     library.json
 *     symbols/<symbolId>/
 *       package.aep  poster.png  preview.mp4
 */

import { fs, path } from "../cep/node";

/** Node is only available inside a CEP panel (`--enable-nodejs`). */
export const isCEP = (): boolean => typeof window !== "undefined" && !!(window as any).cep;

export const manifestPath = (root: string): string => path.join(root, "library.json");

export const symbolsDir = (root: string): string => path.join(root, "symbols");

export const symbolDir = (root: string, symbolId: string): string =>
  path.join(root, "symbols", symbolId);

export const packagePath = (root: string, symbolId: string): string =>
  path.join(symbolDir(root, symbolId), "package.aep");

export const posterPath = (root: string, symbolId: string): string =>
  path.join(symbolDir(root, symbolId), "poster.png");

export const previewPath = (root: string, symbolId: string): string =>
  path.join(symbolDir(root, symbolId), "preview.mp4");

/** The sidecar that caches which symbols a working project uses (§5.3). */
export const registryPath = (projectPath: string): string => projectPath + ".unclecomp.json";

/** `file://` URL for showing library assets inside the panel's Chromium. */
export const fileUrl = (absolutePath: string): string =>
  "file:///" + absolutePath.replace(/\\/g, "/");

const MIME: { [ext: string]: string } = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4",
};

/**
 * Loadable URL for a library asset — use this for posters and previews, not `fileUrl`.
 *
 * A `file://` URL only resolves when the panel page is itself served from
 * `file://`, i.e. the built extension. Under `npm run dev` the page origin is
 * `http://localhost:3000`, and Chromium blocks `file://` subresources from an
 * http origin, so every thumbnail and preview silently fails to load. Reading the
 * bytes through Node and handing back a blob URL works in both modes.
 *
 * Blob URLs also sidestep caching: a republished symbol overwrites poster.png at
 * the same path, and an identical `file://` URL can otherwise serve the stale
 * frame. Callers must revoke the URL when done — see SymbolCard.
 */
export const assetUrl = (absolutePath: string): string => {
  if (!absolutePath) return "";
  if (!isCEP()) return fileUrl(absolutePath);
  try {
    if (!fs.existsSync(absolutePath)) return "";
    const bytes = fs.readFileSync(absolutePath);
    const dot = absolutePath.lastIndexOf(".");
    const ext = dot > -1 ? absolutePath.slice(dot).toLowerCase() : "";
    // Copy into a plain Uint8Array — a Node Buffer isn't a valid BlobPart.
    const blob = new Blob([new Uint8Array(bytes)], {
      type: MIME[ext] || "application/octet-stream",
    });
    return URL.createObjectURL(blob);
  } catch {
    return ""; // a missing preview must never take the card down
  }
};

export const revokeAssetUrl = (url: string): void => {
  if (url && url.indexOf("blob:") === 0) URL.revokeObjectURL(url);
};
