import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * EXPO_PUBLIC_API_URL wins (staging, production). In development the phone
 * talks to the API on the same laptop that serves the JavaScript bundle.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? developmentApiUrl();

function developmentApiUrl() {
  if (Platform.OS === 'web') return 'http://localhost:3000';
  const host = Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost';
  return `http://${host}:3000`;
}

/** Served by the API; the Play listing links to the same pages. */
export const PRIVACY_URL = `${API_URL}/privacy`;
export const TERMS_URL = `${API_URL}/terms`;
