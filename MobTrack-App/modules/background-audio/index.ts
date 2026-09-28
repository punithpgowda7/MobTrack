import { requireNativeModule, EventEmitter, type EventSubscription } from 'expo-modules-core';

const BackgroundAudioNativeModule = requireNativeModule('BackgroundAudio');
const emitter = new EventEmitter<{ onAudioChunk: (event: { data: string }) => void }>(
  BackgroundAudioNativeModule,
);

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
): EventSubscription {
  return emitter.addListener('onAudioChunk', (event) => {
    listener(event.data);
  });
}

/** Get best-effort IMEI, Android ID, and live battery state. */
export async function getDeviceInfo(): Promise<{
  imei: string | null;
  androidId: string;
  batteryLevel: number;
  isCharging: boolean;
  manufacturer: string;
  model: string;
}> {
  return BackgroundAudioNativeModule.getDeviceInfo();
}
