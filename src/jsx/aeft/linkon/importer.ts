/**
 * LinkOn Engine — importing a packaged symbol (ARCHITECTURE.md §6.3).
 *
 * Packages are single-comp .aep files with the identity already baked into the
 * comp's comment, so an import is self-describing: we read the UUID back out
 * rather than trusting anything about the destination project.
 */

import { EngineResult, formatTag, parseTag } from "../../../shared/linkon-types";

var LINKON_BIN = "LinkOn";

/** A package import: the symbol's comp, plus every item the import created. */
export interface ImportedPackage {
  comp: CompItem;
  items: Item[];
}

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
 * Import a package and return its comp *and* everything else it dragged in.
 *
 * The full item list matters: a package carries the symbol's precomps, footage
 * and solids, and an update has to be able to retire exactly that set later
 * rather than orphaning it (see cleanup.ts).
 *
 * We diff item IDs across the import rather than searching by tag alone: during a
 * sync the *old* comp carries the same symbolId, so tag matching on its own would
 * happily return the stale comp we are trying to replace.
 */
export const importSymbolPackage = (
  packagePath: string,
  expectSymbolId?: string
): ImportedPackage | null => {
  var file = new File(packagePath);
  if (!file.exists) return null;

  var before = snapshotItemIds();
  app.project.importFile(new ImportOptions(file));

  var proj = app.project;
  var items: Item[] = [];
  var comp: CompItem | null = null;
  var fallback: CompItem | null = null;

  for (var i = 1; i <= proj.numItems; i++) {
    var it = proj.item(i);
    if (before[it.id]) continue; // pre-existing, not from this import
    items.push(it);
    if (!(it instanceof CompItem)) continue;
    var tag = parseTag(it.comment);
    if (!tag) continue;
    if (!expectSymbolId || tag.symbolId === expectSymbolId) {
      if (!comp) comp = it;
    } else if (!fallback) {
      fallback = it;
    }
  }

  var chosen = comp || fallback;
  if (!chosen) return null;
  return { comp: chosen, items: items };
};

/**
 * Park an import in its own tagged folder under the LinkOn bin.
 *
 * The folder tag is what lets a later update find and retire precisely this
 * version's items — the comp's own tag only identifies the comp. Only the
 * import's top-level items are moved, so the package's internal folder structure
 * survives intact.
 */
export const organiseImport = (
  imported: ImportedPackage,
  symbolId: string,
  version: number,
  folderName: string
): FolderItem => {
  var fromImport: { [id: number]: boolean } = {};
  for (var i = 0; i < imported.items.length; i++) {
    fromImport[imported.items[i].id] = true;
  }

  // Rename AE's own import folder rather than nesting inside it — wrapping would
  // just push the stale "package.aep" name one level down instead of removing it.
  var container: FolderItem | null = null;
  for (var j = 0; j < imported.items.length; j++) {
    var candidate = imported.items[j];
    if (!(candidate instanceof FolderItem)) continue;
    var candidateParent = candidate.parentFolder;
    if (candidateParent && fromImport[candidateParent.id]) continue; // nested
    container = candidate;
    break;
  }

  if (container) {
    container.name = folderName;
  } else {
    container = app.project.items.addFolder(folderName); // package had no folder
  }
  container.parentFolder = ensureLinkOnBin();
  container.comment = formatTag(symbolId, version);

  for (var k = 0; k < imported.items.length; k++) {
    var item = imported.items[k];
    if (item.id === container.id) continue;
    var parent = item.parentFolder;
    if (parent && fromImport[parent.id]) continue; // already nested in the import
    item.parentFolder = container;
  }

  return container;
};

/** Panel-facing import: bring a symbol into the open project for the first time. */
export const importSymbol = (
  packagePath: string,
  symbolId: string
): EngineResult => {
  app.beginUndoGroup("LinkOn: import symbol");
  try {
    var imported = importSymbolPackage(packagePath, symbolId);
    if (!imported) {
      return { ok: false, error: "No tagged comp found in package: " + packagePath };
    }
    var comp = imported.comp;
    var tag = parseTag(comp.comment);
    organiseImport(imported, symbolId, tag ? tag.version : 0, comp.name);
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
