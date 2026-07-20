/**
 * LinkOn Engine — publishing (ARCHITECTURE.md §6.1).
 *
 * "Make Symbol" only stamps identity — it is cheap and safe to run on the
 * selected comp. Packaging is separate because `reduceProject()` is destructive,
 * so it must be handled deliberately (see `packageSymbol` below).
 */

import { EngineResult, parseTag } from "../../../shared/linkon-types";
import {
  generateSymbolId,
  findSymbolComp,
  writeSymbolTag,
  getProjectPath,
} from "./identity";

/** The comp the user means: explicit project selection first, else the active comp. */
const targetComp = (): CompItem | null => {
  var sel = app.project.selection;
  for (var i = 0; i < sel.length; i++) {
    if (sel[i] instanceof CompItem) return sel[i] as CompItem;
  }
  var active = app.project.activeItem;
  if (active && active instanceof CompItem) return active;
  return null;
};

/**
 * Turn the selected comp into a symbol (or bump an existing one).
 * Idempotent: re-running on an already-tagged comp keeps its UUID and bumps version.
 */
export const makeSymbol = (): EngineResult => {
  app.beginUndoGroup("LinkOn: make symbol");
  try {
    var comp = targetComp();
    if (!comp) {
      return { ok: false, error: "Select a composition first." };
    }

    var existing = parseTag(comp.comment);
    var symbolId = existing ? existing.symbolId : generateSymbolId();
    var version = existing ? existing.version + 1 : 1;
    writeSymbolTag(comp, symbolId, version);

    return {
      ok: true,
      data: {
        symbolId: symbolId,
        version: version,
        name: comp.name,
        width: comp.width,
        height: comp.height,
        duration: comp.duration,
        frameRate: comp.frameRate,
        sourceProject: getProjectPath(),
        isNew: !existing,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as any).toString() };
  } finally {
    app.endUndoGroup();
  }
};

/**
 * Write a single-comp package .aep for a symbol.
 *
 * `reduceProject()` mutates the open project, so the only way to do this from
 * inside the user's session is: Save-As to the package path, reduce, save, then
 * re-open the original. The user's master file on disk is never modified — but
 * the session does bounce, which is why this is an explicit publish step.
 * (v2 moves this into an isolated process — ARCHITECTURE.md §6.1.)
 */
export const packageSymbol = (
  symbolId: string,
  destPath: string
): EngineResult => {
  try {
    var comp = findSymbolComp(symbolId);
    if (!comp) return { ok: false, error: "Symbol not found in this project." };

    var originalFile = app.project.file;
    if (!originalFile) {
      return { ok: false, error: "Save the master project before publishing." };
    }
    var originalPath = originalFile.fsName;

    app.project.save(new File(destPath));
    app.project.reduceProject([comp]);
    app.project.save();

    app.open(new File(originalPath)); // restore the user's session

    return { ok: true, data: { packagePath: destPath, sourceProject: originalPath } };
  } catch (e) {
    return { ok: false, error: (e as any).toString() };
  }
};
