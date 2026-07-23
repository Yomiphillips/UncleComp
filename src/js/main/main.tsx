import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyAllUpdates,
  applyUpdate,
  assetUrl,
  checkForUpdates,
  currentProjectPath,
  deleteSymbol,
  editSymbol,
  findDuplicateClaims,
  importSymbolToProject,
  isCEP,
  isMasterProject,
  keepSymbolCopy,
  listProjectSymbols,
  loadLibrary,
  publishSelectedComp,
  publishSymbolUpdate,
  readSettings,
  relocateMaster,
  resyncRegistry,
  revokeAssetUrl,
  setLibraryRoot,
  watchLibrary,
} from "../lib/core";
import type { DuplicateClaim } from "../lib/core";
import type {
  UncleCompSettings,
  PendingUpdate,
  SymbolMeta,
} from "../../shared/unclecomp-types";
import "./main.scss";

const DUPLICATE_HINT =
  "Two comps claim this symbol — resolve the duplicate above before publishing or updating.";

/** Shortest gap between hover-triggered re-scans; each one round-trips into AE. */
const HOVER_RESCAN_COOLDOWN_MS = 1500;

/** Native folder picker; CEP exposes this on window.cep.fs. */
const chooseFolder = (): string | null => {
  const cep = (window as any).cep;
  if (!cep || !cep.fs || !cep.fs.showOpenDialog) return null;
  const res = cep.fs.showOpenDialog(false, true, "Choose UncleComp library folder", "");
  return res && res.data && res.data.length ? res.data[0] : null;
};

/** Native .aep picker — used to relocate a symbol's moved/renamed master project. */
const chooseProjectFile = (): string | null => {
  const cep = (window as any).cep;
  if (!cep || !cep.fs || !cep.fs.showOpenDialog) return null;
  const res = cep.fs.showOpenDialog(false, false, "Locate the master project", "", ["aep"]);
  return res && res.data && res.data.length ? res.data[0] : null;
};

const SymbolCard = ({
  symbol,
  pending,
  inProject,
  canPublish,
  canEdit,
  conflicted,
  busy,
  onImport,
  onUpdate,
  onPublish,
  onEdit,
  onDelete,
}: {
  symbol: SymbolMeta;
  pending?: PendingUpdate;
  /** This symbol's comp exists in the open project (imported copy or master). */
  inProject: boolean;
  /** The open project is this symbol's master — the only place it may be authored. */
  canPublish: boolean;
  /** A master project is recorded, so "Edit" has somewhere to open (§6.6). */
  canEdit: boolean;
  /** Two comps claim this symbol — the engine refuses to publish or sync it. */
  conflicted: boolean;
  busy: boolean;
  onImport: (s: SymbolMeta) => void;
  onUpdate: (s: SymbolMeta) => void;
  onPublish: (s: SymbolMeta) => void;
  onEdit: (s: SymbolMeta) => void;
  onDelete: (s: SymbolMeta) => void;
}) => {
  const video = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  // Delete removes the symbol for the whole team, so it asks first — inline on
  // the card rather than via window.confirm, which CEP can have disabled.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [posterUrl, setPosterUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");

  // Re-read on `updatedAt` so a republish shows the new frame rather than the
  // cached one — the path is identical across versions.
  useEffect(() => {
    const url = assetUrl(symbol.poster);
    setPosterUrl(url);
    return () => revokeAssetUrl(url);
  }, [symbol.poster, symbol.updatedAt]);

  // Previews are ~250KB each; only pay for the ones actually hovered.
  useEffect(() => {
    if (!hover || !symbol.preview) return;
    const url = assetUrl(symbol.preview);
    setPreviewUrl(url);
    return () => revokeAssetUrl(url);
  }, [hover, symbol.preview, symbol.updatedAt]);

  // Only play on hover — a grid of autoplaying loops is unreadable and costly.
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (hover) {
      el.play().catch(() => {});
    } else {
      el.pause();
      el.currentTime = 0;
    }
  }, [hover, previewUrl]);

  return (
    <div
      className="card"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setConfirmingDelete(false); // don't leave a half-armed delete behind
      }}
    >
      <div className="thumb">
        {posterUrl && <img src={posterUrl} alt={symbol.name} />}
        {previewUrl && (
          <video
            ref={video}
            className={hover ? "visible" : ""}
            src={previewUrl}
            muted
            loop
            playsInline
          />
        )}
        {pending && <span className="dot" title={`v${pending.toVersion} available`} />}

        {/* Kept visible mid-confirm even if the pointer drifts, so the choice
            isn't yanked away underneath the user. */}
        <div className={confirmingDelete ? "overlay visible" : "overlay"}>
          {confirmingDelete ? (
            <>
              <span className="confirm-label">Delete for everyone?</span>
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  setConfirmingDelete(false);
                  onDelete(symbol);
                }}
                title="Remove this symbol from the shared library"
              >
                Delete
              </button>
              <button disabled={busy} onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {/* Destructive action, pushed to the far left away from the rest. */}
              <button
                className="danger trash"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
                title="Delete from library"
                aria-label="Delete"
              >
                ✕
              </button>
              {canEdit && (
                <button
                  disabled={busy}
                  onClick={() => onEdit(symbol)}
                  title="Edit — open the master project"
                  aria-label="Edit"
                >
                  ✎
                </button>
              )}
              {!inProject && (
                <button
                  disabled={busy}
                  onClick={() => onImport(symbol)}
                  title="Import into project"
                  aria-label="Import"
                >
                  +
                </button>
              )}
              {pending && (
                <button
                  className="primary"
                  disabled={busy || conflicted}
                  onClick={() => onUpdate(symbol)}
                  title={conflicted ? DUPLICATE_HINT : `Update to v${pending.toVersion}`}
                  aria-label="Update"
                >
                  ↻
                </button>
              )}
              {/* Master is open and current — this is where an edit becomes v(n+1). */}
              {canPublish && !pending && (
                <button
                  className="primary"
                  disabled={busy || conflicted}
                  onClick={() => onPublish(symbol)}
                  title={
                    conflicted
                      ? DUPLICATE_HINT
                      : `Publish v${symbol.currentVersion + 1} — packages this comp and saves the project`
                  }
                  aria-label="Publish"
                >
                  ↑
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="meta">
        <span
          className="name"
          title={`${symbol.name} · v${symbol.currentVersion} · ${symbol.width}×${symbol.height}`}
        >
          {symbol.name}
        </span>
        <span className="ver">v{symbol.currentVersion}</span>
      </div>
    </div>
  );
};

