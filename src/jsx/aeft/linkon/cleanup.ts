/**
 * LinkOn Engine — retiring a superseded symbol import.
 *
 * Importing a package `.aep` brings in far more than the symbol's comp: every
 * precomp, footage item and solid it depends on arrives too, inside a folder AE
 * names after the file. Removing only the comp on update orphans all of that, so
 * a project accumulated a dead `package.aep` folder and a full set of unused
 * assets on every single update.
 *
 * The dangerous part is that `Item.remove()` also deletes every layer using that
 * item. So nothing here removes anything that is still referenced from outside
 * the retiring set — the guard is what stands between a cleanup and silently
 * deleting the user's work.
 */

import { parseTag } from "../../../shared/linkon-types";

export interface CleanupReport {
  removed: number;
  /** Names of items deliberately left behind because something still uses them. */
  kept: string[];
}

/** The folder a tagged import lives in, so an update can retire exactly it. */
export const findSymbolFolder = (symbolId: string): FolderItem | null => {
  var proj = app.project;
  for (var i = 1; i <= proj.numItems; i++) {
    var it = proj.item(i);
    if (it instanceof FolderItem) {
      var tag = parseTag(it.comment);
      if (tag && tag.symbolId === symbolId) return it;
    }
  }
  return null;
};

/**
 * A comp plus everything reachable from it through layer sources.
 * The fallback for imports made before symbols were foldered — their assets are
 * scattered, but they are all still reachable from the comp itself.
 */
export const collectDependencies = (comp: CompItem): Item[] => {
  var found: Item[] = [comp];
  var seen: { [id: number]: boolean } = {};
  seen[comp.id] = true;

  var queue: CompItem[] = [comp];
  while (queue.length > 0) {
    var current = queue.pop() as CompItem;
    for (var i = 1; i <= current.numLayers; i++) {
      var layer = current.layer(i);
      if (!(layer instanceof AVLayer)) continue;
      var source = layer.source;
      if (!source || seen[source.id]) continue;
      seen[source.id] = true;
      found.push(source);
      if (source instanceof CompItem) queue.push(source);
    }
  }
  return found;
};

/** Everything inside a folder — contents first, deepest folders before their parents. */
export const collectFolder = (folder: FolderItem): Item[] => {
  var contents: Item[] = [];
  var folders: FolderItem[] = [folder];

  var queue: FolderItem[] = [folder];
  while (queue.length > 0) {
    var current = queue.pop() as FolderItem;
    for (var i = 1; i <= current.numItems; i++) {
      var it = current.item(i);
      if (it instanceof FolderItem) {
        folders.push(it);
        queue.push(it);
      } else {
        contents.push(it);
      }
    }
  }

  // Folders last and innermost-first, so each is empty by the time we reach it.
  var ordered: Item[] = contents;
  for (var f = folders.length - 1; f >= 0; f--) ordered.push(folders[f]);
  return ordered;
};

/** Is anything outside the retiring set still using this item? */
const usedOutside = (item: Item, retiring: { [id: number]: boolean }): boolean => {
  var users = (item as AVItem).usedIn; // folders have no usedIn
  if (!users) return false;
  for (var i = 0; i < users.length; i++) {
    if (!retiring[users[i].id]) return true;
  }
  return false;
};

/**
 * Remove a retiring set, skipping anything still referenced from outside it and
 * any folder that did not end up empty. Also sweeps the containers the items
 * came out of once they are empty — that is what finally clears the stale
 * `package.aep` folder AE creates on every import.
 */
export const removeRetiredItems = (items: Item[]): CleanupReport => {
  var retiring: { [id: number]: boolean } = {};
  for (var i = 0; i < items.length; i++) retiring[items[i].id] = true;

  var removed = 0;
  var kept: string[] = [];
  var containers: FolderItem[] = [];
  var seenContainer: { [id: number]: boolean } = {};

  for (var j = 0; j < items.length; j++) {
    var item = items[j];

    if (item instanceof FolderItem) {
      if (item.numItems > 0) {
        kept.push(item.name); // something inside survived — the folder must too
        continue;
      }
    } else if (usedOutside(item, retiring)) {
      kept.push(item.name);
      continue;
    }

    // Read the parent before removal, so we can sweep it if it empties out.
    var parent = item.parentFolder;
    if (parent && !seenContainer[parent.id]) {
      seenContainer[parent.id] = true;
      containers.push(parent);
    }

    try {
      item.remove();
      removed++;
    } catch (e) {
      kept.push(item.name);
    }
  }

  var rootId = app.project.rootFolder.id;
  for (var c = 0; c < containers.length; c++) {
    var container = containers[c];
    if (retiring[container.id]) continue; // already handled above
    if (container.id === rootId) continue;
    if (container.numItems > 0) continue;
    try {
      container.remove();
      removed++;
    } catch (e) {
      /* still referenced somehow — leaving it costs nothing */
    }
  }

  return { removed: removed, kept: kept };
};
