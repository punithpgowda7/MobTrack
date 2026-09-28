import { requireNativeModule, EventEmitter, type Subscription } from 'expo-modules-core';

const BackgroundAudioNativeModule = requireNativeModule('BackgroundAudio');
const emitter = new EventEmitter(BackgroundAudioNativeModule ?? {});

/** Start background audio recording (calls native AudioRecord). */
export function startRecording(): void {
  BackgroundAudioNativeModule.startRecording();
}

/** Stop background audio recording and release resources. */
export function stopRecording(): void {
  BackgroundAudioNativeModule.stopRecording();
}

/**
 * Subscribe to raw PCM audio chunks from the microphone.
 * @param listener - called with base64-encoded 16-bit PCM mono 16000 Hz data.
 * @returns Subscription — call `.remove()` to unsubscribe.
 */
export function addAudioChunkListener(
  listener: (data: string) => void
): Subscription {
  return emitter.addListener<{ data: string }>('onAudioChunk', (event) => {
    listener(event.data);
  });
}

/** Get device info: Android ID (unique device ID) + live battery state. */
export async function getDeviceInfo(): Promise<{
  androidId: string;
  batteryLevel: number;
  isCharging: boolean;
}> {
  return BackgroundAudioNativeModule.getDeviceInfo();
}
