# 🛡️ MobTrack — Anti-Tamper Security & Multi-Layered Mobile Theft Prevention System

> **Smart India Hackathon (SIH 2026)**  
> **Problem Statement ID:** `SIH26199`  
> **Problem Statement Title:** *Lost/Stolen Mobile Tracking & Anti-Tamper Security for Mobile Theft Prevention*  
> **Team ID:** `146006` | **Team Name:** `AURA+`  

---

## 📌 Executive Summary

**MobTrack** is a production-grade, multi-layered anti-theft, stealth tracking, anti-tamper deception, and real-time forensic evidence-gathering ecosystem engineered to defeat modern thief tactics.

When smartphones are stolen, thieves execute standard playbook moves within 10 seconds:
1. **Swipe down to turn on Airplane Mode or turn off Wi-Fi/Mobile Data.**
2. **Eject the SIM card to sever cellular tracking.**
3. **Power off the phone or hold hardware buttons to enter Bootloader/Recovery mode for a hard factory reset.**

Traditional tracking solutions (Google Find My Device, Apple Find My) become **100% useless** once the phone is offline or powered off. **MobTrack** solves this through **Dual-Channel Tracking (WebSockets + Offline MT1 SMS Relay)**, **Fake Deception Overlays (Fake Shutdown & Fake Recovery)**, **Stealth Intruder Evidence Vault**, and **Automated Law Enforcement PDF Reporting**.

---

## 🌟 Comprehensive Feature Breakdown (Why Built & Impact)

| # | Feature Name | Why It Was Built | Technical & User Impact |
|---|---|---|---|
| **1** | **Dual-Channel Tracking Engine** *(Online WebSockets + Offline SMS Relay)* | Standard tools die when Wi-Fi and Mobile Data are turned off. | Operates over low-latency WebSockets when online (<2 sec latency). Automatically falls back to an **offline SMS Relay protocol (MT1)** when offline, allowing users to track devices with zero mobile data. |
| **2** | **Fake Shutdown Interceptor & Screen Overlay** | Thieves hold the Power button within 5 seconds of snatching a phone to turn it off. | Intercepts native Android power menu via Accessibility Service. Plays a realistic power-off animation, turns the screen pitch black, mutes audio/vibrations, and locks hardware buttons—making the thief believe the phone is off while CPU, GPS, camera, and network remain 100% active. |
| **3** | **Fake Recovery / Bootloader Interceptor** | Tech-savvy thieves hold `Power + Vol Up` to force-reboot into Recovery Mode for hard resetting. | Intercepts hardware key combos and displays a dummy Android Recovery menu that tricks the thief into thinking they are wiping the phone, while secretly recording photos and transmitting GPS coordinates. |
| **4** | **Secret Hardware Button Escape** | Authentic owners need a foolproof way to restore display after testing or recovering the device. | Only the authentic owner can exit Fake Shutdown, Fake Recovery, or SIM Siren by holding a pre-configured secret button combination (e.g., `Vol Up + Vol Down` for 3 seconds). |
| **5** | **Stealth Intruder Selfie Vault** | Traditional tools only show map pins, leaving police with zero photo evidence of the thief. | Automatically snaps 3 silent burst selfies from the front camera on wrong unlock PIN attempts, SIM removal, web trigger, or low battery, uploading them directly to a private Cloud Vault. |
| **6** | **SIM Ejection & Offline Voice Alarm** | Thieves immediately remove the SIM card to break network connectivity. | Native `BroadcastReceiver` detects SIM state removal in <100ms and blasts a maximum-volume spoken voice alarm (*"Attention! This phone is stolen. Catch the thief!"*) even if the phone was set to Silent or Do Not Disturb. |
| **7** | **Low Battery "Last Gasp" Emergency Fix** | When a stolen phone's battery drops below 5%, tracking normally dies quietly. | Automatically captures a final GPS fix, snaps a photo, and fires emergency SMS messages containing exact Google Maps coordinates and Dual IMEIs to all trustee contacts before power dies. |
| **8** | **Trustee Multi-Factor Emergency Recovery** | Victims lose their primary phone during theft and cannot receive 2FA login OTPs. | Allows up to 5 pre-verified family members or friends to log in via instant OTP on their own phones or send `#track <PIN>` via SMS to locate and recover the device. |
| **9** | **1-Click Ready-to-Print Police FIR PDF Report** | Filing a police complaint requires exact IMEIs, location history, and photo proof, which victims panic to gather. | Generates a court-admissible PDF FIR report complete with thief selfies, movement history breadcrumbs on a map, exact coordinates, pre-registered Dual IMEIs, device model, and timestamp logs ready for law enforcement. |
| **10** | **Lockscreen Quick-Settings Blocker** | Thieves swipe down on the lockscreen to enable Airplane Mode or disable Wi-Fi/Data. | Accessibility Service snaps the notification shade shut in <10ms if pulled while the phone is locked, blocking access to system toggles. |
| **11** | **Anti-Tamper Self-Defense Shield** | Thieves who snatch an unlocked phone try to open Settings to uninstall MobTrack or clear data. | Detects navigation to MobTrack "App Info", "Storage / Clear Data", or "Uninstall" screens and kicks the user to Home screen while prompting for emergency PIN. |

