/**
 * UncleComp Engine — preview rendering (ARCHITECTURE.md §6.1).
 *
 * Everything is rendered by After Effects itself — no external encoder.
 * H.264 was absent from AE's Render Queue between CC2014 and 2019, but Adobe
 * restored it in 17.1 (2020), so on our 2024/2025 target we write the small
 * looping preview.mp4 directly.
 *
 * Previews are deliberately the lowest practical resolution — they only ever
 * render into a ~140px card in the media browser, and they live on a shared
 * network drive. Size is controlled by a quarter-size wrapper comp with a hard
 * width cap, a reduced frame rate, a capped duration, draft render settings, and
 * the lowest-bitrate H.264 template available.
 */

import { EngineResult } from "../../../shared/unclecomp-types";
import { findSymbolComp } from "./identity";

/** Never exceed this width, so 4K/8K symbols don't produce heavy previews. */
var MAX_PREVIEW_WIDTH = 480;
var PREVIEW_DIVISOR = 4;

/** Full-res poster still for the media browser grid. */
export const renderPoster = (symbolId: string, outPath: string): EngineResult => {
  try {
    var comp = findSymbolComp(symbolId);
    if (!comp) return { ok: false, error: "Symbol not found in this project." };
    comp.saveFrameToPng(comp.duration / 2, new File(outPath));
    return { ok: true, data: { poster: outPath } };
  } catch (e) {
    return { ok: false, error: (e as any).toString() };
  }
};

/** H.264 needs even dimensions (yuv420p). */
const toEven = (n: number): number => {
  var v = Math.round(n);
  if (v % 2 !== 0) v -= 1;
  return v < 2 ? 2 : v;
};

/**
 * Pick an H.264 output module template, preferring the lowest bitrate on offer.
 * Template names differ across AE versions and locales, so we discover them at
 * runtime instead of hard-coding "H.264 - Match Render Settings - 15 Mbps".
 */
const findH264Template = (om: OutputModule): string | null => {
  var templates = om.templates;
  var best: string | null = null;
  var bestMbps = 1e9;
  for (var i = 0; i < templates.length; i++) {
    var name = templates[i];
    if (name.toLowerCase().indexOf("h.264") === -1) continue;
    var match = name.match(/([0-9.]+)\s*Mbps/i);
    // Templates with no bitrate in the name still count, but rank last.
    var mbps = match ? parseFloat(match[1]) : 1e6;
    if (mbps < bestMbps) {
      bestMbps = mbps;
      best = name;
    }
  }
  return best;
};

/** Cheapest render settings available, so previews never render at Best. */
const applyDraftSettings = (rqItem: RenderQueueItem): void => {
  try {
    var templates = rqItem.templates;
    for (var i = 0; i < templates.length; i++) {
      if (templates[i].toLowerCase().indexOf("draft") > -1) {
        rqItem.applyTemplate(templates[i]);
        return;
      }
    }
  } catch (e) {
    /* leave AE's default render settings in place */
  }
};

/** Park the user's queued renders so `render()` only runs ours. */
const isolateQueue = (): number[] => {
  var rq = app.project.renderQueue;
  var paused: number[] = [];
  for (var i = 1; i <= rq.numItems; i++) {
    var item = rq.item(i);
    if (item.status === RQItemStatus.QUEUED) {
      item.render = false;
      paused.push(i);
    }
  }
  return paused;
};

const restoreQueue = (indices: number[]): void => {
  var rq = app.project.renderQueue;
  for (var i = 0; i < indices.length; i++) {
    var index = indices[i];
    if (index <= rq.numItems) {
      try {
        rq.item(index).render = true;
      } catch (e) {
        /* item went away — nothing to restore */
      }
    }
  }
};

/**
 * Render the short looping preview.mp4 for a symbol.
 *
 * The symbol comp is never touched: a temporary wrapper carries the downscale,
 * shortened duration, and lower frame rate, then is removed.
 * Blocking, but the clip is tiny and only seconds long.
 */
export const renderPreview = (
  symbolId: string,
  outPath: string,
  maxSeconds: number,
  fps: number
): EngineResult => {
  app.beginUndoGroup("UncleComp: render preview");
  var wrapper: CompItem | null = null;
  var rqItem: RenderQueueItem | null = null;
  var paused: number[] = [];
  try {
    var comp = findSymbolComp(symbolId);
    if (!comp) return { ok: false, error: "Symbol not found in this project." };

    // Quarter size, then hard-capped so large symbols still yield small previews.
    var targetWidth = comp.width / PREVIEW_DIVISOR;
    if (targetWidth > MAX_PREVIEW_WIDTH) targetWidth = MAX_PREVIEW_WIDTH;
    var scale = targetWidth / comp.width;
    var qW = toEven(targetWidth);
    var qH = toEven(comp.height * scale);

    var previewFps = fps > 0 ? fps : 15;
    var duration = comp.duration;
    if (maxSeconds > 0 && duration > maxSeconds) duration = maxSeconds;

    wrapper = app.project.items.addComp(
      "UncleComp_preview_tmp",
      qW,
      qH,
      1,
      duration,
      previewFps
    );
    var layer = wrapper.layers.add(comp);
    layer.transform.scale.setValue([scale * 100, scale * 100]);
    layer.transform.position.setValue([qW / 2, qH / 2]);
    wrapper.workAreaStart = 0;
    wrapper.workAreaDuration = duration;

    var outFile = new File(outPath);
    if (outFile.exists) outFile.remove(); // AE will not silently overwrite

    paused = isolateQueue();
    rqItem = app.project.renderQueue.items.add(wrapper);
    applyDraftSettings(rqItem);

    var om = rqItem.outputModule(1);
    var template = findH264Template(om);
    if (!template) {
      return {
        ok: false,
        error: "No H.264 output module template found in this After Effects install.",
      };
    }
    om.applyTemplate(template);
    om.file = outFile;

    app.project.renderQueue.render();

    return {
      ok: true,
      data: {
        preview: outPath,
        width: qW,
        height: qH,
        duration: duration,
        fps: previewFps,
        template: template,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as any).toString() };
  } finally {
    if (rqItem) {
      try {
        rqItem.remove();
      } catch (e) {
        /* already gone */
      }
    }
    restoreQueue(paused);
    if (wrapper) {
      try {
        wrapper.remove();
      } catch (e) {
        /* already gone */
      }
    }
    app.endUndoGroup();
  }
};
