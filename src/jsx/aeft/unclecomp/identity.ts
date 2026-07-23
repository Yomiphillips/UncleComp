/**
 * LinkOn Engine — symbol identity.
 *
 * A symbol's UUID lives in the comp's `comment` field so it survives being
 * packaged and imported into another project (ARCHITECTURE.md §5.1).
 * Validated by spike/02_package_and_reimport.jsx.
 */

import {
  EngineResult,
  formatTag,
  parseTag,
  stripTag,
  SymbolTag,
  SymbolInstanceInfo,
} from "../../../shared/linkon-types";

/** RFC4122 v4, ES3-safe (no crypto in ExtendScript). */
export const generateSymbolId = (): string => {
  var hex = "0123456789abcdef";
  var s = "";
  for (var i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) s += "-";
    if (i === 12) {
      s += "4";
      continue;
    }
    if (i === 16) {
      s += hex.charAt((Math.floor(Math.random() * 16) & 0x3) | 0x8);
      continue;
    }
    s += hex.charAt(Math.floor(Math.random() * 16));
  }
  return s;
};

export const readSymbolTag = (item: Item): SymbolTag | null => {
  return parseTag(item.comment);
};

export const writeSymbolTag = (
  item: Item,
  symbolId: string,
  version: number
): void => {
  item.comment = formatTag(symbolId, version);
};

/**
 * Every comp claiming a given symbolId. Normally one — more than one means the
 * user duplicated the comp, because AE copies `comment` along with it.
 */
export const findSymbolComps = (symbolId: string): CompItem[] => {
  var found: CompItem[] = [];
  var proj = app.project;
  for (var i = 1; i <= proj.numItems; i++) {
    var it = proj.item(i);
    if (it instanceof CompItem) {
      var tag = parseTag(it.comment);
      if (tag && tag.symbolId === symbolId) found.push(it);
    }
  }
  return found;
};

/** Find the comp carrying a given symbolId in the open project. */
export const findSymbolComp = (symbolId: string): CompItem | null => {
  var comps = findSymbolComps(symbolId);
  return comps.length > 0 ? comps[0] : null;
};

/**
 * Guard against acting on a duplicated symbol — returns the problem, or "" when
 * exactly one comp claims the id.
 *
 * A symbolId names a single *definition*, and publish, sync and cleanup all
 * assume that. Resolving a tie by taking the first match in project scan order
 * is a coin flip with real consequences: publishing would package whichever copy
 * happened to be found (possibly a scratch duplicate, shipped to the whole team),
 * and syncing would repoint and retire one copy while layers using the other
 * silently keep the old version. So ambiguity is refused, never guessed.
 */
export const duplicateClaimError = (symbolId: string): string => {
  var comps = findSymbolComps(symbolId);
  if (comps.length < 2) return "";

  var names: string[] = [];
  for (var i = 0; i < comps.length; i++) names.push('"' + comps[i].name + '"');
  return (
    comps.length +
    " comps in this project claim this symbol (" +
    names.join(", ") +
    "). Duplicating a comp copies its LinkOn identity too. Detach the copy that " +
    "should not be the symbol, then try again."
  );
};

/**
 * Resolve a duplicate: keep the comp the user picked as the symbol, and strip
 * the LinkOn identity from every *other* comp claiming the same `symbolId`,
 * leaving them as ordinary comps.
 *
 * The user names the survivor, so there is no original to guess at — `keepItemId`
 * is addressed by item id rather than name because the whole point of a duplicate
 * is that the comps look alike, and names are exactly what cannot be trusted to
 * tell them apart. If the chosen comp is no longer present (deleted between the
 * scan and the click) we detach nothing and report it: detaching the rest would
 * otherwise strip the symbol's last tag, leaving no comp to receive updates.
 */
export const keepSymbolComp = (
  symbolId: string,
  keepItemId: number
): EngineResult => {
  app.beginUndoGroup("LinkOn: resolve duplicated symbol");
  try {
    var comps = findSymbolComps(symbolId);

    var keep: CompItem | null = null;
    for (var i = 0; i < comps.length; i++) {
      if (comps[i].id === keepItemId) keep = comps[i];
    }
    if (!keep) {
      return {
        ok: false,
        error: "That comp is no longer in this project — rescan and choose again.",
      };
    }

    var detached: string[] = [];
    for (var k = 0; k < comps.length; k++) {
      if (comps[k].id === keep.id) continue;
      comps[k].comment = stripTag(comps[k].comment);
      detached.push(comps[k].name);
    }
    return { ok: true, data: { detached: detached, kept: keep.name } };
  } catch (e) {
    return { ok: false, error: (e as any).toString() };
  } finally {
    app.endUndoGroup();
  }
};

/**
 * Every linked symbol in the open project. This is the authoritative answer —
 * the sidecar registry is only a cache, so a lost sidecar is always recoverable.
 */
export const listSymbolInstances = (): SymbolInstanceInfo[] => {
  var out: SymbolInstanceInfo[] = [];
  var proj = app.project;
  for (var i = 1; i <= proj.numItems; i++) {
    var it = proj.item(i);
    if (it instanceof CompItem) {
      var tag = parseTag(it.comment);
      if (tag) {
        out.push({
          symbolId: tag.symbolId,
          version: tag.version,
          compName: it.name,
          itemId: it.id,
        });
      }
    }
  }
  return out;
};

/** Absolute path of the open project, or "" when it has never been saved. */
export const getProjectPath = (): string => {
  return app.project.file ? app.project.file.fsName : "";
};
