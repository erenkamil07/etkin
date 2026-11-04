import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/** What the door team should do: let in, stop, or take a closer look. */
export type DoorSignal = 'ok' | 'denied' | 'warning';

// Synthesised by scripts/make-door-sounds.mjs.
const SOUNDS = {
  ok: require('../../assets/sounds/door-ok.wav'),
  denied: require('../../assets/sounds/door-denied.wav'),
  warning: require('../../assets/sounds/door-warning.wav'),
} as const;

const ignore = () => undefined;

function vibrate(signal: DoorSignal) {
  if (Platform.OS === 'web') return;
  if (signal === 'ok') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore);
  } else if (signal === 'warning') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(ignore);
  } else {
    // Two strong pulses for "stop", distinct from the single tap of a success.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(ignore);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(ignore), 220);
  }
}

/**
 * A sound and a vibration per verdict, so the door team can keep their eyes on
 * the queue. Sound can be switched off for quiet venues; vibration stays.
 */
export function useDoorFeedback(soundOn: boolean) {
  const ok = useAudioPlayer(SOUNDS.ok);
  const denied = useAudioPlayer(SOUNDS.denied);
  const warning = useAudioPlayer(SOUNDS.warning);

  useEffect(() => {
    // Mix with whatever else is playing instead of pausing it.
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(ignore);
  }, []);

  return (signal: DoorSignal) => {
    vibrate(signal);
    if (!soundOn) return;
    const player = { ok, denied, warning }[signal];
    player
      .seekTo(0)
      .then(() => player.play())
      .catch(ignore);
  };
}
