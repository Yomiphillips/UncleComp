/**
 * LinkOn Engine — importing a packaged symbol (ARCHITECTURE.md §6.3).
 *
 * Packages are single-comp .aep files with the identity already baked into the
 * comp's comment, so an import is self-describing: we read the UUID back out
 * rather than trusting anything about the destination project.
 */

import { EngineResult, parseTag } from "../../../shared/linkon-types";

var LINKON_BIN = "LinkOn";

/** Namespaced bin so imported symbols never collide with the user's own items. */
const ensureLinkOnBin = (): FolderItem => {
  var proj = app.project;
  for (var i = 1; i <= proj.numItems; i++) {
    var it = proj.item(i);
    if (it instanceof FolderItem && it.name === LINKON_BIN) return it;
  }
  return proj.items.addFolder(LINKON_BIN);
};

const snapshotItemIds = (): { [id: number]: boolean } => {
  var ids: { [id: number]: boolean } = {};
  var proj = app.project;
  for (var i = 1; i <= proj.numItems; i++) ids[proj.item(i).id] = true;
  return ids;
};

/**
 * Import a package and return the comp it contributed.
 *
 * We diff item IDs across the import rather than searching by tag alone: during a
 * sync the *old* comp carries the same symbolId, so tag matching on its own would
 * happily return the stale comp we are trying to replace.
 */
export const importSymbolPackage = (
  packagePath: string,
  expectSymbolId?: string
): CompItem | null => {
  var file = new File(packagePath);
  if (!file.exists) return null;

  var before = snapshotItemIds();
  app.project.importFile(new ImportOptions(file));

  var proj = app.project;
  var fallback: CompItem | null = null;
  for (var i = 1; i <= proj.numItems; i++) {
    var it = proj.item(i);
    if (before[it.id]) continue; // pre-existing, not from this import
    if (!(it instanceof CompItem)) continue;
    var tag = parseTag(it.comment);
    if (!tag) continue;
    if (!expectSymbolId || tag.symbolId === expectSymbolId) return it;
    if (!fallback) fallback = it;
  }
  return fallback;
};

/** Panel-facing import: bring a symbol into the open project for the first time. */
export const importSymbol = (
  packagePath: string,
  symbolId: string
): EngineResult => {
  app.beginUndoGroup("LinkOn: import symbol");
  try {
    var comp = importSymbolPackage(packagePath, symbolId);
    if (!comp) {
      return { ok: false, error: "No tagged comp found in package: " + packagePath };
    }
    comp.parentFolder = ensureLinkOnBin();
    var tag = parseTag(comp.comment);
    return {
      ok: true,
      data: {
        symbolId: tag ? tag.symbolId : symbolId,
        version: tag ? tag.version : 0,
        compName: comp.name,
        itemId: comp.id,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as any).toString() };
  } finally {
    app.endUndoGroup();
  }
};
