import '@/global.css';

import { Platform } from 'react-native';

/**
 * Etkin is dark-only: a warm near-black that keeps the orange from glowing like
 * neon. Text on orange is near-black, not white: white on #FF5A1F is about
 * 3.1:1 contrast (below the 4.5:1 body-text minimum), near-black is about 6:1.
 * The door scanner keeps orange out of its screen entirely, so its amber
 * "warning" verdict can never be mistaken for ordinary UI.
 */
export const Colors = {
  background: '#0F0F12',
  backgroundElement: '#18181B',
  backgroundSelected: '#26262B',
  border: '#2A2A30',
  text: '#FFFFFF',
  textSecondary: '#A1A1AA',
  /** Brand orange: primary buttons, active tabs, event highlights. */
  tint: '#FF5A1F',
  /** Orange at low opacity, for date badges and chips on dark cards. */
  tintSoft: 'rgba(255, 90, 31, 0.14)',
  /** Pressed states and the faint glow behind highlighted cards. */
  glow: '#FF7A45',
  onTint: '#0F0F12',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
} as const;

export type ThemeColor = keyof typeof Colors;

/** A `#RRGGBB` colour at the given opacity, for tinted backgrounds and borders. */
export function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** Plus Jakarta Sans, loaded in the root layout before the splash screen hides. */
export const Fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
  mono: Platform.select({ ios: 'ui-monospace', web: 'var(--font-mono)', default: 'monospace' }),
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  small: 10,
  medium: 14,
  large: 20,
  pill: 999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
