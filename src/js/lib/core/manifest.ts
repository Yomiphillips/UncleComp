/**
 * UncleComp Core Service — the library manifest.
 *
 * `library.json` is the source of truth for what symbols exist and at what
 * version. It lives on a shared network drive, so every write goes through
 * `writeManifest` (temp file + rename) — a partially written manifest must never
 * be observable by a teammate mid-publish. spike/node/fs-watch-test.js validated
 * this on this machine.
 *
 * Publish *locking* is Phase 2 (ARCHITECTURE.md §9); today two simultaneous
 * publishers are detected after the fact via version/hash, not prevented.
 */

import { fs, path } from "../cep/node";
import { LibraryManifest, SymbolMeta } from "../../../shared/unclecomp-types";
import { manifestPath, symbolDir, symbolsDir } from "./paths";

export const emptyManifest = (): LibraryManifest => ({ version: 1, symbols: {} });

export const ensureLibrary = (root: string): void => {
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  if (!fs.existsSync(symbolsDir(root))) fs.mkdirSync(symbolsDir(root), { recursive: true });
  if (!fs.existsSync(manifestPath(root))) writeManifest(root, emptyManifest());
};

export const readManifest = (root: string): LibraryManifest => {
  const file = manifestPath(root);
  if (!fs.existsSync(file)) return emptyManifest();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as LibraryManifest;
    if (!parsed || typeof parsed !== "object" || !parsed.symbols) return emptyManifest();
    return parsed;
  } catch {
    // A corrupt manifest must not take the panel down; surface an empty library.
    return emptyManifest();
  }
};

/** Atomic: write a sibling temp file, then rename over the target. */
export const writeManifest = (root: string, manifest: LibraryManifest): void => {
  const file = manifestPath(root);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf8");
  fs.renameSync(tmp, file);
};

export const upsertSymbol = (root: string, meta: SymbolMeta): LibraryManifest => {
  const manifest = readManifest(root);
  manifest.symbols[meta.symbolId] = meta;
  writeManifest(root, manifest);
  return manifest;
};

export const getSymbol = (root: string, symbolId: string): SymbolMeta | undefined =>
  readManifest(root).symbols[symbolId];

/** Drop a symbol from the manifest. Its on-disk assets are removed separately. */
export const removeSymbol = (root: string, symbolId: string): LibraryManifest => {
  const manifest = readManifest(root);
  if (manifest.symbols[symbolId]) {
    delete manifest.symbols[symbolId];
    writeManifest(root, manifest);
  }
  return manifest;
};

/** Delete a symbol's on-disk folder (package + previews). No-op if already gone. */
export const removeSymbolDir = (root: string, symbolId: string): void => {
  const dir = symbolDir(root, symbolId);
  if (!fs.existsSync(dir)) return;
  // fs.rmSync (Node 14.14+) is present in CEP's runtime; fall back for safety.
  const anyFs = fs as any;
  if (anyFs.rmSync) {
    anyFs.rmSync(dir, { recursive: true, force: true });
  } else {
    fs.rmdirSync(dir, { recursive: true });
  }
};

export const listSymbols = (root: string): SymbolMeta[] => {
  const { symbols } = readManifest(root);
  return Object.keys(symbols).map((id) => symbols[id]);
};

/** Prepare the on-disk home for a symbol's package and preview assets. */
export const ensureSymbolDir = (root: string, symbolId: string): string => {
  const dir = symbolDir(root, symbolId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * Content hash of a package, used to tell a real change from a re-publish.
 * Streaming would be kinder on large packages; packages are small by design
 * (reduceProject trims them to one comp), so a single read is fine.
 */
export const hashFile = (filePath: string): string => {
  if (!fs.existsSync(filePath)) return "";
  const crypto = require("crypto");
  return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
};
