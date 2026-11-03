import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json holds the configuration. This only refuses to build an installable
 * app that would look for the API on a laptop: outside development the URL
 * comes from EXPO_PUBLIC_API_URL (an EAS environment variable), and Android
 * release builds block plain http, so it has to be https.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const profile = process.env.EAS_BUILD_PROFILE;
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (profile && profile !== 'development' && !apiUrl?.startsWith('https://')) {
    throw new Error(
      `EAS build profile "${profile}" needs EXPO_PUBLIC_API_URL set to the deployed API (https://...). ` +
        'Add it under Environment variables on expo.dev for this environment.',
    );
  }
  return config as ExpoConfig;
};
