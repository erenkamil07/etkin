import * as Brightness from 'expo-brightness';
import * as ScreenCapture from 'expo-screen-capture';
import { useEffect } from 'react';
import { Platform } from 'react-native';

const CAPTURE_TAG = 'ticket-qr';
const ignore = () => undefined;

/**
 * While a live code is on screen: block screenshots and recordings (they would
 * only produce a code that dies within a minute anyway) and turn the screen up
 * to full brightness for the scanner. Both are restored when the code goes away.
 * The web build is for development and supports neither.
 */
export function useTicketDisplay(active: boolean) {
  useEffect(() => {
    if (!active || Platform.OS === 'web') return;
    let cancelled = false;
    let previous: number | undefined;

    ScreenCapture.preventScreenCaptureAsync(CAPTURE_TAG).catch(ignore);
    Brightness.getBrightnessAsync()
      .then((value) => {
        previous = value;
        return cancelled ? undefined : Brightness.setBrightnessAsync(1);
      })
      .catch(ignore);

    return () => {
      cancelled = true;
      ScreenCapture.allowScreenCaptureAsync(CAPTURE_TAG).catch(ignore);
      // Android changed only this window's brightness; hand it back to the system setting.
      if (Platform.OS === 'android') Brightness.restoreSystemBrightnessAsync().catch(ignore);
      else if (previous !== undefined) Brightness.setBrightnessAsync(previous).catch(ignore);
    };
  }, [active]);
}
