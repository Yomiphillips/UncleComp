/**
 * UncleComp Core Service — per-project registry (ARCHITECTURE.md §5.3).
 *
 * The sidecar records which symbols a working project uses and at what version,
 * which is what lets us diff against the library without opening every comp.
 * It is deliberately only a *cache*: `listSymbolInstances()` in the engine can
 * always rebuild it by scanning comp comments, so a lost or stale sidecar
 * degrades performance, never correctness.
 */

import { fs } from "../cep/node";
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

export const readRegistry = (projectPath: string): ProjectRegistry => {
  if (!projectPath) return emptyRegistry("");
  const file = registryPath(projectPath);
  if (!fs.existsSync(file)) return emptyRegistry(projectPath);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ProjectRegistry;
    if (!parsed || !parsed.instances) return emptyRegistry(projectPath);
    return parsed;
  } catch {
    return emptyRegistry(projectPath);
  }
};

export const writeRegistry = (registry: ProjectRegistry): void => {
  if (!registry.projectPath) return; // unsaved project — nothing to sit beside
  const file = registryPath(registry.projectPath);
  const tmp = `${file}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), "utf8");
  fs.renameSync(tmp, file);
};

export const recordInstance = (projectPath: string, instance: ProjectInstance): void => {
  const registry = readRegistry(projectPath);
  registry.instances[instance.symbolId] = instance;
  writeRegistry(registry);
};

/** Rebuild the sidecar from what the project actually contains. */
export const reconcile = (
  projectPath: string,
  instances: SymbolInstanceInfo[]
): ProjectRegistry => {
  const registry = emptyRegistry(projectPath);
  instances.forEach((i) => {
    registry.instances[i.symbolId] = {
      symbolId: i.symbolId,
      importedVersion: i.version,
      compName: i.compName,
    };
  });
  writeRegistry(registry);
  return registry;
};

/**
 * Which symbols in this project are behind the library.
 * Driven by live instances rather than the sidecar, so it stays correct even
 * when the sidecar is missing.
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
