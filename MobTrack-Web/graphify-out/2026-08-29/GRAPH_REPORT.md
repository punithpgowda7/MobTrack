# Graph Report - mobtrack  (2026-08-29)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1107 nodes · 1317 edges · 123 communities (108 shown, 15 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a2c31c87`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- devDependencies
- compilerOptions
- track/page.tsx
- layout.tsx
- eslint.config.mjs
- next.config.ts
- postcss.config.mjs
- dependencies
- fake-shutdown/index.ts
- FakeShutdownAccessibilityService
- CameraService
- .eas-inspect/package.json
- expo
- permissions
- CameraService
- expo
- .eas-inspect/App.tsx
- AudioRecordingService
- AudioRecordingService
- settings.gradle
- FakeShutdownService
- MainActivity
- MainApplication
- track/page.tsx
- .eas-inspect/tsconfig.json
- fetch_logs.js
- .eas-inspect/modules/background-audio/package.json
- modules/background-audio/package.json
- layout.tsx
- gradlew
- download_log.js
- BackgroundCameraModule
- .eas-inspect/modules/background-camera/package.json
- .eas-inspect/postinstall.js
- BackgroundCameraModule
- modules/background-camera/package.json
- fake-shutdown/package.json
- postinstall.js
- eslint.config.mjs
- lib/supabase.ts
- next.config.ts
- postcss.config.mjs
- dependencies
- fake-shutdown/index.ts
- FakeShutdownAccessibilityService
- CameraService
- .eas-inspect/package.json
- expo
- permissions
- CameraService
- expo
- .eas-inspect/App.tsx
- AudioRecordingService
- AudioRecordingService
- settings.gradle
- FakeShutdownService
- MainActivity
- MainApplication
- track/page.tsx
- .eas-inspect/tsconfig.json
- fetch_logs.js
- .eas-inspect/modules/background-audio/package.json
- modules/background-audio/package.json
- layout.tsx
- gradlew
- download_log.js
- BackgroundCameraModule
- .eas-inspect/modules/background-camera/package.json
- .eas-inspect/postinstall.js
- BackgroundCameraModule
- modules/background-camera/package.json
- fake-shutdown/package.json
- postinstall.js
- eslint.config.mjs
- lib/supabase.ts
- next.config.ts
- postcss.config.mjs

## God Nodes (most connected - your core abstractions)
1. `FakeShutdownAccessibilityService` - 28 edges
2. `CameraService` - 28 edges
3. `FakeShutdownAccessibilityService` - 28 edges
4. `CameraService` - 28 edges
5. `CameraService` - 16 edges
6. `compilerOptions` - 16 edges
7. `permissions` - 16 edges
8. `CameraService` - 16 edges
9. `permissions` - 16 edges
10. `expo` - 15 edges

## Surprising Connections (you probably didn't know these)
- `permissions` --extends--> `android.permission.CAMERA`  [EXTRACTED]
  .eas-inspect/app.json → app.json
- `permissions` --extends--> `android.permission.FOREGROUND_SERVICE_MICROPHONE`  [EXTRACTED]
  .eas-inspect/app.json → app.json
- `permissions` --extends--> `android.permission.RECORD_AUDIO`  [EXTRACTED]
  .eas-inspect/app.json → app.json
- `permissions` --extends--> `android.permission.WAKE_LOCK`  [EXTRACTED]
  .eas-inspect/app.json → app.json
- `permissions` --extends--> `FOREGROUND_SERVICE`  [EXTRACTED]
  .eas-inspect/app.json → app.json

## Import Cycles
- None detected.

## Communities (123 total, 15 thin omitted)

### Community 1 - "devDependencies"
Cohesion: 0.05
Nodes (40): eslint, eslint-config-next, jspdf, next, dependencies, jspdf, leaflet, next (+32 more)

### Community 2 - "compilerOptions"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 3 - "track/page.tsx"
Cohesion: 0.12
Nodes (10): BUTTON_LABELS, ButtonToken, BUTTON_LABELS, ButtonToken, MapViewProps, AudioBroadcastMessage, DeviceData, MapView (+2 more)

### Community 7 - "layout.tsx"
Cohesion: 0.40
Nodes (3): geistMono, geistSans, metadata

### Community 14 - "dependencies"
Cohesion: 0.05
Nodes (46): dependencies, background-audio, background-camera, base64-arraybuffer, expo, expo-build-properties, expo-camera, expo-status-bar (+38 more)

### Community 15 - "fake-shutdown/index.ts"
Cohesion: 0.05
Nodes (12): App(), LocationTaskData, s, BackgroundAudioNativeModule, emitter, BackgroundCameraModule, emitter, startVideoStream() (+4 more)

### Community 16 - "FakeShutdownAccessibilityService"
Cohesion: 0.11
Nodes (15): AccessibilityEvent, AccessibilityService, KeyEvent, LinearLayout, FakeShutdownAccessibilityService, FrameLayout, Runnable, Runnable (+7 more)

