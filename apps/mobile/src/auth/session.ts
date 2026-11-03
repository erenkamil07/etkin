import { useSyncExternalStore } from 'react';
import { publicApi } from '@/api/base';
import { secureStorage } from './storage';

const KEY = 'etkin.session';
/** Refresh this long before the access token expires. */
const REFRESH_MARGIN_MS = 60_000;

interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

type Status = 'loading' | 'signedIn' | 'signedOut';

let state: { status: Status; session: Session | null } = { status: 'loading', session: null };
const listeners = new Set<() => void>();

function update(next: typeof state) {
  state = next;
  for (const listener of listeners) listener();
}

export async function restoreSession() {
  const saved = await secureStorage.get(KEY);
  update(saved ? { status: 'signedIn', session: JSON.parse(saved) } : { status: 'signedOut', session: null });
}

export async function startSession(tokens: { accessToken: string; refreshToken: string; expiresIn: number }) {
  const session = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  };
  await secureStorage.set(KEY, JSON.stringify(session));
  update({ status: 'signedIn', session });
}

export async function endSession() {
  await secureStorage.remove(KEY);
  update({ status: 'signedOut', session: null });
}

export const currentRefreshToken = () => state.session?.refreshToken ?? null;

let refreshing: Promise<string | null> | null = null;

/**
 * A usable access token, refreshed first when it is about to expire. Only
 * one refresh ever runs at a time: the API treats a refresh token presented
 * twice as stolen and ends the whole session.
 */
export function accessToken(): Promise<string | null> {
  const session = state.session;
  if (!session) return Promise.resolve(null);
  if (session.expiresAt - Date.now() > REFRESH_MARGIN_MS) return Promise.resolve(session.accessToken);
  refreshing ??= refresh(session).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refresh(session: Session): Promise<string | null> {
  try {
    const { data, response } = await publicApi.POST('/auth/refresh', {
      body: { refreshToken: session.refreshToken },
    });
    if (data) {
      await startSession(data);
      return data.accessToken;
    }
    if (response.status === 401) {
      await endSession();
      return null;
    }
  } catch {
    // Offline: fall through and let the request fail on its own.
  }
  return session.accessToken;
}

export function useSessionStatus(): Status {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state.status,
    () => 'loading',
  );
}
