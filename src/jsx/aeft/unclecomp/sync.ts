/**
 * UncleComp Engine — the update mechanic (ARCHITECTURE.md §6.4).
 *
 * `AVLayer.replaceSource()` swaps a layer's source while preserving that layer's
 * transforms, keyframes, effects, masks, trim and stretch. That preservation is
 * what makes symbol updates non-destructive, and it is exactly what
 * spike/01_replace_source_fidelity.jsx verified before we built on it.
 */

import { EngineResult } from "../../../shared/unclecomp-types";
import { duplicateClaimError, findSymbolComp, writeSymbolTag } from "./identity";
import { importSymbolPackage, organiseImport } from "./importer";
import {
  collectDependencies,
  collectFolder,
  findSymbolFolder,
  removeRetiredItems,
  unionItems,
} from "./cleanup";

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
 *
 * Import the new package, repoint every instance, *verify* nothing still points
 * at the old version, then retire the whole old import — comp, precomps, footage
 * and its folder — rather than only the comp. Order matters: `Item.remove()`
 * takes the layers using an item down with it, so deletion only ever happens
 * after the swap is proven complete. Wrapped in one undo group, so a sync the
 * user dislikes is a single Cmd/Ctrl+Z.
 */
export const syncSymbol = (
  symbolId: string,
  packagePath: string,
  newVersion: number
): EngineResult => {
  app.beginUndoGroup("UncleComp: sync symbol");
  try {
    // Before anything is imported or deleted: refuse a swap we can't aim.
    // Updating one of two identical claimants would leave the other's layers
    // silently stranded on the old version.
    var ambiguous = duplicateClaimError(symbolId);
    if (ambiguous) return { ok: false, error: ambiguous };

    var oldComp = findSymbolComp(symbolId);
    if (!oldComp) {
      return { ok: false, error: "Symbol not present in this project." };
    }
    var oldName = oldComp.name;
    // Captured before the import, so it can never resolve to the incoming folder.
    var oldFolder = findSymbolFolder(symbolId);

    var imported = importSymbolPackage(packagePath, symbolId);
    if (!imported) {
      return { ok: false, error: "Could not import package: " + packagePath };
    }
    var incoming = imported.comp;

    var swapped = swapSymbolSource(oldComp, incoming);

    // The safety gate: if anything still sources the old comp, the swap missed
    // it, and deleting now would delete those layers too. Bail with the list.
    var stragglers = oldComp.usedIn;
    if (stragglers && stragglers.length > 0) {
      var names: string[] = [];
      for (var s = 0; s < stragglers.length; s++) names.push(stragglers[s].name);
      return {
        ok: false,
        error:
          'Aborted: "' +
          oldName +
          '" is still used by ' +
          names.join(", ") +
          " after the swap. Nothing was deleted — undo to discard the new import.",
      };
    }

    // Keep the familiar name so the user's bins/timelines read the same.
    incoming.name = oldName;
    writeSymbolTag(incoming, symbolId, newVersion);
    organiseImport(imported, symbolId, newVersion, oldName);

    // Retire the previous version. Always start from everything reachable from
    // the old comp itself — the comp plus its precomps, footage and solids — so
    // the superseded comp is retired even when the user has dragged it out of the
    // UncleComp bin while organising their project. Relying on the tagged folder's
    // contents alone left the old comp orphaned as a duplicate in exactly that
    // case: it is no longer inside the folder, so collectFolder never saw it and
    // removeRetiredItems never removed it. When the folder is still present we
    // union its contents in too, so the folder and any assets not reachable
    // through a layer (e.g. an auto-created "Solids" bin) are swept as well.
    var retiring = collectDependencies(oldComp);
    if (oldFolder) retiring = unionItems(retiring, collectFolder(oldFolder));
    var cleanup = removeRetiredItems(retiring);

    return {
      ok: true,
      data: {
        swapped: swapped,
        version: newVersion,
        itemId: incoming.id,
        removed: cleanup.removed,
        kept: cleanup.kept,
      },
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    app.endUndoGroup();
  }
};
