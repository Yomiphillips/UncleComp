/**
 * UncleComp — shared domain model.
 *
 * Imported by BOTH the ExtendScript engine (compiled to ES3 with `noLib`) and the
 * panel/Core Service (modern TS). Keep it dependency-free, and use index signatures
 * instead of `Record<K,V>` — TS utility types are unavailable under `noLib`.
 *
 * See ARCHITECTURE.md §5 for the data model this mirrors.
 */

/** Prefix of the identity tag written into a comp's `comment` field. */
export var TAG_PREFIX = "UNCLECOMP";

/** Identity parsed out of a comp's `comment`. */
export interface SymbolTag {
  symbolId: string;
  version: number;
}

/**
 * Identity travels *inside the artifact* (ARCHITECTURE.md §5.1): we stamp
 * `UNCLECOMP:<uuid>:<version>` into the comp's comment at publish time, so an
 * imported symbol is self-describing and needs nothing from the host project.
 */
export function formatTag(symbolId: string, version: number): string {
  return TAG_PREFIX + ":" + symbolId + ":" + version;
}

export function parseTag(comment: string): SymbolTag | null {
  if (!comment) return null;
  var m = comment.match(/UNCLECOMP:([0-9a-fA-F\-]+):([0-9]+)/);
  if (!m) return null;
  return { symbolId: m[1], version: parseInt(m[2], 10) };
}

/**
 * Drop the identity tag, keeping anything else the user wrote in the comment.
 *
 * Needed because After Effects copies a comp's `comment` when the comp is
 * duplicated — so a duplicate arrives already claiming the original's identity,
 * and detaching it is the only way to make the project unambiguous again.
 */
export function stripTag(comment: string): string {
  if (!comment) return "";
  var without = comment.replace(/UNCLECOMP:[0-9a-fA-F\-]+:[0-9]+/, "");
  return without.replace(/^\s+/, "").replace(/\s+$/, ""); // no String.trim in ES3
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
  /**
   * AE item id of the comp we registered. This is what tells the original apart
   * from a duplicate: duplicating a comp copies its `comment` (and so its
   * symbolId), but AE always assigns the copy a fresh item id. Optional because
   * registries written before this existed won't have it.
   */
  itemId?: number;
}

/**
 * The per-project registry — stored inside the .aep, in the project's XMP
 * packet (§5.3). Only `instances` is persisted; `projectPath` labels the
 * in-memory value (and locates legacy sidecars), since a stored path would go
 * stale on Save As. A cache: always re-derivable by scanning comp comments.
 */
export interface ProjectRegistry {
  projectPath: string;
  instances: { [symbolId: string]: ProjectInstance };
}

/**
 * Updates are always user-initiated — the panel raises badges, the user presses
 * Update or Update all. There is deliberately no auto-apply mode: a timeline
 * should never change underneath an editor without them asking (ARCHITECTURE.md §7).
 */
export interface UncleCompSettings {
  libraryRoot: string;
}

/** A comp in the user's AE selection — a multi-publish target (see listSelectedComps). */
export interface SelectedCompInfo {
  itemId: number;
  name: string;
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
