# UncleComp — Architecture & Roadmap

**A "linked symbols" system for After Effects.** Mark any comp as a reusable Symbol/Link,
browse and preview those symbols in a panel, drop them into any project, and have edits to
the master propagate to every project that uses them.

Status: planning. This document is the architecture proposal and phased roadmap.

---

## 1. The core problem (read this first)

After Effects has **no native concept of a linked/instanced comp** across projects:

- **Adobe Dynamic Link** connects After Effects → Premiere Pro / Media Encoder. It does **not**
  live-link an AE comp into *another AE project*.
- Importing another `.aep` **copies** items in. There is no live back-reference to the source.
- `.mogrt` (Motion Graphics Templates) package a comp for reuse — but they're consumed in
  Premiere's Essential Graphics panel, not re-imported live into other AE projects.
- **Team Projects** is cloud co-editing of a single project, not a reusable-symbol library.

**Consequence:** the "symbol" and the "auto-sync everywhere" behavior must be built by us on top
of AE's scripting DOM. There is no hook to flip on. Everything below is designed around that fact.

The good news: AE scripting exposes exactly the primitives we need to *emulate* symbols
convincingly — most importantly `AVLayer.replaceSource()`, which swaps a layer's source comp/footage
while **preserving that layer's transforms, effects, masks, and keyframes**. That one API is what
makes non-destructive updates possible.

---

## 2. Feasibility summary — what's realistic

| Capability | Feasible? | How |
|---|---|---|
| "Make this comp a Symbol/Link" | ✅ | Assign a stable UUID, package the comp, publish to a library |
| Browse + preview symbols in a panel | ✅ | HTML panel (CEP) with poster thumbnails + short **quarter-res** looping video |
| Import a symbol into the current project | ✅ | Import a packaged single-comp `.aep`, tag + register it |
| Update master → sync the **currently open** project | ✅ | `replaceSource()` swap, driven by version diff |
| Update master → sync **every project ever used**, live, untouched | ⚠️ | Not natively. Requires each project to *pull on open*, or a batch updater that opens projects headlessly. See §8. |
| Preserve the editor's local layout/timing when a symbol updates | ✅ | `replaceSource` keeps the *instance* edits; only the symbol's internal content changes |
| Preserve local edits to the symbol's *internal* layers | ❌ (by design) | Symbols are read-only locally; overriding internals defeats sync. Policy in §7 |

The one honest limitation to set expectations on now: **we can only edit a project that is open.**
"Sync everywhere automatically" is delivered as *sync-on-open per project* plus an optional
*batch updater*, not as reaching into closed files on disk.

---

## 3. Platform & tech stack

**Target:** After Effects **2024/2025 (latest only)** — lets us rely on modern scripting APIs
(`CompItem.saveFrameToPng`, current render-queue behavior) without legacy fallbacks.

**Boilerplate:** [Bolt CEP](https://github.com/hyperbrew/bolt-cep) (Vite + TypeScript + React, HMR,
`types-for-adobe`, ZXP packaging) — chosen so we write modern typed code on both sides and get
end-to-end type safety across the panel↔ExtendScript boundary via `evalTS`.

### Recommended: **CEP panel + ExtendScript + Node.js**

- **CEP (Common Extensibility Platform)** — HTML/CSS/JS panel embedded in AE. Mature, well-documented,
  supports rich UI (the media browser needs thumbnails, grids, drag-drop).
- **Node.js integration** (CEP `--enable-nodejs`) — gives us `fs`, file watching, hashing, and HTTP
  directly in the panel. This is the decisive advantage: the library store, watcher, and registry
  logic all live here.
- **ExtendScript (`.jsx`)** — the only layer that can touch the AE project DOM (import, iterate items,
  `replaceSource`, render frames). Called from the panel via `CSInterface.evalScript`.

### Why not UXP (yet)

UXP is Adobe's newer platform and the eventual successor to CEP. But for After Effects specifically
its scripting-API coverage is still maturing and its sandbox restricts filesystem/watcher access that
this project leans on heavily. **Plan:** build on CEP now; keep the ExtendScript "engine" cleanly
separated so a UXP front-end can be swapped in later (see §4). Treat CEP's eventual sunset as a
tracked strategic risk (§9), not a blocker today.