### Community 17 - "CameraService"
Cohesion: 0.10
Nodes (15): ImageAnalysis, ImageProxy, CameraService, ImageCapture, IBinder, ImageCapture, ImageCaptureException, Intent (+7 more)

### Community 18 - ".eas-inspect/package.json"
Cohesion: 0.07
Nodes (28): devDependencies, @types/react, typescript, main, name, private, scripts, android (+20 more)

### Community 19 - "expo"
Cohesion: 0.07
Nodes (28): backgroundColor, foregroundImage, adaptiveIcon, edgeToEdgeEnabled, package, predictiveBackGestureEnabled, projectId, expo (+20 more)

### Community 20 - "permissions"
Cohesion: 0.16
Nodes (18): permissions, android.permission.CAMERA, android.permission.FOREGROUND_SERVICE_MICROPHONE, android.permission.RECORD_AUDIO, android.permission.WAKE_LOCK, CAMERA, FOREGROUND_SERVICE, FOREGROUND_SERVICE_CAMERA (+10 more)

### Community 21 - "CameraService"
Cohesion: 0.14
Nodes (13): CameraService, ImageCapture, IBinder, ImageCapture, ImageCaptureException, Intent, Lifecycle, LifecycleOwner (+5 more)

### Community 22 - "expo"
Cohesion: 0.07
Nodes (28): backgroundColor, foregroundImage, adaptiveIcon, edgeToEdgeEnabled, package, predictiveBackGestureEnabled, projectId, expo (+20 more)

### Community 23 - ".eas-inspect/App.tsx"
Cohesion: 0.12
Nodes (7): App(), s, BackgroundAudioNativeModule, emitter, BackgroundCameraModule, customStorage, supabase

### Community 24 - "AudioRecordingService"
Cohesion: 0.23
Nodes (6): AudioRecordingService, IBinder, Intent, Notification, PowerManager, Service

### Community 25 - "AudioRecordingService"
Cohesion: 0.23
Nodes (6): AudioRecordingService, IBinder, Intent, Notification, PowerManager, Service

### Community 26 - "settings.gradle"
Cohesion: 0.19
Nodes (6): BackgroundAudioModule, Module, BackgroundAudioModule, Module, FakeShutdownModule, Module

### Community 27 - "FakeShutdownService"
Cohesion: 0.31
Nodes (4): FakeShutdownService, IBinder, Intent, Service

### Community 28 - "MainActivity"
Cohesion: 0.29
Nodes (5): MainActivity, DefaultReactActivityDelegate, Bundle, ReactActivity, ReactActivityDelegate

### Community 29 - "MainApplication"
Cohesion: 0.36
Nodes (6): MainApplication, Application, Configuration, ReactApplication, ReactHost, ReactNativeHost

### Community 30 - "track/page.tsx"
Cohesion: 0.25
Nodes (5): MapViewProps, AudioBroadcastMessage, DeviceData, MapView, VideoBroadcastMessage

### Community 31 - ".eas-inspect/tsconfig.json"
Cohesion: 0.22
Nodes (7): compilerOptions, strict, extends, compilerOptions, strict, extends, expo/tsconfig.base

### Community 32 - "fetch_logs.js"
Cohesion: 0.29
Nodes (6): fs, https, path, req, state, statePath

### Community 33 - ".eas-inspect/modules/background-audio/package.json"
Cohesion: 0.33
Nodes (5): description, main, name, private, version

### Community 34 - "modules/background-audio/package.json"
Cohesion: 0.33
Nodes (5): description, main, name, private, version

### Community 35 - "layout.tsx"
Cohesion: 0.40
Nodes (3): geistMono, geistSans, metadata

### Community 36 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 37 - "download_log.js"
Cohesion: 0.50
Nodes (3): fs, https, zlib

### Community 39 - ".eas-inspect/modules/background-camera/package.json"
Cohesion: 0.50
Nodes (3): main, name, version

### Community 40 - ".eas-inspect/postinstall.js"
Cohesion: 0.50
Nodes (3): filesToPatch, fs, path

### Community 42 - "modules/background-camera/package.json"
Cohesion: 0.50
Nodes (3): main, name, version

### Community 43 - "fake-shutdown/package.json"
Cohesion: 0.50
Nodes (3): main, name, version

### Community 44 - "postinstall.js"
Cohesion: 0.50
Nodes (3): filesToPatch, fs, path

### Community 71 - "dependencies"
Cohesion: 0.05
Nodes (46): dependencies, background-audio, background-camera, base64-arraybuffer, expo, expo-build-properties, expo-camera, expo-status-bar (+38 more)

### Community 72 - "fake-shutdown/index.ts"
Cohesion: 0.05
Nodes (12): App(), LocationTaskData, s, BackgroundAudioNativeModule, emitter, BackgroundCameraModule, emitter, startVideoStream() (+4 more)

### Community 73 - "FakeShutdownAccessibilityService"
Cohesion: 0.11
Nodes (15): AccessibilityEvent, AccessibilityService, KeyEvent, LinearLayout, FakeShutdownAccessibilityService, FrameLayout, Runnable, Runnable (+7 more)

