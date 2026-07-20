/**
 * LinkOn Core Service — flow orchestration.
 *
 * The panel calls these; they compose the ExtendScript engine (AE DOM work) with
 * the Node store (manifest, registry, ffmpeg). Keeping the composition here means
 * the UI holds no protocol knowledge and the engine holds no state.
 */

import { os } from "../cep/node";
import { evalTS } from "../utils/bolt";
import {
  SymbolMeta,
  PendingUpdate,
  SymbolInstanceInfo,
} from "../../../shared/linkon-types";
import {
  ensureLibrary,
  ensureSymbolDir,
  getSymbol,
  hashFile,
  listSymbols,
  readManifest,
  upsertSymbol,
} from "./manifest";
import { findPendingUpdates, readRegistry, recordInstance, reconcile } from "./registry";
import { assemblePreview, cleanFrames } from "./encoder";
import { framesDir, packagePath, posterPath, previewPath } from "./paths";

export interface FlowResult {
  ok: boolean;
  message: string;
  data?: any;
}

const currentUser = (): string => {
  try {
    return os.userInfo().username;
  } catch {
    return "unknown";
  }
};

export const loadLibrary = (root: string): SymbolMeta[] => {
  if (!root) return [];
  ensureLibrary(root);
  return listSymbols(root).sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * "Make Symbol": tag the selected comp, render its previews, package it, publish.
 *
 * Order is deliberate — packaging is last because it Save-As/reduce/re-opens the
 * session (ARCHITECTURE.md §6.1), so every render must already be on disk.
 */
export const publishSelectedComp = async (root: string): Promise<FlowResult> => {
  if (!root) return { ok: false, message: "Set a library folder first." };
  ensureLibrary(root);

  const made = await evalTS("makeSymbol");
  if (!made.ok) return { ok: false, message: made.error || "Could not make symbol." };

  const { symbolId, version, name, width, height, duration, frameRate, sourceProject } =
    made.data;
  ensureSymbolDir(root, symbolId);

  await evalTS("renderPoster", symbolId, posterPath(root, symbolId));
  await evalTS("renderPreviewFrames", symbolId, framesDir(root, symbolId), 24);

  const encoded = assemblePreview(framesDir(root, symbolId), previewPath(root, symbolId));
  cleanFrames(framesDir(root, symbolId));

  const packaged = await evalTS("packageSymbol", symbolId, packagePath(root, symbolId));
  if (!packaged.ok) return { ok: false, message: packaged.error || "Packaging failed." };

  const meta: SymbolMeta = {
    symbolId,
    name,
    sourceProject: sourceProject || "",
    currentVersion: version,
    contentHash: hashFile(packagePath(root, symbolId)),
    packageFile: packagePath(root, symbolId),
    poster: posterPath(root, symbolId),
    preview: encoded.ok ? previewPath(root, symbolId) : "",
    dependencies: [], // nested-symbol resolution is Phase 2
    tags: [],
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser(),
    width,
    height,
    duration,
    frameRate,
  };
  upsertSymbol(root, meta);

  return {
    ok: true,
    message: `Published "${name}" v${version}${encoded.ok ? "" : " (no preview: ffmpeg missing)"}`,
    data: meta,
  };
};

/** Bring a symbol into the open project and record it in the sidecar. */
export const importSymbolToProject = async (
  root: string,
  symbolId: string
): Promise<FlowResult> => {
  const meta = getSymbol(root, symbolId);
  if (!meta) return { ok: false, message: "Symbol not in library." };

  const res = await evalTS("importSymbol", meta.packageFile, symbolId);
  if (!res.ok) return { ok: false, message: res.error || "Import failed." };

  const projectPath = await evalTS("getProjectPath");
  recordInstance(projectPath, {
    symbolId,
    importedVersion: meta.currentVersion,
    compName: res.data.compName,
  });

  return { ok: true, message: `Imported "${meta.name}" v${meta.currentVersion}` };
};

/** Diff what the open project holds against the library. */
export const checkForUpdates = async (root: string): Promise<PendingUpdate[]> => {
  if (!root) return [];
  const instances: SymbolInstanceInfo[] = await evalTS("listSymbolInstances");
  return findPendingUpdates(instances, readManifest(root));
};

/** Apply one symbol update to the open project. */
export const applyUpdate = async (root: string, symbolId: string): Promise<FlowResult> => {
  const meta = getSymbol(root, symbolId);
  if (!meta) return { ok: false, message: "Symbol not in library." };

  const res = await evalTS("syncSymbol", symbolId, meta.packageFile, meta.currentVersion);
  if (!res.ok) return { ok: false, message: res.error || "Sync failed." };

  const projectPath = await evalTS("getProjectPath");
  recordInstance(projectPath, {
    symbolId,
    importedVersion: meta.currentVersion,
    compName: meta.name,
  });

  return {
    ok: true,
    message: `Updated "${meta.name}" to v${meta.currentVersion} (${res.data.swapped} instance(s))`,
  };
};

/** Apply every pending update — the "auto" update mode. */
export const applyAllUpdates = async (root: string): Promise<FlowResult> => {
  const pending = await checkForUpdates(root);
  if (!pending.length) return { ok: true, message: "Everything up to date." };
  let applied = 0;
  for (const update of pending) {
    const res = await applyUpdate(root, update.symbolId);
    if (res.ok) applied++;
  }
  return { ok: true, message: `Updated ${applied} of ${pending.length} symbol(s).` };
};

/** Rebuild the sidecar from the project itself (repair path for a lost registry). */
export const resyncRegistry = async (): Promise<FlowResult> => {
  const projectPath = await evalTS("getProjectPath");
  if (!projectPath) return { ok: false, message: "Save the project first." };
  const instances: SymbolInstanceInfo[] = await evalTS("listSymbolInstances");
  const registry = reconcile(projectPath, instances);
  return {
    ok: true,
    message: `Registry rebuilt: ${Object.keys(registry.instances).length} linked symbol(s).`,
  };
};

export { readRegistry };
