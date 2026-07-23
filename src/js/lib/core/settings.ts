/**
 * uncleComp Core Service — user settings.
 *
 * Just the shared-drive library root. Updates are never applied automatically
 * (ARCHITECTURE.md §7), so there is no mode to store alongside it.
 */

import { fs, path, os } from "../cep/node";
import { UncleCompSettings } from "../../../shared/unclecomp-types";

const settingsDir = (): string => path.join(os.homedir(), ".unclecomp");
const settingsFile = (): string => path.join(settingsDir(), "settings.json");

export const defaultSettings = (): UncleCompSettings => ({ libraryRoot: "" });

export const readSettings = (): UncleCompSettings => {
  try {
    const file = settingsFile();
    if (!fs.existsSync(file)) return defaultSettings();
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    // Read only what we still recognise, so a retired key (the old `updateMode`)
    // isn't carried forward on the next write.
    return { ...defaultSettings(), libraryRoot: stored.libraryRoot || "" };
  } catch {
    return defaultSettings();
  }
};

export const writeSettings = (settings: UncleCompSettings): void => {
  const dir = settingsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), "utf8");
};

export const setLibraryRoot = (libraryRoot: string): UncleCompSettings => {
  const next = { ...readSettings(), libraryRoot };
  writeSettings(next);
  return next;
};
