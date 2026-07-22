/**
 * LinkOn Core Service — flow orchestration.
 *
 * The panel calls these; they compose the ExtendScript engine (AE DOM work) with
 * the Node store (manifest, registry, settings). Keeping the composition here means
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
import { packagePath, posterPath, previewPath } from "./paths";

/** Preview shape: short, low frame rate, quarter-size — see engine renderPreview. */
const PREVIEW_MAX_SECONDS = 3;
const PREVIEW_FPS = 15;

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
 * Publish a comp as a symbol: tag it, render its previews, package it, record it.
 *
 * `symbolId` picks the republish path — bump an existing symbol regardless of the
 * AE selection. Omitted, it symbolises whatever comp is selected.
 *
 * Order is deliberate — packaging is last because it Save-As/reduce/re-opens the
 * session (ARCHITECTURE.md §6.1), so every render must already be on disk.
 */
const publish = async (root: string, republishId?: string): Promise<FlowResult> => {
  if (!root) return { ok: false, message: "Set a library folder first." };
  ensureLibrary(root);

  // Called with no argument rather than an explicit `undefined` — evalTS
  // serialises args through JSON, where undefined has no faithful round-trip.
  const made = republishId
    ? await evalTS("makeSymbol", republishId)
    : await evalTS("makeSymbol");
  if (!made.ok) return { ok: false, message: made.error || "Could not make symbol." };

  const { symbolId, version, name, width, height, duration, frameRate, sourceProject } =
    made.data;
  ensureSymbolDir(root, symbolId);

  await evalTS("renderPoster", symbolId, posterPath(root, symbolId));
  const preview = await evalTS(
    "renderPreview",
    symbolId,
    previewPath(root, symbolId),
    PREVIEW_MAX_SECONDS,
    PREVIEW_FPS
  );

  const packaged = await evalTS("packageSymbol", symbolId, packagePath(root, symbolId));
  if (!packaged.ok) return { ok: false, message: packaged.error || "Packaging failed." };

  const previous = getSymbol(root, symbolId);
  const meta: SymbolMeta = {
    symbolId,
    name,
    sourceProject: sourceProject || "",
    currentVersion: version,
    contentHash: hashFile(packagePath(root, symbolId)),
    packageFile: packagePath(root, symbolId),
    poster: posterPath(root, symbolId),
    preview: preview.ok ? previewPath(root, symbolId) : "",
    dependencies: [], // nested-symbol resolution is Phase 2
    // Curation survives a republish — only the artifact and version change.
    tags: previous ? previous.tags : [],
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser(),
    width,
    height,
    duration,
    frameRate,
  };
  upsertSymbol(root, meta);

  // Register the master's own comp: without this we can't tell it from a
  // duplicate later, and the master is exactly where duplicating to try an idea
  // is most likely (and most costly — it is what gets published).
  if (sourceProject) {
    recordInstance(sourceProject, {
      symbolId,
      importedVersion: version,
      compName: name,
      itemId: made.data.itemId,
    });
  }

  return {
    ok: true,
    message: `Published "${name}" v${version}${
      preview.ok ? "" : ` (no preview: ${preview.error})`
    }`,
    data: meta,
  };
};

/** "Make Symbol" — symbolise whatever comp is selected in AE. */
export const publishSelectedComp = (root: string): Promise<FlowResult> => publish(root);

/**
 * "Publish update" — bump an existing symbol from its master project.
 * Consumers see the new version on their next check (ARCHITECTURE.md §6.4).
 */
export const publishSymbolUpdate = (root: string, symbolId: string): Promise<FlowResult> =>
  publish(root, symbolId);

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
    itemId: res.data.itemId,
  });

  return { ok: true, message: `Imported "${meta.name}" v${meta.currentVersion}` };
};

/**
 * Every linked symbol the open project actually contains, scanned from comp
 * comments. Drives both the update diff and the "is this symbol's master open?"
 * question the panel asks to decide whether Publish update applies.
 */
