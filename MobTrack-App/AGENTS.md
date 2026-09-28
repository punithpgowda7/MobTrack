# MobTrack Android App Developer & AI Agent Guidelines

## 1. Expo & React Native Environment
- This project is an Expo SDK 54 / React Native project built natively with Android Studio.
- Do NOT use Expo EAS cloud build; builds are done natively via Android Studio or `./android/gradlew assembleRelease`.
- Supported Architectures: `armeabi-v7a,arm64-v8a` configured in `android/gradle.properties` to keep release APK under 40 MB.

---

## 2. In-App Over-The-Air (OTA) APK Updater Architecture
MobTrack has a custom native In-App Auto-Updater engine so the user never needs to use a USB cable to install updates:

- **Native Module**: `modules/apk-updater/`
  - `ApkUpdaterModule.kt`: Handles native `versionCode` inspection, background streaming download with progress events (`onDownloadProgress`), and `FileProvider` package installation with `ClipData` and `FLAG_ACTIVITY_CLEAR_TOP`.
  - `index.ts`: TypeScript bindings with safe fallback checks.
- **Android Manifest & Permissions**:
  - `android/app/src/main/AndroidManifest.xml`: Configures `REQUEST_INSTALL_PACKAGES` and AndroidX `FileProvider` (`${applicationId}.fileprovider`).
  - `android/app/src/main/res/xml/file_paths.xml`: Cache directory path definition for package installer.
- **In-App Updater UI (`App.tsx`)**:
  - `checkForUpdates(silent)`: Queries Supabase Storage at `app_updates/<userPhone>/`.
  - `handleStartUpdate()`: Downloads APK and triggers Android system package installer.
  - `renderUpdateModal()`: Shows "New Update Available!" popup with notes, download progress bar, and "UPDATE NOW" button.
  - Manual "Check for Updates" button on Companion & Login screens.

---

## 3. Team & Collaborator Isolation Rules (CRITICAL)
The Supabase project and GitHub repository are shared among multiple teammates and collaborators.
- **User Scoping**: Every update is stored under the specific developer/user phone number:
  `secure_media/app_updates/<mobile_number>/` (e.g. `app_updates/6363738923/`).
- When the phone opens, it ONLY checks `app_updates/<logged_in_phone_number>/`. Teammates will never receive each other's updates.
- **Git Safety**: Local configuration `mobtrack.dev.json` is gitignored. Do NOT commit hardcoded personal targets.
- **Database Safety**: Never create or modify Supabase tables or schemas for updater logic. Everything uses the storage bucket `secure_media`.

---

## 4. Required Workflow for ALL Future Code Changes
Whenever implementing new features, bugfixes, or UI updates:

1. **Keep All Existing Core Features Intact**:
   - Live Camera & Video stream
   - Background Audio recording & stream
   - Background Location tracking & TaskManager
   - Fake Shutdown accessibility service
   - Fake Factory Reset (Power + Vol Down 3s)
   - In-App Over-The-Air Updater
2. **Always Bump Native Version in `android/app/build.gradle`**:
   - Increment `versionCode` by 1 (e.g. `2` -> `3`).
   - Bump `versionName` (e.g. `"1.0.1"` -> `"1.0.2"`).
   - **CRITICAL**: The compiled APK's native `versionCode` MUST match the version published to the update feed.
3. **Build the APK**:
   - In Android Studio: **Build > Build Bundle(s) / APK(s) > Build APK(s)**
   - Or in terminal: `cd android && ./gradlew assembleRelease`
4. **Publish the Update to Cloud**:
   - Run in root directory:
     ```bash
     npm run publish-update -- --notes "Summary of changes"
     ```
   - The script automatically detects the newest APK, reads version info, and uploads it to the isolated user channel in Supabase Storage.
5. **Phone Updates Over the Air**:
   - The user opens the app on their phone, sees the popup, taps **UPDATE NOW**, and Android updates the app with 1 click.
