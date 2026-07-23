/**
 * UncleComp Engine — "Edit Symbol" (ARCHITECTURE.md §6.6).
 *
 * Symbols are authored in exactly one place: the master project. Editing a
 * linked instance opens the master rather than letting internals diverge locally.
 */

import { EngineResult } from "../../../shared/unclecomp-types";
import { findSymbolComp } from "./identity";

export const openMasterProject = (masterPath: string): EngineResult => {
  try {
    var file = new File(masterPath);
    if (!file.exists) {
      // Stale hint — the panel prompts the user to relocate the master.
      return { ok: false, error: "MASTER_NOT_FOUND", data: { masterPath: masterPath } };
    }
    app.open(file);
    return { ok: true, data: { opened: masterPath } };
  } catch (e) {
    return { ok: false, error: (e as any).toString() };
  }
};

/** Reveal a symbol's comp in the project panel and open it in the timeline. */
export const revealSymbol = (symbolId: string): EngineResult => {
  var comp = findSymbolComp(symbolId);
  if (!comp) return { ok: false, error: "Symbol not present in this project." };
  comp.selected = true;
  comp.openInViewer();
  return { ok: true, data: { compName: comp.name } };
};