### Why not C++ (AEGP SDK)

Native plug-ins can hook events (e.g. true "on import" detection) but cost enormous complexity and
per-platform builds. Not needed for MVP. Revisit only if event-driven detection becomes essential.

---

## 4. System architecture

Five components, deliberately decoupled so the DOM logic is isolated from UI and storage:

```
┌──────────────────────────────────────────────────────────────┐
│  Panel UI  (CEP / HTML + JS)                                   │
│  • Media browser: symbol grid, thumbnails, search, filters     │
│  • Actions: Make Symbol · Import · Check Updates · Sync         │
│  • Update notifications / badges                                │
└───────────────┬───────────────────────────┬──────────────────┘
                │ CSInterface.evalScript      │ direct (Node)
                ▼                             ▼
┌───────────────────────────┐   ┌──────────────────────────────┐
│  Engine  (ExtendScript)   │   │  Core Service  (Node in CEP)  │
│  • import packaged .aep     │   │  • Library manifest read/write│
│  • iterate items / layers   │   │  • fs.watch on library        │
│  • replaceSource() swaps    │   │  • hashing / versioning       │
│  • saveFrameToPng previews  │   │  • per-project registry (JSON) │
│  • reduceProject packaging  │   │  • conflict/dependency resolve │
│  • beginUndoGroup wrapping  │   └───────────────┬──────────────┘
└───────────────────────────┘                   │
                                                 ▼
                              ┌──────────────────────────────────┐
                              │  Library Store                    │
                              │  (shared folder → later a server) │
                              │  library.json (manifest)          │
                              │  symbols/<uuid>/                  │
                              │    package.aep  (single-comp)     │
                              │    poster.png                     │
                              │    preview.mp4 (later)            │
                              │    meta.json                      │
                              └──────────────────────────────────┘
```

- **Publisher** and **Subscriber** are *roles*, not separate apps — the same panel behaves as a
  Publisher when running in the master project ("Make Symbol", "Publish update") and as a Subscriber
  in a working project ("Import", "Sync").
- Keeping **Engine** (ExtendScript) as a stateless command layer and **Core Service** (Node) as the
  stateful brain is what lets us later replace CEP with UXP: the Engine is the only AE-coupled piece.

---

## 5. Data model

### 5.1 Symbol identity (the crux)

Reliable sync needs an ID that **survives being imported into a new project**. AE's internal
`item.id` is per-project and not stable across import, so we mint our own.

- **`symbolId`** — a UUID we generate when a comp is first made a Symbol.
- **Where it lives so it travels with the comp:** the comp's **`comment`** field, written at publish
  time, e.g. `UNCLECOMP:{symbolId}:{version}`. Because *we* package the symbol's `.aep`, we control the
  comment before saving, so the ID is embedded in the artifact and can be read back on import. This
  closes the identity loop without depending on the destination project at all.
- **Fallback / repair:** if a comment is stripped or edited, the panel offers a manual "relink to
  symbol" action.

### 5.2 Library manifest — `library.json`

```jsonc
{
  "version": 1,
  "symbols": {
    "8f3c…": {
      "symbolId": "8f3c…",
      "name": "Lower Third — Brand",
      "sourceProject": "Master/brand-master.aep",
      "currentVersion": 7,          // integer bumped on publish
      "contentHash": "sha256:…",    // hash of package.aep for change detection
      "package": "symbols/8f3c…/package.aep",
      "poster": "symbols/8f3c…/poster.png",
      "preview": "symbols/8f3c…/preview.mp4",   // short loop, 1/4 resolution, size-optimized
      "dependencies": ["a1b2…"],    // nested symbols this one uses
      "tags": ["lower-third", "brand"],
      "updatedAt": "2026-07-20T…",
      "updatedBy": "adebayo"
    }
  }
}
```

### 5.3 Per-project registry — `<project>.unclecomp.json` (sidecar)

Records which symbols a given working project uses and at what version, so we can diff against the
library and drive updates:

```jsonc
{
  "projectId": "…",
  "instances": {
    "8f3c…": {
      "symbolId": "8f3c…",
      "importedVersion": 5,
      "compName": "Lower Third — Brand",
      "itemId": 42          // AE item id — tells the original from a duplicate (§8)
    }
  }
}
```

The sidecar is a convenience/cache; the source of truth for "which symbols are in this project" is
always re-derivable by scanning item comments (§5.1), so a lost sidecar is recoverable.

---

## 6. Core workflows

### 6.1 Make Symbol / Publish  (Publisher role)

1. User selects a comp → **"Make Symbol"**.
2. Engine assigns/reads `symbolId`, writes `UNCLECOMP:{id}:{version}` to the comp's `comment`,
   **and saves the master project**. That save is not optional: packaging (step 3) reopens the
   master from disk, so an unsaved tag would be lost, the next publish would mint a fresh UUID
   at v1, and no symbol could ever reach v2 — i.e. updates would never exist.
   Republishing overwrites `symbols/<uuid>/` in place and replaces the manifest entry; there is
   one artifact set per symbol, and the version integer only marks who is behind.
3. Package a **single-comp `.aep`**: duplicate the project in memory / a temp copy, `reduceProject()`
   down to the chosen comp + its dependencies, save as `symbols/<uuid>/package.aep`.
   *(reduceProject is destructive on the live project, so it runs against a saved copy — never the
   user's open project.)*
4. Render previews **entirely inside After Effects** — no external encoder. A `poster.png` via
   `CompItem.saveFrameToPng()`, and a short looping `preview.mp4` via the **Render Queue's H.264
   output module**. Previews are the lowest practical resolution: a quarter-size wrapper comp with a
   hard **480px width cap** (so 4K/8K symbols stay small), **15fps**, a **3-second cap**, draft render
   settings, and the lowest-bitrate H.264 template found at runtime. The symbol comp itself is never
   modified — the temporary wrapper carries the downscale and is removed afterwards.
5. Core Service writes/updates `library.json` (bump `currentVersion`, new `contentHash`).

### 6.2 Browse & preview  (Subscriber role)

- Panel reads `library.json`, renders a grid of poster thumbnails with search/tags.
- Hover/click → plays the short **1/4-res** looping `preview.mp4`.

### 6.3 Import / Link into current project

1. User clicks **Import** on a symbol.
2. Engine imports `symbols/<uuid>/package.aep` into a dedicated `UncleComp/` bin, renaming AE's
   `package.aep` import folder to the comp's own name.
3. If a comp is focused (open timeline, or selected in the Project panel), the symbol is also added
   to it as a layer at the top of the stack, starting at the playhead. With nothing focused it just
   lands in the bin.
4. Read the `symbolId` from the imported comp's comment; register in the sidecar + confirm the
   comment tag. The comp is now a *linked instance* the user can drop into their timelines like any comp.

### 6.4 Update / Sync (the payoff)

Detection is automatic — on panel load, whenever the pointer enters the panel (a click-free,
throttled re-scan; regaining focus and un-hiding the panel group still trigger it too), which is
how a newly opened project is picked up since AE fires no scriptable project-open event, and on
`fs.watch` firing when a teammate publishes. The panel deliberately does not poll the host. **Applying is
always manual:** the panel raises out-of-date badges and the user presses **Update** on a symbol
or **Update all**. See §7.

1. Core Service diffs sidecar `importedVersion` vs manifest `currentVersion` per symbol.
2. For each outdated symbol, Engine (inside one `beginUndoGroup`):
   a. Import the new `package.aep` as a temporary new comp.
   b. Find every layer whose `.source` is the old symbol comp (scan all comps' layers).
   c. `layer.replaceSource(newComp, /*fixExpressions*/ true)` on each — **this preserves the
      editor's per-instance transforms, effects, masks, and keyframes**; only the symbol's internal
      content changes.
   d. **Verify** no layer still sources the old comp (`AVItem.usedIn` is empty). `Item.remove()`
      deletes the layers using an item, so a partial swap must abort *before* anything is deleted.
   e. Retire the whole previous import — its comp, precomps, footage, solids and folder — not just
      the comp. An import brings in the symbol's full dependency set, so removing only the comp
      orphans the rest and the project accumulates a dead `package.aep` folder per update.
      Each item is skipped if anything outside the retiring set still uses it, and those are
      reported back rather than silently kept.
   f. Update sidecar + comment version.

Imports are parked in a per-symbol folder under the `UncleComp/` bin, tagged `UNCLECOMP:{id}:{version}`
on the *folder* as well as the comp — the comp tag identifies the symbol, the folder tag is what
lets a later update find and retire precisely that version's items. Imports predating this still
sync correctly: their assets stay reachable from the comp, so the retiring set is derived by
walking layer sources instead.
3. Panel confirms what updated.

### 6.5 Propagate across many projects

- **Baseline:** every project auto-checks on open (§6.4). Open a project → it's current.
- **Optional batch updater (v2):** a "Projects using this symbol" list; the updater opens each
  registered project headlessly (BridgeTalk / scripted app instance), runs §6.4, saves, closes.

### 6.6 Edit a symbol

- **"Edit Symbol"** on any linked instance resolves the symbol → its **master project** (path stored
  as a hint in the manifest) and **opens that master `.aep`**, focusing the source comp. Authoring
  happens only there; on the next publish, §6.4 propagates the change. Consumer-side instances are
  never edited in place (they're read-only, §7). If the stored master path is stale (moved/renamed),
  the panel prompts the user to locate the master and updates the hint.

---

## 7. Key policies & decisions baked in

- **Updates are never applied automatically.** Detection is automatic; applying is not. The panel
  badges what is out of date and the user presses **Update** or **Update all**. An auto-sync mode was
  built and then removed: a timeline changing underneath an editor without them asking is a worse
  failure than being one click behind, and a single always-manual path is far easier to reason about
  than two modes. There is no update-mode setting.
- **Symbols are locally read-only.** Editing a symbol's *internal* layers in a consumer project is
  disallowed/warned — otherwise sync would overwrite local work and identity gets ambiguous. Instance-
  level edits (position/scale/effects on the *layer* using the symbol) are fully preserved and are the
  intended customization surface.
- **All DOM mutations wrapped in `app.beginUndoGroup`/`endUndoGroup`** so any sync is a single undo.
- **Non-destructive to the user's open project during publish** — packaging always runs on a copy.
- **Identity travels in the artifact** (comment tag), not in the destination project, so imports are
  self-describing.

---

## 8. Edge cases & risks

| Risk | Mitigation |
|---|---|
| "Sync everywhere" implies closed files update themselves | Reframe as sync-on-open + batch updater; set expectation in UI copy |
| Nested symbols / symbol-within-symbol | Track `dependencies` in manifest; resolve update order topologically |
| Expressions break when a source is replaced | `replaceSource(…, true)` fix-expressions flag; flag unresolved ones |
| Symbol comment stripped or hand-edited | Manual "relink" repair flow; sidecar as secondary index |
| **Duplicating a symbol comp** — AE copies `comment`, so the copy claims the original's `symbolId` (confirmed behaviour) | A contested symbol is never resolved by guessing: the next scan raises a conflict banner and the user picks which comp *is* the symbol, and the rest are detached in one undo group — so exactly one comp always keeps the identity (it can never be reduced to zero). Publish and sync **refuse** while a symbol is contested rather than picking by scan order — which could package a scratch copy or half-update a project |
| Publishing saves the user's master project | Unavoidable — identity must be durable before the packaging bounce (§6.1). Surfaced in the button's tooltip; publish is an explicit, user-initiated action |
| A consumer republishing a symbol they don't own | "Publish update" only appears when the open project *is* the symbol's `sourceProject` master (§6.6) |
| Missing fonts / third-party effects on consumer machine | Detect + warn on import; list unmet dependencies |
| Comp name collisions on import | Namespace imports under a `UncleComp/` bin; disambiguate by `symbolId` |
| Two people publish the same symbol at once | Version integers + `contentHash`; last-write detection, later a lock (v2) |
| Master project moved/renamed | Library store is the source of truth, not the master path; store path only as a hint |
| Large master → slow packaging | `reduceProject` to just the symbol + deps keeps packages small |
| H.264 output module missing/renamed across AE versions or locales | Discover templates at runtime and pick the lowest bitrate; report clearly if none exists |
| Preview render disturbing the user's Render Queue | Queued items are un-queued around our render and restored afterwards |
| **CEP deprecation over time** | Engine/UI separation lets a UXP front-end replace CEP later (§3, §9) |

---

## 9. Roadmap

### Phase 0 — De-risking spike (prove the hard parts before any UI) — **scaffolded, see [`spike/`](spike/)**
Runnable throwaway tests now live in [`spike/`](spike/) (run instructions in [`spike/README.md`](spike/README.md)):
- **`01_replace_source_fidelity.jsx`** — the critical one: `replaceSource()` swap that **preserves** an
  instance's transforms, keyframes, effects, masks, trim, and stretch.
- **`02_package_and_reimport.jsx`** — UUID-in-`comment` survives `reduceProject` → single-comp `.aep` → re-import.
- **`03_poster_and_preview.jsx`** — `saveFrameToPng` poster + 1/4-res stills.
- **`node/fs-watch-test.js`** — atomic manifest write + `fs.watch` (Core Service assumptions).
> Exit criteria: a scripted round-trip (publish → import → edit master → re-package → swap) works and
> the consumer's layout survives. If `replaceSource` fidelity is insufficient, revisit before building UI.

### Phase 1 — MVP (small team, shared network drive) — **foundation scaffolded**
Code layout is documented in [README.md](README.md#project-layout). Built, type-checked, and
symlinked into AE's extensions folder. Remaining Phase 1 work is noted per item below.
- ✅ CEP panel skeleton + ExtendScript engine bridge + Core Service (Node).
- **Make Symbol** (publish: UUID, package, **1/4-res looping `preview.mp4` + poster**, manifest write).
- **Media browser** (grid, poster thumbnails, hover-plays the loop, search).
- **Import/Link** into current project (bin, tag, sidecar register).
- **User-initiated updates** (§7): badges appear on their own, **Update** / **Update all** apply them.
- **Shared-drive safety:** atomic manifest writes (write-temp-then-rename) so concurrent readers
  never see a half-written `library.json`.
> Deliverable: a small team can symbol-ize comps to a network share, browse/preview them, import
> elsewhere, and update when they choose to.

### Phase 2 — v1 (robustness)
- ✅ `fs.watch` on the share for live update badges; re-check when the pointer enters the panel (or it regains focus).
- Nested-symbol dependency resolution (topological update).
- **Publish concurrency:** manifest locking / optimistic-version checks so two editors publishing
  at once can't clobber each other on the shared drive.
- Registry health / relink-repair UI; read-only symbol enforcement.
- Missing-dependency (font/effect) warnings.

### Phase 3 — v2 (team & scale)
- Library store on a **server** (HTTP/S3/Git-LFS) with auth, replacing the shared folder.
- **Batch propagation**: headless open of registered projects (BridgeTalk/aerender) to push updates.
- Multi-user publish locking, version history, rollback.
- Evaluate **UXP** front-end migration ahead of CEP sunset.

---

## 10. Decisions

**Locked:**
1. **Team / storage** — small team on a **shared network drive** (folder-based, with atomic writes now
   and publish locking in v1). Server/cloud deferred to v2.
2. **Sync trust** — **always user-initiated.** Detection is automatic, applying never is. *(Revised:
   this was originally "both, as a setting". Auto-sync was built, then removed — a mode that changes
   a timeline without being asked isn't worth the second code path. See §7.)*
3. **Preview** — **short looping video at 1/4 resolution**, size-optimized, from the MVP.
4. **AE version** — **latest only (2024/2025)**.
5. **"Edit the symbol" path** — editing a symbol **always opens the master project**. No local
   checkout/publish-back flow. The master `.aep` is the single place a symbol's internals are authored;
   consumer projects only ever hold read-only linked instances.
```
