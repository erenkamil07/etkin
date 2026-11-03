import { randomUUID } from 'expo-crypto';
import { secureStorage } from './storage';

const KEY = 'etkin.deviceId';
let cached: string | undefined;

/**
 * A random id per installation (no hardware identifiers). Tickets bind to it,
 * so reinstalling the app counts as a new phone.
 */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  cached = (await secureStorage.get(KEY)) ?? undefined;
  if (!cached) {
    cached = randomUUID();
    await secureStorage.set(KEY, cached);
  }
  return cached;
}
