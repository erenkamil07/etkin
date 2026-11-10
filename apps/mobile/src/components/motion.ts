import { Platform } from 'react-native';
import { useReducedMotion, type WithSpringConfig } from 'react-native-reanimated';

/**
 * Motion is decoration in Etkin: every animation either has a still version or
 * is skipped when the phone's "reduce motion" (Android: "Remove animations")
 * setting is on. Reanimated reads that setting on every platform, the web included.
 */
export function useMotion(): boolean {
  return !useReducedMotion();
}

/** A short, firm spring for things that react to a finger. */
export const PRESS_SPRING: WithSpringConfig = { damping: 18, stiffness: 420, mass: 0.6 };

/** Haptics exist on phones only. */
export const hasHaptics = Platform.OS !== 'web';
