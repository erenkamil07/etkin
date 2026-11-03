import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Tokens and ticket keys live in the OS keystore (Android Keystore / iOS
 * Keychain). The web build is only a development convenience and has no
 * keystore, so it falls back to localStorage there.
 */
const onWeb = Platform.OS === 'web';

export const secureStorage = {
  get: (key: string): Promise<string | null> =>
    onWeb ? Promise.resolve(localStorage.getItem(key)) : SecureStore.getItemAsync(key),

  set: (key: string, value: string): Promise<void> =>
    onWeb ? Promise.resolve(localStorage.setItem(key, value)) : SecureStore.setItemAsync(key, value),

  remove: (key: string): Promise<void> =>
    onWeb ? Promise.resolve(localStorage.removeItem(key)) : SecureStore.deleteItemAsync(key),
};
