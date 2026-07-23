/**
 * UncleComp Core Service — flow orchestration.
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
} from "../../../shared/unclecomp-types";
import {
  ensureLibrary,
  ensureSymbolDir,
  getSymbol,
  hashFile,
  listSymbols,
  readManifest,
  removeSymbol,
  removeSymbolDir,
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
 * `republishId` picks the republish path — bump an existing symbol regardless of
 * the AE selection. `targetItemId` publishes one specific comp — the multi-publish
 * path, which addresses comps by item id because packaging destroys the selection.
 * With neither, it symbolises whatever comp is selected.
 *
 * Order is deliberate — packaging is last because it Save-As/reduce/re-opens the
 * session (ARCHITECTURE.md §6.1), so every render must already be on disk.
 */
const publish = async (
  root: string,
  republishId?: string,
  targetItemId?: number
): Promise<FlowResult> => {
  if (!root) return { ok: false, message: "Set a library folder first." };
  ensureLibrary(root);

  // Positional args, never an explicit `undefined` — evalTS serialises args
  // through JSON, where undefined has no faithful round-trip. "" reads as
  // "no republish id" on the engine side.
  const made = republishId
    ? await evalTS("makeSymbol", republishId)
    : targetItemId
    ? await evalTS("makeSymbol", "", targetItemId)
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
    await recordInstance(sourceProject, {
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

/**
 * "Make Symbol" — symbolise every comp selected in AE, each as its own symbol.
 *
 * Targets are captured as item ids before anything runs: each publish bounces
 * the session while packaging, which destroys the selection, so the remaining
 * comps could not be found again by asking AE what is selected. Publishes run
 * sequentially and independently — one failure doesn't stop the rest, and
 * whatever succeeded is already fully in the library.
 */
export const publishSelectedComps = async (root: string): Promise<FlowResult> => {
  if (!root) return { ok: false, message: "Set a library folder first." };

  const comps = await evalTS("listSelectedComps");
  if (!comps.length) return { ok: false, message: "Select a composition first." };
  if (comps.length === 1) return publish(root, undefined, comps[0].itemId);

  const published: string[] = [];
  const failed: string[] = [];
  for (const comp of comps) {
    const res = await publish(root, undefined, comp.itemId);
    if (res.ok && res.data) {
      published.push(`"${res.data.name}" v${res.data.currentVersion}`);
    } else {
      failed.push(`"${comp.name}": ${res.message}`);
    }
  }

  if (!failed.length) {
    return { ok: true, message: `Published ${published.length} symbols — ${published.join(", ")}` };
  }
  if (!published.length) {
    return { ok: false, message: `Nothing published — ${failed.join(" · ")}` };
  }
  return {
    ok: true,
    message:
      `Published ${published.length} of ${comps.length} — ${published.join(", ")}. ` +
      `Failed: ${failed.join(" · ")}`,
  };
};

/**
 * "Publish update" — bump an existing symbol from its master project.
 * Consumers see the new version on their next check (ARCHITECTURE.md §6.4).
 */
export const publishSymbolUpdate = (root: string, symbolId: string): Promise<FlowResult> =>
  publish(root, symbolId);

/** Bring a symbol into the open project and record it in the project registry. */
export const importSymbolToProject = async (
  root: string,
  symbolId: string
): Promise<FlowResult> => {
  const meta = getSymbol(root, symbolId);
  if (!meta) return { ok: false, message: "Symbol not in library." };

  const res = await evalTS("importSymbol", meta.packageFile, symbolId);
  if (!res.ok) return { ok: false, message: res.error || "Import failed." };

  const projectPath = await evalTS("getProjectPath");
  await recordInstance(projectPath, {
    symbolId,
    importedVersion: meta.currentVersion,
    compName: res.data.compName,
    itemId: res.data.itemId,
  });

  // Tell the user where it landed — in their comp, or just in the bin.
  const placed = res.data.placedIn
    ? ` — added to "${res.data.placedIn}"`
    : " — in the UncleComp folder";
  return { ok: true, message: `Imported "${meta.name}" v${meta.currentVersion}${placed}` };
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

/** Compare project paths tolerantly of slash direction and case (Windows shares). */
const normPath = (p: string): string => p.replace(/\\/g, "/").toLowerCase();

/**
 * Is the open project the one a symbol is authored in? Symbols are authored in
 * exactly one place (ARCHITECTURE.md §6.6/§7), so this is what separates the
 * publisher's master from a consumer's read-only imported copy.
 */
export const isMasterProject = (meta: SymbolMeta, projectPath: string): boolean => {
  if (!meta.sourceProject || !projectPath) return false;
  return normPath(meta.sourceProject) === normPath(projectPath);
};

/**
 * "Edit Symbol" — take the user to where the symbol is authored (ARCHITECTURE.md
 * §6.6). A symbol's internals live in exactly one place, its master project, so
 * editing opens that master and focuses the comp rather than letting a consumer
 * edit a read-only linked copy in place.
 *
 * If the master is already the open project this only reveals the comp; otherwise
 * it opens the master .aep first. A stale hint (master moved/renamed) comes back
 * as `needsRelocate` so the panel can ask the user to point at the file — the
 * relink repair of §5.1/§8.
 */
export const editSymbol = async (root: string, symbolId: string): Promise<FlowResult> => {
  const meta = getSymbol(root, symbolId);
  if (!meta) return { ok: false, message: "Symbol not in library." };
  if (!meta.sourceProject) {
    return {
      ok: false,
      message: `No master project is recorded for "${meta.name}" — publish it from its master to set one.`,
    };
  }

  const openPath = await evalTS("getProjectPath");
  if (!openPath || normPath(openPath) !== normPath(meta.sourceProject)) {
    const opened = await evalTS("openMasterProject", meta.sourceProject);
    if (!opened.ok) {
      if (opened.error === "MASTER_NOT_FOUND") {
        return {
          ok: false,
          message: `Can't find the master for "${meta.name}" at ${meta.sourceProject}.`,
          data: { needsRelocate: true, symbolId },
        };
      }
      return { ok: false, message: opened.error || "Could not open the master project." };
    }
  }

  const revealed = await evalTS("revealSymbol", symbolId);
  if (!revealed.ok) {
    // The master opened but its comp wasn't found to focus — still a success for
    // the user (they're in the right project), just note we couldn't jump to it.
    return {
      ok: true,
      message: `Opened the master for "${meta.name}" — couldn't focus its comp (${revealed.error}).`,
    };
  }
  return { ok: true, message: `Editing "${meta.name}" in its master project.` };
};

/**
 * Point a symbol at a moved/renamed master and open it. Called after the panel
 * has the user locate the file a stale `sourceProject` hint pointed at, so the
 * fix sticks for next time (ARCHITECTURE.md §8, "Master project moved/renamed").
 */
export const relocateMaster = async (
  root: string,
  symbolId: string,
  newPath: string
): Promise<FlowResult> => {
  const meta = getSymbol(root, symbolId);
  if (!meta) return { ok: false, message: "Symbol not in library." };
  meta.sourceProject = newPath;
  upsertSymbol(root, meta);
  return editSymbol(root, symbolId);
};

/**
 * Remove a symbol from the shared library: delete its on-disk package and
 * previews, then drop its manifest entry. Instances already imported into
 * projects are deliberately left untouched — they are independent copies that
 * keep working and simply stop receiving updates. Because this affects the
 * shared drive for the whole team, the panel confirms before calling it.
 */
export const deleteSymbol = async (root: string, symbolId: string): Promise<FlowResult> => {
  if (!root) return { ok: false, message: "Set a library folder first." };
  const meta = getSymbol(root, symbolId);
  if (!meta) return { ok: false, message: "Symbol not in library." };
  try {
    // Assets first, then the manifest entry — if the folder delete throws, the
    // symbol stays listed rather than becoming a manifest ghost with no package.
    removeSymbolDir(root, symbolId);
    removeSymbol(root, symbolId);
    return { ok: true, message: `Deleted "${meta.name}" from the library.` };
  } catch (e: any) {
    return { ok: false, message: "Delete failed: " + (e && e.message ? e.message : e) };
  }
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
  await recordInstance(projectPath, {
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

/**
 * Rebuild the registry from the project itself (repair path for lost or stale
 * registry data). Works even before the project is first saved — the registry
 * lives in the project's XMP, which needs no path.
 */
export const resyncRegistry = async (): Promise<FlowResult> => {
  const projectPath = await evalTS("getProjectPath");
  const instances: SymbolInstanceInfo[] = await evalTS("listSymbolInstances");
  const registry = await reconcile(projectPath, instances);
  return {
    ok: true,
    message: `Registry rebuilt: ${Object.keys(registry.instances).length} linked symbol(s).`,
  };
};

export { readRegistry };
