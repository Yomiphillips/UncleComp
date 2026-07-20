/**
 * LinkOn — shared domain model.
 *
 * Imported by BOTH the ExtendScript engine (compiled to ES3 with `noLib`) and the
 * panel/Core Service (modern TS). Keep it dependency-free, and use index signatures
 * instead of `Record<K,V>` — TS utility types are unavailable under `noLib`.
 *
 * See ARCHITECTURE.md §5 for the data model this mirrors.
 */

/** Prefix of the identity tag written into a comp's `comment` field. */
export var TAG_PREFIX = "LINKON";

/** Identity parsed out of a comp's `comment`. */
export interface SymbolTag {
  symbolId: string;
  version: number;
}

/**
 * Identity travels *inside the artifact* (ARCHITECTURE.md §5.1): we stamp
 * `LINKON:<uuid>:<version>` into the comp's comment at publish time, so an
 * imported symbol is self-describing and needs nothing from the host project.
 */
export function formatTag(symbolId: string, version: number): string {
  return TAG_PREFIX + ":" + symbolId + ":" + version;
}

export function parseTag(comment: string): SymbolTag | null {
  if (!comment) return null;
  var m = comment.match(/LINKON:([0-9a-fA-F\-]+):([0-9]+)/);
  if (!m) return null;
  return { symbolId: m[1], version: parseInt(m[2], 10) };
}

/** One published symbol, as recorded in the library manifest. */
export interface SymbolMeta {
  symbolId: string;
  name: string;
  /** Path hint back to the authoring master project (see §6.6 "Edit Symbol"). */
  sourceProject: string;
  currentVersion: number;
  contentHash: string;
  packageFile: string;
  poster: string;
  preview: string;
  /** symbolIds of nested symbols this one uses — drives topological update order. */
  dependencies: string[];
  tags: string[];
  updatedAt: string;
  updatedBy: string;
  width: number;
  height: number;
  duration: number;
  frameRate: number;
}

/** `library.json` on the shared drive — the source of truth for what exists. */
export interface LibraryManifest {
  version: number;
  symbols: { [symbolId: string]: SymbolMeta };
}

/** One linked symbol present in a working project, at a known version. */
export interface ProjectInstance {
  symbolId: string;
  importedVersion: number;
  compName: string;
}

/** `<project>.linkon.json` sidecar — a cache; always re-derivable by scanning comments. */
export interface ProjectRegistry {
  projectPath: string;
  instances: { [symbolId: string]: ProjectInstance };
}

/** Update behaviour is a user setting, overridable per project (ARCHITECTURE.md §7). */
export type UpdateMode = "auto" | "prompt";

export interface LinkOnSettings {
  libraryRoot: string;
  updateMode: UpdateMode;
}

/** A linked symbol discovered in the currently open project. */
export interface SymbolInstanceInfo {
  symbolId: string;
  version: number;
  compName: string;
  itemId: number;
}

/** Uniform return shape for every engine (ExtendScript) command. */
export interface EngineResult {
  ok: boolean;
  error?: string;
  data?: any;
}

/** A symbol whose library version is ahead of what this project imported. */
export interface PendingUpdate {
  symbolId: string;
  name: string;
  fromVersion: number;
  toVersion: number;
}
