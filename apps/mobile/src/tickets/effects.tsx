import * as Haptics from 'expo-haptics';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { hasHaptics, useMotion } from '@/components/motion';
import { Colors, Radius } from '@/constants/theme';

// A printer feeds paper in short pushes: how far each push gets, and how long it takes.
const PUSHES = [
  { to: 0.3, ms: 320 },
  { to: 0.58, ms: 300 },
  { to: 0.82, ms: 300 },
  { to: 1, ms: 460 },
];
const PAUSE_MS = 110;

/**
 * A just-bought ticket feeds out of a slot like a printed one, with a light tick
 * on each push. It plays once, only when `play` is set at mount; with reduce
 * motion the ticket is simply there.
 */
export function PrintIn({ play, onDone, children }: { play: boolean; onDone?: () => void; children: ReactNode }) {
  const motion = useMotion();
  const [animate] = useState(play && motion);
  const [printing, setPrinting] = useState(animate);
  const progress = useSharedValue(animate ? 0 : 1);
  // Until the ticket is measured, park it far above so nothing shows through the slot.
  const height = useSharedValue(2000);
  const slot = useSharedValue(animate ? 1 : 0);
  const started = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    // Asked to print but motion is off: it is "done" at once.
    if (play && !animate) done.current?.();
    return () => timers.current.forEach(clearTimeout);
  }, [play, animate]);

  const paper = useAnimatedStyle(() => ({
    transform: [{ translateY: -(1 - progress.value) * height.value }],
  }));
  const slotStyle = useAnimatedStyle(() => ({ opacity: slot.value }));

  const start = () => {
    started.current = true;
    let at = 0;
    const steps = PUSHES.map(({ to, ms }, index) => {
      const pause = index === 0 ? 0 : PAUSE_MS;
      const begins = at + pause;
      at = begins + ms;
      if (hasHaptics) {
        timers.current.push(
          setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined), begins),
        );
      }
      const easing = index === PUSHES.length - 1 ? Easing.out(Easing.back(1.6)) : Easing.out(Easing.quad);
      return withDelay(pause, withTiming(to, { duration: ms, easing }));
    });
    progress.value = withSequence(...steps);
    slot.value = withDelay(at, withTiming(0, { duration: 250 }));
    timers.current.push(
      setTimeout(() => {
        setPrinting(false);
        done.current?.();
      }, at + 250),
    );
  };

  return (
    <View>
      <View style={printing ? styles.clip : undefined}>
        <Animated.View
          style={paper}
          onLayout={(event) => {
            height.value = event.nativeEvent.layout.height;
            if (animate && !started.current) start();
          }}
        >
          {children}
        </Animated.View>
      </View>
      {printing ? <Animated.View pointerEvents="none" style={[styles.slot, slotStyle]} /> : null}
    </View>
  );
}

/**
 * A soft orange glow around the QR's white paper. It breathes slowly and flares
 * each time the code changes, so it is plain from a step away that the code is
 * live. It never touches the code itself: the paper's white margin stays clean
 * for the scanner. Still and steady with reduce motion.
 */
export function QrGlow({ step, children }: { step: number; children: ReactNode }) {
  const motion = useMotion();
  const breath = useSharedValue(0.5);
  const flare = useSharedValue(0);

  useEffect(() => {
    if (!motion) return;
    breath.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(breath);
  }, [motion, breath]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new code (step) is what fires the flare
  useEffect(() => {
    if (!motion) return;
    flare.value = withSequence(withTiming(1, { duration: 140 }), withTiming(0, { duration: 900 }));
  }, [step, motion, flare]);

  const glow = useAnimatedStyle(() => ({
    opacity: 0.3 + 0.4 * breath.value + 0.3 * flare.value,
    transform: [{ scale: 1 + 0.035 * flare.value }],
  }));

  return (
    <View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.glow, glow]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  // The printer's mouth, just above the ticket's top edge.
  slot: {
    position: 'absolute',
    top: -6,
    left: -8,
    right: -8,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  glow: {
    borderRadius: Radius.medium,
    backgroundColor: '#FFFFFF',
    boxShadow: `0 0 28px 6px ${Colors.tint}`,
  },
});
