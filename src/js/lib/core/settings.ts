/**
 * LinkOn Core Service — user settings.
 *
 * Holds the shared-drive library root and the update mode. Update mode is a
 * setting rather than a fixed behaviour (ARCHITECTURE.md §7): some editors want
 * projects to silently pull the latest, others never want a timeline to change
 * without being asked. Stored per user; a project may override it later.
 */

import { fs, path, os } from "../cep/node";
import { LinkOnSettings, UpdateMode } from "../../../shared/linkon-types";

const settingsDir = (): string => path.join(os.homedir(), ".linkon");
const settingsFile = (): string => path.join(settingsDir(), "settings.json");

export const defaultSettings = (): LinkOnSettings => ({
  libraryRoot: "",
  updateMode: "prompt", // safest default: never surprise an editor mid-project
});

export const readSettings = (): LinkOnSettings => {
  try {
    const file = settingsFile();
    if (!fs.existsSync(file)) return defaultSettings();
    return { ...defaultSettings(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
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

export const setUpdateMode = (updateMode: UpdateMode): LinkOnSettings => {
  const next = { ...readSettings(), updateMode };
  writeSettings(next);
  return next;
};