export const listProjectSymbols = async (): Promise<SymbolInstanceInfo[]> => {
  return await evalTS("listSymbolInstances");
};

/** Absolute path of the open project, "" when it has never been saved. */
export const currentProjectPath = async (): Promise<string> => {
  return await evalTS("getProjectPath");
};

/** Two or more comps claiming one symbolId — i.e. someone duplicated the comp. */
export interface DuplicateClaim {
  symbolId: string;
  name: string;
  claimants: SymbolInstanceInfo[];
}

/**
 * Duplicated symbol comps in the open project.
 *
 * Needs no new engine call: AE copies a comp's `comment` on duplicate, so both
 * copies show up in `listSymbolInstances` under the same symbolId. Publish and
 * sync refuse to run while a symbol is in this state (see the engine's
 * duplicateClaimError), so the panel has to give the user a way to resolve it.
 */
export const findDuplicateClaims = (instances: SymbolInstanceInfo[]): DuplicateClaim[] => {
  const bySymbol: { [id: string]: SymbolInstanceInfo[] } = {};
  instances.forEach((i) => {
    if (!bySymbol[i.symbolId]) bySymbol[i.symbolId] = [];
    bySymbol[i.symbolId].push(i);
  });

  const claims: DuplicateClaim[] = [];
  Object.keys(bySymbol).forEach((symbolId) => {
    const claimants = bySymbol[symbolId];
    if (claimants.length > 1) {
      claims.push({ symbolId, name: claimants[0].compName, claimants });
    }
  });
  return claims;
};

/**
 * Resolve a duplicate the way the user arbitrated it: keep the comp they chose
 * as the symbol, and detach every other comp claiming the same id in one undo
 * group. The survivor is left as the sole carrier of the symbolId — which is
 * exactly what publish and sync require — so the project can never end up with a
 * symbol that no comp claims.
 */
export const keepSymbolCopy = async (
  symbolId: string,
  keepItemId: number,
  keepName: string
): Promise<FlowResult> => {
  const res = await evalTS("keepSymbolComp", symbolId, keepItemId);
  if (!res.ok) return { ok: false, message: res.error || "Could not resolve the duplicate." };

  const detached: string[] = res.data.detached || [];
  if (!detached.length) {
    return { ok: true, message: `Kept "${keepName}" as the symbol.` };
  }
  const plural = detached.length === 1 ? "copy" : "copies";
  return {
    ok: true,
    message: `Kept "${keepName}" as the symbol — detached ${detached.length} ${plural} (${detached.join(
      ", "
    )}); now ordinary comps.`,
  };
};

/**
 * Is the open project the one a symbol is authored in? Symbols are authored in
 * exactly one place (ARCHITECTURE.md §6.6/§7), so this is what separates the
 * publisher's master from a consumer's read-only imported copy.
 */
export const isMasterProject = (meta: SymbolMeta, projectPath: string): boolean => {
  if (!meta.sourceProject || !projectPath) return false;
  const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  return norm(meta.sourceProject) === norm(projectPath);
};

/**
 * Diff what the open project holds against the library. Pass `instances` when
 * the caller has already scanned, to avoid a second round-trip into AE.
 */
export const checkForUpdates = async (
  root: string,
  instances?: SymbolInstanceInfo[]
): Promise<PendingUpdate[]> => {
  if (!root) return [];
  return findPendingUpdates(instances || (await listProjectSymbols()), readManifest(root));
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
    itemId: res.data.itemId,
  });

  // `kept` items are old assets something else still uses — deliberately not
  // deleted, but worth surfacing so a project doesn't quietly accumulate them.
  const { swapped, removed, kept } = res.data;
  const keptNote =
    kept && kept.length ? ` · kept ${kept.length} still-in-use item(s): ${kept.join(", ")}` : "";

  return {
    ok: true,
    message:
      `Updated "${meta.name}" to v${meta.currentVersion} — ` +
      `${swapped} instance(s) repointed, ${removed} old item(s) removed${keptNote}`,
  };
};

/** Apply every pending update — what the panel's "Update all" button runs. */
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
