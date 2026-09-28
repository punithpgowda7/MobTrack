# MobTrack Relay App

This is the standalone Relay App requested. It acts as an SMS Gateway for MobTrack.

## Purpose
It connects to the Supabase backend and listens for `pending` SMS commands from the Web Dashboard. When a `#track` command is dispatched from the web, this app sends the SMS to the target mobile device in the background. It then listens for incoming SMS telemetry (locations) from the target mobile and pushes the data directly to Supabase so the Web Dashboard can show it on the map.

## Setup Instructions
1. Install dependencies:
   ```bash
   npm install
   npm install react-native-url-polyfill
   npm install file:./modules/sms-gateway
   ```
2. Build and run the app natively on your "Always Active" mobile device:
   ```bash
   npx expo run:android
   ```

3. Keep the app open (or running in the background if configured) on your server mobile device. It will display a live log of all SMS activity, database synchronization, and errors to help you debug.
