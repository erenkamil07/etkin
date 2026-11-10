import type { ReactNode } from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';

// The first few rows arrive one after another; later ones (scrolled into view) don't wait.
const STAGGER_MS = 45;
const MAX_STAGGERED = 6;

/**
 * A list row that slides up into place the first time it appears, so content
 * replacing a skeleton doesn't just pop in. Reduce motion skips it (Reanimated's
 * entering animations follow the system setting by default).
 */
export function FadeInItem({ index, children }: { index: number; children: ReactNode }) {
  return (
    <Animated.View entering={FadeInDown.duration(280).delay(Math.min(index, MAX_STAGGERED) * STAGGER_MS)}>
      {children}
    </Animated.View>
  );
}
