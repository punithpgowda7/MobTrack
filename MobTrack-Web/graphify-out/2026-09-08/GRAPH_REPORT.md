# Graph Report - mobtrack  (2026-09-08)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 125 nodes · 133 edges · 15 communities (10 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f2b1e20c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- dependencies
- compilerOptions
- devDependencies
- track/page.tsx
- photos/page.tsx
- include
- package.json
- layout.tsx
- delete/route.ts
- photo/route.ts
- eslint.config.mjs
- next.config.ts
- postcss.config.mjs

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `include` - 7 edges
3. `TrackInner()` - 5 edges
4. `scripts` - 5 edges
5. `orderPathHistory()` - 4 edges
6. `splitPathSegments()` - 4 edges
7. `PhotoGallery()` - 4 edges
8. `lib` - 4 edges
9. `supabase` - 4 edges
10. `MapView()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `TrackInner()` --calls--> `orderPathHistory()`  [EXTRACTED]
  app/track/page.tsx → app/track/MapView.tsx
- `TrackInner()` --calls--> `splitPathSegments()`  [EXTRACTED]
  app/track/page.tsx → app/track/MapView.tsx

## Import Cycles
- None detected.

## Communities (15 total, 5 thin omitted)

### Community 0 - "dependencies"
Cohesion: 0.11
Nodes (19): jspdf, jszip, next, dependencies, jspdf, jszip, leaflet, next (+11 more)

### Community 1 - "compilerOptions"
Cohesion: 0.11
Nodes (19): dom, dom.iterable, esnext, compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules (+11 more)

### Community 2 - "devDependencies"
Cohesion: 0.12
Nodes (17): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node (+9 more)

### Community 3 - "track/page.tsx"
Cohesion: 0.22
Nodes (13): MapView(), MapViewProps, orderPathHistory(), PATH_GAP_BREAK_MS, PathPoint, splitPathSegments(), AudioBroadcastMessage, DeviceData (+5 more)

### Community 4 - "photos/page.tsx"
Cohesion: 0.20
Nodes (12): BUTTON_LABELS, ButtonToken, Dashboard(), getPhotoUrl(), formatDate(), getFilename(), getPublicUrl(), PhotoCapture (+4 more)

### Community 5 - "include"
Cohesion: 0.20
Nodes (9): **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts, **/*.tsx, exclude (+1 more)

### Community 6 - "package.json"
Cohesion: 0.22
Nodes (8): name, private, scripts, build, dev, lint, start, version

### Community 7 - "layout.tsx"
Cohesion: 0.40
Nodes (3): geistMono, geistSans, metadata

## Knowledge Gaps
- **64 isolated node(s):** `MapViewProps`, `AudioBroadcastMessage`, `DeviceData`, `VideoBroadcastMessage`, `ButtonToken` (+59 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Why does `compilerOptions` connect `compilerOptions` to `include`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **What connects `MapViewProps`, `AudioBroadcastMessage`, `DeviceData` to the rest of the system?**
  _64 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._