export const App = () => {
  const [settings, setSettings] = useState<UncleCompSettings>({ libraryRoot: "" });
  const [symbols, setSymbols] = useState<SymbolMeta[]>([]);
  const [pending, setPending] = useState<PendingUpdate[]>([]);
  const [inProject, setInProject] = useState<{ [id: string]: boolean }>({});
  const [duplicates, setDuplicates] = useState<DuplicateClaim[]>([]);
  const [projectPath, setProjectPath] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  // Read inside the watcher callback, which closes over a stale `busy`.
  const busyRef = useRef(false);
  busyRef.current = busy;
  // When we last re-scanned, so a hover re-scan can skip if one just ran —
  // otherwise darting the pointer in and out round-trips into AE every crossing.
  const lastScanRef = useRef(0);

  const conflictedIds = useMemo(() => {
    const map: { [id: string]: boolean } = {};
    duplicates.forEach((d) => (map[d.symbolId] = true));
    return map;
  }, [duplicates]);

  const pendingById = useMemo(() => {
    const map: { [id: string]: PendingUpdate } = {};
    pending.forEach((p) => (map[p.symbolId] = p));
    return map;
  }, [pending]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return symbols;
    return symbols.filter((s) => s.name.toLowerCase().indexOf(q) > -1);
  }, [symbols, query]);

  const refresh = useCallback(async (root: string) => {
    if (!root) return;
    setSymbols(loadLibrary(root));
    try {
      const instances = await listProjectSymbols();
      const open = await currentProjectPath();
      setProjectPath(open);

      // A duplicated comp arrives already claiming the original's identity,
      // because AE copies the comment too. Rather than guess which comp is the
      // "real" symbol and silently strip the other, every conflict is raised to
      // the user, who chooses which comp to keep (see the duplicate banner
      // below). Publish and sync stay refused until then.
      setDuplicates(findDuplicateClaims(instances));

      const present: { [id: string]: boolean } = {};
      instances.forEach((i) => (present[i.symbolId] = true));
      setInProject(present);
      setPending(await checkForUpdates(root, instances));
    } catch {
      // No AE host (browser dev) — the library still renders.
    } finally {
      lastScanRef.current = Date.now();
    }
  }, []);

  // Moving the pointer onto the panel is already a reliable "I'm about to use
  // this — show me the current project" signal, and it needs no click. Throttled
  // so it re-scans at most once per cooldown: mouseenter can fire repeatedly as
  // the pointer grazes the panel edge, and each scan round-trips into AE.
  const rescanOnHover = useCallback(() => {
    if (busyRef.current) return; // never re-read mid-flow
    if (!settings.libraryRoot) return;
    if (Date.now() - lastScanRef.current < HOVER_RESCAN_COOLDOWN_MS) return;
    refresh(settings.libraryRoot);
  }, [settings.libraryRoot, refresh]);

  useEffect(() => {
    const loaded = readSettings();
    setSettings(loaded);
    if (loaded.libraryRoot) refresh(loaded.libraryRoot);
  }, [refresh]);

  // AE exposes no scriptable "project opened" event. Rather than poll the host,
  // the panel also re-reads when it regains focus or is re-shown in a docked
  // group — the hover re-scan above covers the common case without a click, and
  // these catch the rest (alt-tabbing back, un-hiding the panel group).
  useEffect(() => {
    if (!settings.libraryRoot) return;
    const resync = () => {
      if (busyRef.current) return; // never re-read mid-flow
      if (document.hidden) return; // the hide half of visibilitychange
      refresh(settings.libraryRoot);
    };
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      window.removeEventListener("focus", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [settings.libraryRoot, refresh]);

  // A teammate's publish lands as a manifest write on the share, which raises the
  // out-of-date badges. Nothing is ever applied without the user asking.
  useEffect(() => {
    if (!settings.libraryRoot || !isCEP()) return;
    const watcher = watchLibrary(settings.libraryRoot, () => {
      if (busyRef.current) return; // never re-read mid-flow
      refresh(settings.libraryRoot);
    });
    return () => watcher.close();
  }, [settings.libraryRoot, refresh]);

  const run = async (label: string, fn: () => Promise<{ message: string }>) => {
    setBusy(true);
    setStatus(label + "…");
    try {
      const res = await fn();
      setStatus(res.message);
    } catch (e: any) {
      setStatus("Failed: " + (e && e.message ? e.message : e));
    } finally {
      setBusy(false);
      refresh(settings.libraryRoot);
    }
  };

  const pickLibrary = () => {
    const folder = chooseFolder();
    if (!folder) return;
    setSettings(setLibraryRoot(folder));
    refresh(folder);
  };

  if (!settings.libraryRoot) {
    return (
      <div className="app setup">
        <span className="wordmark">UncleComp</span>
        <p>Point UncleComp at the shared folder your team uses as the symbol library.</p>
        <button className="primary" onClick={pickLibrary}>
          Choose folder
        </button>
      </div>
    );
  }

  return (
    <div className="app" onMouseEnter={rescanOnHover}>
      <header>
        <div className="row">
          <span className="wordmark">UncleComp</span>
          <span className="spacer" />
          <button onClick={pickLibrary} title={settings.libraryRoot}>
            Library
          </button>
        </div>
        <div className="row">
          <input
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="primary new"
            disabled={busy}
            title="Make a symbol from the selected comp"
            aria-label="Make symbol"
            onClick={() => run("Publishing", () => publishSelectedComp(settings.libraryRoot))}
          >
            +
          </button>
        </div>
      </header>

      {/* Duplicating a comp copies its UncleComp identity, so two comps now claim
          one symbol. We never guess which is the real one — the engine refuses to
          publish or sync until the user picks. Choosing which to keep detaches
          the rest, so exactly one comp always carries the symbol. */}
      {duplicates.map((dup) => (
        <div className="banner warn" key={dup.symbolId}>
          <span>
            {dup.claimants.length} conflicts “{dup.name}”. Which one is the
            right symbol?
          </span>
          {dup.claimants.map((claimant) => (
            <button
              key={claimant.itemId}
              disabled={busy}
              title={`Keep "${claimant.compName}" as the symbol and detach the other copies`}
              onClick={() =>
                run("Resolving", () =>
                  keepSymbolCopy(dup.symbolId, claimant.itemId, claimant.compName)
                )
              }
            >
              Keep “{claimant.compName}”
            </button>
          ))}
        </div>
      ))}

      {pending.length > 0 && (
        <div className="banner">
          <span>{pending.length} out of date</span>
          <button
            className="primary"
            disabled={busy}
            onClick={() => run("Updating", () => applyAllUpdates(settings.libraryRoot))}
          >
            Update all
          </button>
        </div>
      )}

      <main className="grid">
        {visible.map((symbol) => (
          <SymbolCard
            key={symbol.symbolId}
            symbol={symbol}
            pending={pendingById[symbol.symbolId]}
            inProject={!!inProject[symbol.symbolId]}
            canPublish={
              !!inProject[symbol.symbolId] && isMasterProject(symbol, projectPath)
            }
            canEdit={!!symbol.sourceProject}
            conflicted={!!conflictedIds[symbol.symbolId]}
            busy={busy}
            onImport={(s) =>
              run("Importing", () => importSymbolToProject(settings.libraryRoot, s.symbolId))
            }
            onUpdate={(s) => run("Updating", () => applyUpdate(settings.libraryRoot, s.symbolId))}
            onPublish={(s) =>
              run("Publishing", () => publishSymbolUpdate(settings.libraryRoot, s.symbolId))
            }
            onEdit={(s) =>
              run("Opening master", async () => {
                let res = await editSymbol(settings.libraryRoot, s.symbolId);
                // Stale hint: master moved/renamed. Let the user point at it, then
                // relink so the fix sticks and retry the open in one go.
                if (!res.ok && res.data && res.data.needsRelocate) {
                  const picked = chooseProjectFile();
                  if (!picked) {
                    return { message: `Locate the master for "${s.name}" to edit it.` };
                  }
                  res = await relocateMaster(settings.libraryRoot, s.symbolId, picked);
                }
                return res;
              })
            }
            onDelete={(s) =>
              run("Deleting", () => deleteSymbol(settings.libraryRoot, s.symbolId))
            }
          />
        ))}
        {!visible.length && (
          <p className="empty">
            {symbols.length
              ? "No matches."
              : "No symbols yet — select a comp and press +."}
          </p>
        )}
      </main>

      <footer>
        <span className="status">{status}</span>
        <span className="spacer" />
        <button disabled={busy} onClick={() => run("Rebuilding", resyncRegistry)}>
          Repair registry
        </button>
      </footer>
    </div>
  );
};