---

## 📱 1. Mobile App Setup (`MobTrack-App`)

### 📦 Pre-Built APK Location
The signed, optimized release APK is located at:
* **`MobTrack-App/MobTrack-App-v1.0.30-release.apk`**  
* *(Also available in `FINAL_APKS/MobTrack-App-v1.0.30-release.apk`)*

### 📥 Installation Steps
1. Transfer `MobTrack-App-v1.0.30-release.apk` to your target Android device (Android 8.0+ / API 26+).
2. Tap the APK file to install. If prompted, enable **"Install from Unknown Sources"** in Android Settings.
3. Tap **Install** and open **MobTrack**.

### 🔐 Account Creation & Setup
1. Launch **MobTrack** and tap **Sign Up / Register**.
2. Enter your Email, Password, and Mobile Number.
3. **Pre-Register Dual IMEIs:** Dial `*#06#` on your device dialer and enter both IMEI 1 and IMEI 2 into the setup wizard.
4. **Add Trustee Contacts:** Enter up to 5 family/friend phone numbers who can track your phone during emergency.

### ⚙️ Setting Thresholds & Secret Button Escape
1. **Emergency PIN:** Create a 4-to-6 digit PIN (e.g., `1234`).
2. **Failed Unlock Threshold:** Set wrong PIN selfie trigger threshold (e.g., `3` attempts).
3. **Hardware Escape Combination:** Select your hardware escape key combo (e.g., hold `Vol Up + Vol Down` for 3 seconds).

### 🔑 Mandatory Android Permissions (Step-by-Step Guide)

To ensure un-killable background operation and anti-tamper protection, grant the following permissions when prompted:

1. **Accessibility Service (CRITICAL):**
   * *Why:* Intercepts Power button, prevents lockscreen Airplane mode, blocks unauthorized uninstalls.
   * *How:* Go to `Settings` ➔ `Accessibility` ➔ `Installed Services` ➔ `MobTrack` ➔ Toggle **ON** & confirm.
2. **Device Admin Receiver:**
   * *Why:* Enables remote screen lock and prevents standard app deletion.
   * *How:* Tap **Activate Device Admin** when prompted.
3. **Location Permission (Always Allow):**
   * *Why:* Enables continuous background GPS location tracking.
   * *How:* Select **"Allow all the time"** in system prompt.
4. **Camera & Microphone Permissions:**
   * *Why:* Required for silent intruder selfies and live remote audio streaming.
   * *How:* Select **"While using the app / Always allow"**.
5. **Display Over Other Apps (System Alert Window):**
   * *Why:* Renders Fake Shutdown and Fake Recovery screen overlays over Android UI.
   * *How:* Enable **"Allow drawing over other apps"** for MobTrack.
6. **SMS & Phone State Permissions:**
   * *Why:* Detects SIM card ejection and reads/sends offline MT1 SMS relay packets.
   * *How:* Tap **Allow** for SMS and Phone State prompts.
