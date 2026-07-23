# UncleComp

**Linked symbols for After Effects.** Mark any comp as a reusable Symbol, browse and preview it
in the panel, drop it into any project, and have edits to the master propagate everywhere it's used.

After Effects has no native linked-comp concept — Dynamic Link only connects AE to Premiere/Media
Encoder, and importing an `.aep` just copies items with no back-reference. UncleComp builds that
missing layer on top of AE's scripting DOM. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full
design and roadmap.

---

## Requirements

- **After Effects 2024 or 2025** (the only supported targets)
- **Node.js 18+**
- CEP `PlayerDebugMode` enabled, so AE will load an unsigned dev panel

No external encoder is needed — posters and preview loops are rendered by After Effects itself
via `saveFrameToPng` and the Render Queue's H.264 output module.

## Getting started

```bash
npm install
npm run build     # builds and symlinks the panel into AE's extensions folder
```

Then restart After Effects and open **Window → Extensions → UncleComp**.

On first run the panel asks for the **library folder** — the shared network location the team
publishes symbols to. It will contain `library.json` plus a folder per symbol.

### Day-to-day

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload (panel served to AE) |
| `npm run build` | Production build + symlink into the CEP extensions folder |
| `npm run zxp` | Package a signed ZXP for distribution |
| `npm run symlink` / `delsymlink` | Manage the extensions-folder symlink |

---

## Project layout

Built on [Bolt CEP](https://github.com/hyperbrew/bolt-cep) (Vite + TypeScript + React, with
type-safe ExtendScript via `evalTS`). The three components from the architecture map onto the
tree like this:

```
src/
  shared/
    unclecomp-types.ts     Domain model + identity tag helpers (used by BOTH sides)
    universals.d.ts        Engine → panel event contract

  jsx/aeft/                ENGINE — the only layer touching the AE DOM (ExtendScript)
    aeft.ts                Command surface exposed to the panel via evalTS
    unclecomp/
      identity.ts          UUID minting, comment tags, finding linked symbols
      publish.ts           Make Symbol + reduceProject packaging
      importer.ts          Import a package, read its identity back
      sync.ts              replaceSource() swap — the update mechanic
      cleanup.ts           Retire a superseded import, guarded by usedIn
      preview.ts           Poster + low-res H.264 preview via the Render Queue
      edit.ts              Open the master project to author a symbol

  js/lib/core/             CORE SERVICE — the stateful brain (Node, inside CEP)
    paths.ts               Library layout on the shared drive
    manifest.ts            library.json, atomic writes, content hashing
    registry.ts            Per-project registry (in the .aep's XMP) + pending-update diffing
    settings.ts            Library root
    watcher.ts             fs.watch on the share → live update badges
    service.ts             Flow orchestration (publish / import / sync)

  js/main/                 PANEL UI — the media browser
    main.tsx               Symbol grid, hover previews, update banner
```

The engine is a **stateless command layer** and the Core Service holds all state. That split is
deliberate: it keeps AE-specific code in one place, so a future UXP front-end only has to replace
the UI (ARCHITECTURE.md §3, §4).

## How identity works

A symbol's UUID is stamped into its comp's `comment` field as `UNCLECOMP:<uuid>:<version>` at publish
time. Because we build the package, the identity is baked into the artifact — an imported symbol is
self-describing and depends on nothing in the destination project. The per-project registry is
stored inside the .aep itself (in the project's XMP metadata — no sidecar files) and is only a
cache; **Repair registry** rebuilds it by scanning comments. Legacy `<project>.unclecomp.json`
sidecars are imported into XMP and deleted on first read.

## Status

Phase 1 foundation. See the roadmap in [ARCHITECTURE.md](ARCHITECTURE.md) §9.
The `spike/` folder holds the Phase 0 de-risking tests that validated `replaceSource()` fidelity,
the packaging round-trip, and preview rendering before this was built.
