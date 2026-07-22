/**
 * LinkOn Core Service — user settings.
 *
 * Just the shared-drive library root. Updates are never applied automatically
 * (ARCHITECTURE.md §7), so there is no mode to store alongside it.
 */

import { fs, path, os } from "../cep/node";
import { LinkOnSettings } from "../../../shared/linkon-types";

const settingsDir = (): string => path.join(os.homedir(), ".linkon");
const settingsFile = (): string => path.join(settingsDir(), "settings.json");

export const defaultSettings = (): LinkOnSettings => ({ libraryRoot: "" });

export const readSettings = (): LinkOnSettings => {
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

export const writeSettings = (settings: LinkOnSettings): void => {
  const dir = settingsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), "utf8");
};

export const setLibraryRoot = (libraryRoot: string): LinkOnSettings => {
  const next = { ...readSettings(), libraryRoot };
  writeSettings(next);
  return next;
};
