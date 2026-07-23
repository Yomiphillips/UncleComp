/**
 * UncleComp Engine — publishing (ARCHITECTURE.md §6.1).
 *
 * "Make Symbol" stamps identity into the comp's comment and saves the master, so
 * the symbol's UUID and version survive the session bounce that packaging causes.
 * Packaging is separate because `reduceProject()` is destructive, so it must be
 * handled deliberately (see `packageSymbol` below).
 */

import { EngineResult, parseTag, SelectedCompInfo } from "../../../shared/unclecomp-types";
import {
  generateSymbolId,
  duplicateClaimError,
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
 * Every comp the user has selected (else the active comp), as stable item ids.
 *
 * Multi-publish must capture its targets *before* the first publish: packaging
 * bounces the session (Save-As → reduce → reopen), which destroys the selection.
 * Item ids are stored in the project file, so they survive every bounce and let
 * each subsequent publish address its comp exactly.
 */
export const listSelectedComps = (): SelectedCompInfo[] => {
  var out: SelectedCompInfo[] = [];
  var sel = app.project.selection;
  for (var i = 0; i < sel.length; i++) {
    var it = sel[i];
    if (it instanceof CompItem) out.push({ itemId: it.id, name: it.name });
  }
  if (out.length === 0) {
    var active = app.project.activeItem;
    if (active && active instanceof CompItem) {
      out.push({ itemId: active.id, name: active.name });
    }
  }
  return out;
};

/**
 * Turn a comp into a symbol (or bump an existing one).
 *
 * Pass `symbolId` to republish a specific symbol regardless of what is selected
 * in AE — that is the "Publish update" path. Pass `itemId` (with symbolId "")
 * to symbolise one specific comp — the multi-publish path, where the selection
 * is gone by the second comp. Omit both to symbolise the selection.
 *
 * Idempotent: re-running on an already-tagged comp keeps its UUID and bumps version.
 */
export const makeSymbol = (symbolId?: string, itemId?: number): EngineResult => {
  app.beginUndoGroup("UncleComp: make symbol");
  try {
    var comp: CompItem | null = null;
    if (symbolId) {
      comp = findSymbolComp(symbolId);
    } else if (itemId) {
      var byId = app.project.itemByID(itemId);
      comp = byId && byId instanceof CompItem ? byId : null;
    } else {
      comp = targetComp();
    }
    if (!comp) {
      var why = "Select a composition first.";
      if (symbolId) {
        why = "That symbol's comp isn't in this project — open its master to publish an update.";
      } else if (itemId) {
        why = "That comp is no longer in this project.";
      }
      return { ok: false, error: why };
    }
    if (!app.project.file) {
      return { ok: false, error: "Save the master project before publishing." };
    }

    var existing = parseTag(comp.comment);

    // Never publish while two comps claim the id: the "right" one would be
    // picked by scan order, so a scratch duplicate could be packaged and shipped.
    if (existing) {
      var ambiguous = duplicateClaimError(existing.symbolId);
      if (ambiguous) return { ok: false, error: ambiguous };
    }

    var id = existing ? existing.symbolId : generateSymbolId();
    var version = existing ? existing.version + 1 : 1;
    writeSymbolTag(comp, id, version);

    // The tag MUST be durable before packaging: packageSymbol Save-As'es the
    // session elsewhere and then reopens this project from disk. An in-memory
    // tag would be lost in that bounce, so the next publish would see an
    // untagged comp, mint a fresh UUID at v1, and no symbol could ever reach v2.
    app.project.save();

    return {
      ok: true,
      data: {
        symbolId: id,
        version: version,
        itemId: comp.id, // lets a later scan tell this comp from a duplicate
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
