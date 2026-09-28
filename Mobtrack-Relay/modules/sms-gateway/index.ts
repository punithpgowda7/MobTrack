import { requireNativeModule, EventEmitter, Subscription } from 'expo-modules-core';
import { Platform } from 'react-native';

let SmsGatewayModule: any = null;
try {
  if (Platform.OS === 'android') {
    SmsGatewayModule = requireNativeModule('SmsGateway');
  }
} catch (e) {
  console.warn('SmsGateway native module not available:', e);
}

let emitter: any = null;
try {
  if (SmsGatewayModule) {
    emitter = new EventEmitter(SmsGatewayModule);
  }
} catch (e) {
  console.warn('SmsGateway EventEmitter not available:', e);
}

export interface SmsTriggerEvent {
    senderNumber: string;
    pin: string;
    deviceId: string;
}

export interface SmsTelemetryEvent {
    senderNumber: string;
    payload: string;
}

/** Sends an SMS silently via native SmsManager. */
export async function sendSms(phoneNumber: string, message: string): Promise<boolean> {
    if (SmsGatewayModule && typeof SmsGatewayModule.sendSms === 'function') {
        try {
            return await SmsGatewayModule.sendSms(phoneNumber, message);
        } catch (e) {
            console.error('Error in sendSms:', e);
            return false;
        }
    }
    return false;
}

/** Configures the user's security PIN for trigger SMS verification. */
export async function setSecurityPin(pin: string): Promise<void> {
    if (SmsGatewayModule && typeof SmsGatewayModule.setSecurityPin === 'function') {
        try {
            await SmsGatewayModule.setSecurityPin(pin);
        } catch (e) {
            console.warn('Error in setSecurityPin:', e);
        }
    }
}

/** Subscribe to incoming SMS PIN trigger events. */
export function addSmsTriggerListener(listener: (event: SmsTriggerEvent) => void): Subscription | null {
    if (!emitter || typeof emitter.addListener !== 'function') return null;
    try {
        return emitter.addListener('onSmsTriggerReceived', listener);
    } catch (e) {
        console.warn('Failed to add sms trigger listener:', e);
        return null;
    }
}

/** Subscribe to incoming SMS Telemetry events (for Universal Messenger mode). */
export function addSmsTelemetryListener(listener: (event: SmsTelemetryEvent) => void): Subscription | null {
    if (!emitter || typeof emitter.addListener !== 'function') return null;
    try {
        return emitter.addListener('onSmsTelemetryReceived', listener);
    } catch (e) {
        console.warn('Failed to add sms telemetry listener:', e);
        return null;
    }
}
