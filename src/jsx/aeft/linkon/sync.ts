/**
 * LinkOn Engine — the update mechanic (ARCHITECTURE.md §6.4).
 *
 * `AVLayer.replaceSource()` swaps a layer's source while preserving that layer's
 * transforms, keyframes, effects, masks, trim and stretch. That preservation is
 * what makes symbol updates non-destructive, and it is exactly what
 * spike/01_replace_source_fidelity.jsx verified before we built on it.
 */

import { EngineResult } from "../../../shared/linkon-types";
import { findSymbolComp, writeSymbolTag } from "./identity";
import { importSymbolPackage } from "./importer";

/** Where a symbol is instanced, for reporting what an update will touch. */
export interface LayerRef {
  compName: string;
  layerName: string;
  layerIndex: number;
}

export const findLayersUsingItem = (item: AVItem): LayerRef[] => {
  var refs: LayerRef[] = [];
  var proj = app.project;
  for (var i = 1; i <= proj.numItems; i++) {
    var container = proj.item(i);
    if (!(container instanceof CompItem)) continue;
    for (var j = 1; j <= container.numLayers; j++) {
      var layer = container.layer(j);
      if (layer instanceof AVLayer && layer.source && layer.source.id === item.id) {
        refs.push({
          compName: container.name,
          layerName: layer.name,
          layerIndex: j,
        });
      }
    }
  }
  return refs;
};

/** Repoint every layer sourced from `oldComp` at `newComp`. Returns how many swapped. */
export const swapSymbolSource = (oldComp: CompItem, newComp: CompItem): number => {
  var swapped = 0;
  var proj = app.project;
  for (var i = 1; i <= proj.numItems; i++) {
    var container = proj.item(i);
    if (!(container instanceof CompItem)) continue;
    if (container.id === newComp.id) continue; // never rewrite the incoming symbol's own internals
    for (var j = 1; j <= container.numLayers; j++) {
      var layer = container.layer(j);
      if (layer instanceof AVLayer && layer.source && layer.source.id === oldComp.id) {
        layer.replaceSource(newComp, true); // fixExpressions
        swapped++;
      }
    }
  }
  return swapped;
};

/** Which comps would be touched if this symbol updated — used to preview a "prompt" update. */
export const previewSymbolUpdate = (symbolId: string): EngineResult => {
  var oldComp = findSymbolComp(symbolId);
  if (!oldComp) return { ok: false, error: "Symbol not present in this project." };
  return { ok: true, data: { usedBy: findLayersUsingItem(oldComp) } };
};

/**
 * Pull a newer version of a symbol into the open project.
 * Import the new package, repoint every instance, drop the stale comp, re-tag.
 * Wrapped in a single undo group so the whole sync is one Cmd/Ctrl+Z.
 */
export const syncSymbol = (
  symbolId: string,
  packagePath: string,
  newVersion: number
): EngineResult => {
  app.beginUndoGroup("LinkOn: sync symbol");
  try {
    var oldComp = findSymbolComp(symbolId);
    if (!oldComp) {
      return { ok: false, error: "Symbol not present in this project." };
    }
    var oldName = oldComp.name;

    var incoming = importSymbolPackage(packagePath, symbolId);
    if (!incoming) {
      return { ok: false, error: "Could not import package: " + packagePath };
    }

    var swapped = swapSymbolSource(oldComp, incoming);
    oldComp.remove();

    // Keep the familiar name so the user's bins/timelines read the same.
    incoming.name = oldName;
    writeSymbolTag(incoming, symbolId, newVersion);

    return { ok: true, data: { swapped: swapped, version: newVersion } };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    app.endUndoGroup();
  }
};
