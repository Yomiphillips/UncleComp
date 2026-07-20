/**
 * LinkOn Engine — preview stills (ARCHITECTURE.md §6.1).
 *
 * AE's Render Queue can no longer emit H.264/mp4, so the engine only renders
 * cheap PNGs and the Core Service hands them to ffmpeg. Frames come from a
 * quarter-size wrapper comp, which gives true 1/4-res output without touching
 * the symbol itself. Proven by spike/03_poster_and_preview.jsx.
 */

import { EngineResult } from "../../../shared/linkon-types";
import { findSymbolComp } from "./identity";

const pad3 = (n: number): string => {
  return (n < 10 ? "00" : n < 100 ? "0" : "") + n;
};

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

/**
 * Render a short quarter-resolution PNG sequence for the hover-preview loop.
 * The wrapper comp is temporary and removed afterwards.
 */
export const renderPreviewFrames = (
  symbolId: string,
  outDir: string,
  frameCount: number
): EngineResult => {
  app.beginUndoGroup("LinkOn: render preview");
  var wrapper: CompItem | null = null;
  try {
    var comp = findSymbolComp(symbolId);
    if (!comp) return { ok: false, error: "Symbol not found in this project." };

    var dir = new Folder(outDir);
    if (!dir.exists) dir.create();

    var qW = Math.round(comp.width / 4);
    var qH = Math.round(comp.height / 4);
    wrapper = app.project.items.addComp(
      "LinkOn_preview_tmp",
      qW,
      qH,
      1,
      comp.duration,
      comp.frameRate
    );
    var layer = wrapper.layers.add(comp);
    layer.transform.scale.setValue([25, 25]);
    layer.transform.position.setValue([qW / 2, qH / 2]);

    var n = frameCount > 0 ? frameCount : 24;
    for (var i = 0; i < n; i++) {
      var t = (i / n) * comp.duration;
      wrapper.saveFrameToPng(t, new File(outDir + "/frame_" + pad3(i) + ".png"));
    }

    return { ok: true, data: { frames: n, width: qW, height: qH, dir: outDir } };
  } catch (e) {
    return { ok: false, error: (e as any).toString() };
  } finally {
    if (wrapper) wrapper.remove();
    app.endUndoGroup();
  }
};
