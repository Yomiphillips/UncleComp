/**
 * UncleComp Core Service — per-project registry (ARCHITECTURE.md §5.3).
 *
 * The registry records which symbols a working project uses and at what version,
 * which is what lets us diff against the library without opening every comp.
 * It lives inside the .aep itself — in the project's XMP metadata packet, via the
 * engine's readRegistryXmp/writeRegistryXmp — so nothing sits next to the file
 * and registry state persists exactly when the project does. Projects saved by
 * older builds left a `<project>.unclecomp.json` sidecar; the first read imports
 * it into XMP and deletes it.
 *
 * It is deliberately only a *cache*: `listSymbolInstances()` in the engine can
 * always rebuild it by scanning comp comments, so a lost or stale registry
 * degrades performance, never correctness.
 */

import { fs } from "../cep/node";
import { evalTS } from "../utils/bolt";
import {
  ProjectRegistry,
  ProjectInstance,
  SymbolInstanceInfo,
  LibraryManifest,
  PendingUpdate,
} from "../../../shared/unclecomp-types";
import { registryPath } from "./paths";

export const emptyRegistry = (projectPath: string): ProjectRegistry => ({
  projectPath,
  instances: {},
});

/** Parse a registry blob (from XMP or a legacy sidecar); null when unusable. */
const parseRegistry = (raw: string, projectPath: string): ProjectRegistry | null => {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.instances) return null;
    return { projectPath, instances: parsed.instances };
  } catch {
    return null;
  }
};

/**
 * The open project's registry. `projectPath` only labels the result and locates
 * a legacy sidecar — the data itself always comes from the open project's XMP.
 */
export const readRegistry = async (projectPath: string): Promise<ProjectRegistry> => {
  const raw = await evalTS("readRegistryXmp");
  const registry = raw ? parseRegistry(raw, projectPath) : null;
  if (registry) return registry;
  return migrateLegacySidecar(projectPath);
};

/**
 * One-time import of a pre-XMP sidecar: fold its contents into the project's
 * XMP and remove the file. If the project is never saved afterwards the XMP copy
 * is lost with the rest of the session — acceptable, because the registry is a
 * cache and Repair registry rebuilds it from comments.
 */
const migrateLegacySidecar = async (projectPath: string): Promise<ProjectRegistry> => {
  if (!projectPath) return emptyRegistry("");
  const file = registryPath(projectPath);
  if (!fs.existsSync(file)) return emptyRegistry(projectPath);
  let registry: ProjectRegistry | null = null;
  try {
    registry = parseRegistry(fs.readFileSync(file, "utf8"), projectPath);
  } catch {
    registry = null;
  }
  if (!registry) registry = emptyRegistry(projectPath);
  await writeRegistry(registry); // also deletes the sidecar once XMP holds the data
  return registry;
};

/**
 * Store the registry in the open project's XMP. Works for unsaved projects too —
 * the packet lives in the project, so it simply persists whenever the user saves.
 * Any legacy sidecar is removed only after the XMP write succeeds, so the cache
 * is never destroyed before its replacement exists.
 */
export const writeRegistry = async (registry: ProjectRegistry): Promise<void> => {
  // Only the instances go into the packet — a stored path would go stale on Save As.
  const res = await evalTS("writeRegistryXmp", JSON.stringify({ instances: registry.instances }));
  if (res && res.ok) removeLegacySidecar(registry.projectPath);
};

const removeLegacySidecar = (projectPath: string): void => {
  if (!projectPath) return;
  try {
    const file = registryPath(projectPath);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* read-only share etc. — a lingering sidecar is dead weight, not a hazard */
  }
};

export const recordInstance = async (
  projectPath: string,
  instance: ProjectInstance
): Promise<void> => {
  const registry = await readRegistry(projectPath);
  registry.instances[instance.symbolId] = instance;
  await writeRegistry(registry);
};

/** Rebuild the registry from what the project actually contains. */
export const reconcile = async (
  projectPath: string,
  instances: SymbolInstanceInfo[]
): Promise<ProjectRegistry> => {
  const registry = emptyRegistry(projectPath);
  instances.forEach((i) => {
    registry.instances[i.symbolId] = {
      symbolId: i.symbolId,
      importedVersion: i.version,
      compName: i.compName,
      itemId: i.itemId,
    };
  });
  await writeRegistry(registry);
  return registry;
};

/**
 * Which symbols in this project are behind the library.
 * Driven by live instances rather than the stored registry, so it stays correct
 * even when the registry is missing.
 */
export const findPendingUpdates = (
  instances: SymbolInstanceInfo[],
  manifest: LibraryManifest
): PendingUpdate[] => {
  // Keyed by symbolId, because a duplicated comp puts the same symbol in the
  // list twice — which would otherwise double-count the "N out of date" badge
  // and run the same sync twice under Update all. Lowest version wins: it is the
  // one furthest behind, so it describes the work still to do.
  const worst: { [symbolId: string]: PendingUpdate } = {};
  instances.forEach((inst) => {
    const meta = manifest.symbols[inst.symbolId];
    if (!meta || meta.currentVersion <= inst.version) return;
    const seen = worst[inst.symbolId];
    if (seen && seen.fromVersion <= inst.version) return;
    worst[inst.symbolId] = {
      symbolId: inst.symbolId,
      name: meta.name,
      fromVersion: inst.version,
      toVersion: meta.currentVersion,
    };
  });
  return Object.keys(worst).map((id) => worst[id]);
};
