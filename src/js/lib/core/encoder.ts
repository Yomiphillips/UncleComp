/**
 * LinkOn Core Service — preview encoding.
 *
 * The engine renders quarter-res PNGs; ffmpeg turns them into the small looping
 * preview.mp4 the media browser plays. Encoding lives here rather than in AE
 * because modern AE's Render Queue cannot output H.264/mp4 at all
 * (ARCHITECTURE.md §6.1, §8).
 */

import { fs, child_process, path } from "../cep/node";

export interface EncodeResult {
  ok: boolean;
  output?: string;
  bytes?: number;
  error?: string;
}

export const hasFfmpeg = (): boolean => {
  try {
    const probe = child_process.spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
    return !probe.error && probe.status === 0;
  } catch {
    return false;
  }
};

/**
 * Encode `frames/frame_%03d.png` into a small looping mp4.
 * Previews are for recognition, not fidelity — a high CRF keeps them tiny on the
 * shared drive, and yuv420p with even dimensions keeps them playable everywhere.
 */
export const assemblePreview = (
  framesDirPath: string,
  outputPath: string,
  fps = 24
): EncodeResult => {
  if (!fs.existsSync(framesDirPath)) {
    return { ok: false, error: `No frames directory: ${framesDirPath}` };
  }
  if (!hasFfmpeg()) {
    return { ok: false, error: "ffmpeg not found on PATH." };
  }

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const result = child_process.spawnSync(
    "ffmpeg",
    [
      "-y",
      "-framerate", String(fps),
      "-i", path.join(framesDirPath, "frame_%03d.png"),
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-crf", "30",
      "-preset", "veryfast",
      "-movflags", "+faststart",
      outputPath,
    ],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    return { ok: false, error: result.stderr || `ffmpeg exited ${result.status}` };
  }
  return { ok: true, output: outputPath, bytes: fs.statSync(outputPath).size };
};

/** Frames are an intermediate artifact — don't leave them on the shared drive. */
export const cleanFrames = (framesDirPath: string): void => {
  try {
    if (fs.existsSync(framesDirPath)) fs.rmSync(framesDirPath, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
};
