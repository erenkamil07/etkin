import { api } from '@/api/client';
import { getDeviceId } from '@/auth/device';
import { secureStorage } from '@/auth/storage';

interface SavedKey {
  key: string;
  keyVersion: number;
  /** Server clock minus this phone's clock, so a phone set to the wrong time still shows valid codes. */
  clockOffsetMs: number;
}

/** Everything the ticket screen needs to draw codes, with or without a network. */
export interface QrKey extends SavedKey {
  /** This request moved the ticket here from another phone. */
  deviceChanged: boolean;
  /** The server could not be reached, so this is the key saved last time. */
  offline: boolean;
}

// Reception at the door is often poor: give up on the server after this and draw from the saved key.
const ONLINE_TIMEOUT_MS = 4_000;

const storageKey = (ticketId: string) => `etkin.qrkey.${ticketId}`;

async function requestKey(ticketId: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ONLINE_TIMEOUT_MS);
  try {
    return await api.POST('/tickets/{ticketId}/qr-key', {
      params: { path: { ticketId } },
      body: { deviceId: await getDeviceId() },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function savedKey(ticketId: string, failure: unknown): Promise<QrKey> {
  const saved = await secureStorage.get(storageKey(ticketId));
  if (!saved) throw failure;
  return { ...(JSON.parse(saved) as SavedKey), deviceChanged: false, offline: true };
}

/**
 * Fetches this phone's key for the ticket and keeps it in the keystore, so the
 * ticket still opens at a door with no signal.
 */
export async function loadQrKey(ticketId: string): Promise<QrKey> {
  let result: Awaited<ReturnType<typeof requestKey>>;
  try {
    result = await requestKey(ticketId);
  } catch (offline) {
    return savedKey(ticketId, offline);
  }

  const { data, error, response } = result;
  if (response.status >= 500) return savedKey(ticketId, error);
  if (error) {
    // Used, cancelled or gone: no code for it will scan again.
    await forgetQrKey(ticketId);
    throw error;
  }

  const saved: SavedKey = {
    key: data.key,
    keyVersion: data.keyVersion,
    clockOffsetMs: Date.parse(data.serverTime) - Date.now(),
  };
  await secureStorage.set(storageKey(ticketId), JSON.stringify(saved));
  return { ...saved, deviceChanged: data.deviceChanged, offline: false };
}

export const forgetQrKey = (ticketId: string) => secureStorage.remove(storageKey(ticketId));
