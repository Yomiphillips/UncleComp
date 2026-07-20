import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscribeBackgroundColor } from "../lib/utils/bolt";
import {
  applyAllUpdates,
  applyUpdate,
  checkForUpdates,
  fileUrl,
  importSymbolToProject,
  isCEP,
  loadLibrary,
  publishSelectedComp,
  readSettings,
  resyncRegistry,
  setLibraryRoot,
  setUpdateMode,
  watchLibrary,
} from "../lib/core";
import type {
  LinkOnSettings,
  PendingUpdate,
  SymbolMeta,
} from "../../shared/linkon-types";
import "./main.scss";

/** Native folder picker; CEP exposes this on window.cep.fs. */
const chooseFolder = (): string | null => {
  const cep = (window as any).cep;
  if (!cep || !cep.fs || !cep.fs.showOpenDialog) return null;
  const res = cep.fs.showOpenDialog(false, true, "Choose LinkOn library folder", "");
  return res && res.data && res.data.length ? res.data[0] : null;
};

const SymbolCard = ({
  symbol,
  pending,
  busy,
  onImport,
  onUpdate,
}: {
  symbol: SymbolMeta;
  pending?: PendingUpdate;
  busy: boolean;
  onImport: (s: SymbolMeta) => void;
  onUpdate: (s: SymbolMeta) => void;
}) => {
  const video = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);

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
  }, [hover]);

  return (
    <div
      className="card"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="thumb">
        {symbol.poster && <img src={fileUrl(symbol.poster)} alt={symbol.name} />}
        {symbol.preview && (
          <video
            ref={video}
            className={hover ? "visible" : ""}
            src={fileUrl(symbol.preview)}
            muted
            loop
            playsInline
          />
        )}
        {pending && <span className="badge">v{pending.toVersion}</span>}
      </div>

      <div className="meta">
        <span className="name" title={symbol.name}>
          {symbol.name}
        </span>
        <span className="sub">
          v{symbol.currentVersion} · {symbol.width}×{symbol.height}
        </span>
      </div>

      <div className="actions">
        <button disabled={busy} onClick={() => onImport(symbol)}>
          Import
        </button>
        {pending && (
          <button className="primary" disabled={busy} onClick={() => onUpdate(symbol)}>
            Update
          </button>
        )}
      </div>
    </div>
  );
};

export const App = () => {
  const [bgColor, setBgColor] = useState("#1e1f22");
  const [settings, setSettings] = useState<LinkOnSettings>({
    libraryRoot: "",
    updateMode: "prompt",
  });
  const [symbols, setSymbols] = useState<SymbolMeta[]>([]);
  const [pending, setPending] = useState<PendingUpdate[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

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
      setPending(await checkForUpdates(root));
    } catch {
      // No AE host (browser dev) — the library still renders.
    }
  }, []);

  useEffect(() => {
    if (isCEP()) subscribeBackgroundColor(setBgColor);
    const loaded = readSettings();
    setSettings(loaded);
    if (loaded.libraryRoot) {
      refresh(loaded.libraryRoot).then(async () => {
        if (loaded.updateMode === "auto") {
          const res = await applyAllUpdates(loaded.libraryRoot);
          setStatus(res.message);
          refresh(loaded.libraryRoot);
        }
      });
    }
  }, [refresh]);

  // Live badges: a teammate's publish lands as a manifest write on the share.
  useEffect(() => {
    if (!settings.libraryRoot || !isCEP()) return;
    const watcher = watchLibrary(settings.libraryRoot, () => refresh(settings.libraryRoot));
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

  const toggleMode = () => {
    const next = settings.updateMode === "auto" ? "prompt" : "auto";
    setSettings(setUpdateMode(next));
    setStatus(
      next === "auto"
        ? "Auto-sync on: projects pull the latest automatically."
        : "Prompt mode on: you approve every update."
    );
  };

  if (!settings.libraryRoot) {
    return (
      <div className="app setup" style={{ backgroundColor: bgColor }}>
        <h1>LinkOn</h1>
        <p>
          Choose the shared folder your team uses as the symbol library. It will hold{" "}
          <code>library.json</code> plus each symbol's package and preview.
        </p>
        <button className="primary" onClick={pickLibrary}>
          Choose library folder
        </button>
      </div>
    );
  }

  return (
    <div className="app" style={{ backgroundColor: bgColor }}>
      <header>
        <div className="row">
          <strong>LinkOn</strong>
          <span className="spacer" />
          <button onClick={toggleMode} title="How updates reach your projects">
            {settings.updateMode === "auto" ? "Auto-sync" : "Prompt"}
          </button>
          <button onClick={pickLibrary} title={settings.libraryRoot}>
            Library…
          </button>
        </div>
        <div className="row">
          <input
            placeholder="Search symbols"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy}
            onClick={() => run("Publishing", () => publishSelectedComp(settings.libraryRoot))}
          >
            Make Symbol
          </button>
        </div>
      </header>

      {pending.length > 0 && (
        <div className="banner">
          <span>
            {pending.length} symbol{pending.length > 1 ? "s" : ""} out of date
          </span>
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
            busy={busy}
            onImport={(s) =>
              run("Importing", () => importSymbolToProject(settings.libraryRoot, s.symbolId))
            }
            onUpdate={(s) => run("Updating", () => applyUpdate(settings.libraryRoot, s.symbolId))}
          />
        ))}
        {!visible.length && (
          <p className="empty">
            {symbols.length
              ? "No symbols match your search."
              : "No symbols yet — select a comp and choose Make Symbol."}
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