7. **Battery Optimization Bypass (Unrestricted):**
   * *Why:* Stops Xiaomi, Samsung, OnePlus, and stock Android battery killers from killing foreground services.
   * *How:* Go to `App Info` ➔ `Battery` ➔ Select **Unrestricted**.

---

## 🌐 2. Web Management Portal Setup (`MobTrack-Web`)

### 📋 Prerequisites
* **Node.js:** v18.0.0 or higher
* **npm:** v9.0.0 or higher
* **Git**

### 🚀 Local Installation & Execution
```bash
# 1. Navigate to the web project folder
cd MobTrack-Web

# 2. Install dependencies
npm install

# 3. Start the Next.js development server
npm run dev
```

The portal will start running locally at **`http://localhost:3000`** (or `http://localhost:3001`).

### 💻 Entering the Portal & Features
1. Open `http://localhost:3000` in any desktop or mobile browser.
2. **Login Options:**
   * **Owner Login:** Enter registered Email & Password.
   * **Emergency Backup Code:** Use your pre-generated offline recovery code.
   * **Trustee OTP Login:** Log in via OTP sent to pre-registered family/friend numbers.
3. **Web Dashboard Capabilities:**
   * **Live Interactive Map:** View real-time WebSocket GPS position & movement trail.
   * **Live Camera & Audio Feed:** Stream silent snapshots and live microphone audio.
   * **Trigger Offline SMS Relay:** Click **"Track Offline"** to dispatch an MT1 SMS command (`#track`) to the stolen device via the Relay App.
   * **Download FIR Report:** Click **"Download Police PDF FIR Report"** to generate a complete legal case document.

---

## 📡 3. Offline SMS Relay Gateway Setup (`Mobtrack-Relay`)

### ❓ Why the Relay App Was Built
Commercial SMS gateway APIs (Twilio, Fast2SMS) cost money per SMS, require enterprise KYC, and fail during network downtime. 

The **MobTrack Relay App** transforms any spare or family Android phone into a **standalone, zero-cost cellular SMS gateway**:
* It subscribes to Supabase Realtime channels over Wi-Fi/Cellular.
* When a user triggers an offline track request on the website, the Relay App receives the web signal, formats an encrypted **MT1 SMS payload (`#track <PIN>`)**, and texts it to the stolen device.
* When the stolen target phone texts back its MT1 GPS coordinates, the Relay App receives the SMS and syncs coordinates directly into Supabase, updating the website live map instantly!

### 📦 Pre-Built Relay APK Location
The signed release APK is located at:
* **`Mobtrack-Relay/MobTrack-Relay-release.apk`**  
* *(Also available in `FINAL_APKS/MobTrack-Relay-release.apk`)*

### 📥 Installing & Configuring the Relay App
1. Install `MobTrack-Relay-release.apk` on a secondary Android phone containing an active SIM card with an SMS plan.
2. Open **MobTrack Relay App**.
3. Grant **SMS Permissions** (`SEND_SMS`, `RECEIVE_SMS`, `READ_PHONE_STATE`).
4. Set Battery usage to **Unrestricted**.
5. Verify the green channel status indicator displays **`SUBSCRIBED`**.
6. Keep the Relay App running in the background—it will now automatically bridge web requests to offline devices!

---

## 📁 Repository Structure

```text
E:\PROJECTS\MobTrack\
├── FINAL_APKS/                      # Production signed APKs for evaluation
│   ├── MobTrack-App-v1.0.30-release.apk
│   └── MobTrack-Relay-release.apk
├── MobTrack-App/                    # Main Android application (React Native + Kotlin Native)
├── MobTrack-Web/                    # Web tracking portal (Next.js 16 + Supabase + Tailwind + Leaflet)
├── Mobtrack-Relay/                  # Standalone SMS Relay Gateway App
├── SIH_FINAL.pdf                    # Official SIH Presentation Deck
└── README.md                        # Master Documentation
```

---

## 🏁 Conclusion

MobTrack delivers a complete, end-to-end anti-theft ecosystem that bridges online web control with offline cellular relay, giving citizens and law enforcement actionable photo, audio, and location evidence during critical loss events.
