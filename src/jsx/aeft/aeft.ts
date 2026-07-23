/**
 * UncleComp Engine — the After Effects command surface.
 *
 * Everything exported here is callable from the panel via `evalTS("name", ...)`
 * with full type-safety. Keep this file a thin re-export: the engine stays a
 * stateless command layer so the stateful brain can live in the Core Service
 * (and so a future UXP front-end only has to replace the UI — ARCHITECTURE.md §4).
 */

export {
  generateSymbolId,
  findSymbolComp,
  findSymbolComps,
  keepSymbolComp,
  listSymbolInstances,
  getProjectPath,
} from "./unclecomp/identity";

export { readRegistryXmp, writeRegistryXmp } from "./unclecomp/registry";

export { makeSymbol, packageSymbol, listSelectedComps } from "./unclecomp/publish";

export { importSymbol } from "./unclecomp/importer";

export { syncSymbol, previewSymbolUpdate, findLayersUsingItem } from "./unclecomp/sync";

export { renderPoster, renderPreview } from "./unclecomp/preview";

export { openMasterProject, revealSymbol } from "./unclecomp/edit";

/** Cheap handshake so the panel can confirm the engine loaded. */
export const UncleCompPing = (): string => {
  return "UncleComp engine ready — AE " + app.version;
};
