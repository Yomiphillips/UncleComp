/**
 * LinkOn Core Service — library layout on the shared drive.
 *
 * One place that knows where things live, so the rest of the service never
 * hand-builds paths. Mirrors the store layout in ARCHITECTURE.md §4.
 *
 *   <libraryRoot>/
 *     library.json
 *     symbols/<symbolId>/
 *       package.aep  poster.png  preview.mp4  frames/
 */

import { path } from "../cep/node";

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

export const framesDir = (root: string, symbolId: string): string =>
  path.join(symbolDir(root, symbolId), "frames");

/** The sidecar that caches which symbols a working project uses (§5.3). */
export const registryPath = (projectPath: string): string => projectPath + ".linkon.json";

/** `file://` URL for showing library assets inside the panel's Chromium. */
export const fileUrl = (absolutePath: string): string =>
  "file:///" + absolutePath.replace(/\\/g, "/");
