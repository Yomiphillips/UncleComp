/**
 * LinkOn Engine — symbol identity.
 *
 * A symbol's UUID lives in the comp's `comment` field so it survives being
 * packaged and imported into another project (ARCHITECTURE.md §5.1).
 * Validated by spike/02_package_and_reimport.jsx.
 */

import {
  formatTag,
  parseTag,
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

/** Find the comp carrying a given symbolId in the open project. */
export const findSymbolComp = (symbolId: string): CompItem | null => {
  var proj = app.project;
  for (var i = 1; i <= proj.numItems; i++) {
    var it = proj.item(i);
    if (it instanceof CompItem) {
      var tag = parseTag(it.comment);
      if (tag && tag.symbolId === symbolId) return it;
    }
  }
  return null;
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