### Community 74 - "CameraService"
Cohesion: 0.10
Nodes (15): ImageAnalysis, ImageProxy, CameraService, ImageCapture, IBinder, ImageCapture, ImageCaptureException, Intent (+7 more)

### Community 75 - ".eas-inspect/package.json"
Cohesion: 0.07
Nodes (28): devDependencies, @types/react, typescript, main, name, private, scripts, android (+20 more)

### Community 76 - "expo"
Cohesion: 0.07
Nodes (28): backgroundColor, foregroundImage, adaptiveIcon, edgeToEdgeEnabled, package, predictiveBackGestureEnabled, projectId, expo (+20 more)

### Community 77 - "permissions"
Cohesion: 0.16
Nodes (18): permissions, android.permission.CAMERA, android.permission.FOREGROUND_SERVICE_MICROPHONE, android.permission.RECORD_AUDIO, android.permission.WAKE_LOCK, CAMERA, FOREGROUND_SERVICE, FOREGROUND_SERVICE_CAMERA (+10 more)

### Community 78 - "CameraService"
Cohesion: 0.14
Nodes (13): CameraService, ImageCapture, IBinder, ImageCapture, ImageCaptureException, Intent, Lifecycle, LifecycleOwner (+5 more)

### Community 79 - "expo"
Cohesion: 0.07
Nodes (28): backgroundColor, foregroundImage, adaptiveIcon, edgeToEdgeEnabled, package, predictiveBackGestureEnabled, projectId, expo (+20 more)

### Community 80 - ".eas-inspect/App.tsx"
Cohesion: 0.12
Nodes (7): App(), s, BackgroundAudioNativeModule, emitter, BackgroundCameraModule, customStorage, supabase

### Community 81 - "AudioRecordingService"
Cohesion: 0.23
Nodes (6): AudioRecordingService, IBinder, Intent, Notification, PowerManager, Service

### Community 82 - "AudioRecordingService"
Cohesion: 0.23
Nodes (6): AudioRecordingService, IBinder, Intent, Notification, PowerManager, Service

### Community 83 - "settings.gradle"
Cohesion: 0.19
Nodes (6): BackgroundAudioModule, Module, BackgroundAudioModule, Module, FakeShutdownModule, Module

### Community 84 - "FakeShutdownService"
Cohesion: 0.31
Nodes (4): FakeShutdownService, IBinder, Intent, Service

### Community 85 - "MainActivity"
Cohesion: 0.29
Nodes (5): MainActivity, DefaultReactActivityDelegate, Bundle, ReactActivity, ReactActivityDelegate

### Community 86 - "MainApplication"
Cohesion: 0.36
Nodes (6): MainApplication, Application, Configuration, ReactApplication, ReactHost, ReactNativeHost

### Community 87 - "track/page.tsx"
Cohesion: 0.25
Nodes (5): MapViewProps, AudioBroadcastMessage, DeviceData, MapView, VideoBroadcastMessage

### Community 88 - ".eas-inspect/tsconfig.json"
Cohesion: 0.22
Nodes (7): compilerOptions, strict, extends, compilerOptions, strict, extends, expo/tsconfig.base

### Community 89 - "fetch_logs.js"
Cohesion: 0.29
Nodes (6): fs, https, path, req, state, statePath

### Community 90 - ".eas-inspect/modules/background-audio/package.json"
Cohesion: 0.33
Nodes (5): description, main, name, private, version

### Community 91 - "modules/background-audio/package.json"
Cohesion: 0.33
Nodes (5): description, main, name, private, version

### Community 92 - "layout.tsx"
Cohesion: 0.40
Nodes (3): geistMono, geistSans, metadata

### Community 93 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 94 - "download_log.js"
Cohesion: 0.50
Nodes (3): fs, https, zlib

### Community 96 - ".eas-inspect/modules/background-camera/package.json"
Cohesion: 0.50
Nodes (3): main, name, version

### Community 97 - ".eas-inspect/postinstall.js"
Cohesion: 0.50
Nodes (3): filesToPatch, fs, path

### Community 99 - "modules/background-camera/package.json"
Cohesion: 0.50
Nodes (3): main, name, version

### Community 100 - "fake-shutdown/package.json"
Cohesion: 0.50
Nodes (3): main, name, version

### Community 101 - "postinstall.js"
Cohesion: 0.50
Nodes (3): filesToPatch, fs, path

## Knowledge Gaps
- **328 isolated node(s):** `LocationTaskData`, `ButtonToken`, `ButtonToken`, `MapViewProps`, `AudioBroadcastMessage` (+323 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `permissions` connect `permissions` to `expo`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Why does `android` connect `expo` to `permissions`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **What connects `LocationTaskData`, `ButtonToken`, `ButtonToken` to the rest of the system?**
  _328 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.06896551724137931 - nodes in this community are weakly interconnected._
- **Should `track/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.11904761904761904 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.05217391304347826 - nodes in this community are weakly interconnected._