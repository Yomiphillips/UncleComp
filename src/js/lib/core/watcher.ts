/**
 * LinkOn Core Service — library watcher.
 *
 * Watching `library.json` is what turns "check for updates" into live update
 * badges (ARCHITECTURE.md §9 Phase 2). Publishes land as an atomic rename, which
 * can surface as one or several events, so changes are debounced.
 *
 * `fs.watch` semantics vary across platforms and are weakest over network
 * shares — if the shared drive proves unreliable we swap this single module for
 * chokidar (or add polling) without touching anything else.
 */

import { fs } from "../cep/node";

export interface LibraryWatcher {
  close: () => void;
}

export const watchLibrary = (
  root: string,
  onChange: () => void,
  debounceMs = 250
): LibraryWatcher => {
  if (!root || !fs.existsSync(root)) return { close: () => {} };

  let timer: any = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };

  let watcher: any;
  try {
    watcher = fs.watch(root, (_event: string, filename: string | null) => {
      if (!filename || filename === "library.json") fire();
    });
  } catch {
    return { close: () => {} };
  }

  return {
    close: () => {
      if (timer) clearTimeout(timer);
      try {
        watcher.close();
      } catch {
        /* already gone */
      }
    },
  };
};
