import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Colors } from '@/constants/theme';
import { useMotion } from './motion';

const COLORS = [Colors.tint, Colors.glow, Colors.success, Colors.warning, '#FFFFFF', '#8B5CF6', '#0EA5E9', '#FF2E7E'];
const PIECES = 44;
const DURATION_MS = 2200;
/** Air slows the burst quickly (per second)… */
const DRAG = 3;

interface Piece {
  vx: number;
  vy: number;
  /** …and each piece then sinks at its own pace, px/s. */
  fall: number;
  spin: number;
  flutter: number;
  phase: number;
  width: number;
  height: number;
  color: string;
}

function makePieces(): Piece[] {
  return Array.from({ length: PIECES }, (_, index) => {
    // Mostly upwards, fanned out from about 20° to 160°.
    const angle = (-20 - Math.random() * 140) * (Math.PI / 180);
    const speed = 450 + Math.random() * 650;
    const round = Math.random() < 0.3;
    const size = 6 + Math.random() * 5;
    return {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      fall: 180 + Math.random() * 160,
      spin: (Math.random() - 0.5) * 900,
      flutter: 6 + Math.random() * 8,
      phase: Math.random() * Math.PI * 2,
      width: size,
      height: round ? size : size * 1.7,
      color: COLORS[index % COLORS.length] as string,
    };
  });
}

/**
 * A one-off burst of paper confetti over its parent (which must not clip if the
 * confetti should spill out). Mount it with a new `key` to fire again. It does
 * nothing with reduce motion on, and never catches touches.
 */
export function Confetti({ origin = { x: 0.5, y: 0.5 } }: { origin?: { x: number; y: number } }) {
  const motion = useMotion();
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const pieces = useMemo(makePieces, []);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (box) progress.value = withTiming(1, { duration: DURATION_MS, easing: Easing.linear });
  }, [box, progress]);

  if (!motion) return null;
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setBox((current) => current ?? { width, height });
      }}
    >
      {box
        ? pieces.map((piece, index) => (
            <ConfettiPiece
              // biome-ignore lint/suspicious/noArrayIndexKey: the pieces never reorder
              key={index}
              piece={piece}
              progress={progress}
              x={box.width * origin.x}
              y={box.height * origin.y}
            />
          ))
        : null}
    </View>
  );
}

function ConfettiPiece({
  piece,
  progress,
  x,
  y,
}: {
  piece: Piece;
  progress: SharedValue<number>;
  x: number;
  y: number;
}) {
  const style = useAnimatedStyle(() => {
    const t = (progress.value * DURATION_MS) / 1000;
    // Launch speed fading with drag, plus a steady sink: floaty, like paper.
    const slowed = (1 - Math.exp(-DRAG * t)) / DRAG;
    const left = x + piece.vx * slowed - piece.width / 2;
    const top = y + piece.vy * slowed + piece.fall * t - piece.height / 2;
    return {
      opacity: progress.value < 0.7 ? 1 : (1 - progress.value) / 0.3,
      transform: [
        { translateX: left },
        { translateY: top },
        { rotate: `${piece.spin * t}deg` },
        // Turning over in the air.
        { scaleY: Math.cos(piece.flutter * t + piece.phase) },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        styles.piece,
        {
          width: piece.width,
          height: piece.height,
          borderRadius: piece.width === piece.height ? piece.width / 2 : 1.5,
          backgroundColor: piece.color,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', left: 0, top: 0 },
});
