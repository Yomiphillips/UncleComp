/**
 * LinkOn Engine — the After Effects command surface.
 *
 * Everything exported here is callable from the panel via `evalTS("name", ...)`
 * with full type-safety. Keep this file a thin re-export: the engine stays a
 * stateless command layer so the stateful brain can live in the Core Service
 * (and so a future UXP front-end only has to replace the UI — ARCHITECTURE.md §4).
 */

export {
  generateSymbolId,
  findSymbolComp,
  listSymbolInstances,
  getProjectPath,
} from "./linkon/identity";

export { makeSymbol, packageSymbol } from "./linkon/publish";

export { importSymbol } from "./linkon/importer";

export { syncSymbol, previewSymbolUpdate, findLayersUsingItem } from "./linkon/sync";

export { renderPoster, renderPreviewFrames } from "./linkon/preview";

export { openMasterProject, revealSymbol } from "./linkon/edit";

/** Cheap handshake so the panel can confirm the engine loaded. */
export const linkonPing = (): string => {
  return "LinkOn engine ready — AE " + app.version;
};
