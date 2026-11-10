import { type ReactNode, useEffect } from 'react';
import { type DimensionValue, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useMotion } from './motion';

/**
 * A grey stand-in shaped like the content that is on its way. It breathes
 * slowly while loading; with reduce motion on it holds still.
 */
export function Skeleton({
  width = '100%',
  height = 14,
  radius = 6,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const motion = useMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!motion) return;
    opacity.value = withRepeat(withTiming(0.45, { duration: 800, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(opacity);
  }, [motion, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: theme.backgroundSelected }, style, animated]}
    />
  );
}

/** Screen readers hear one "loading" instead of a pile of empty boxes. */
function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Yükleniyor" style={style}>
      {children}
    </View>
  );
}

/** Mirrors EventCard: a cover strip, the date block and three lines. */
export function EventCardSkeleton({ count = 3 }: { count?: number }) {
  const theme = useTheme();
  return (
    <Group style={styles.list}>
      {Array.from({ length: count }, (_, index) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else to key on
          key={index}
          style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
        >
          <Skeleton height="auto" radius={Radius.medium} style={styles.banner} />
          <View style={styles.row}>
            <Skeleton width={58} height={64} radius={Radius.medium} />
            <View style={styles.lines}>
              <Skeleton width="45%" height={12} />
              <Skeleton width="85%" height={18} />
              <Skeleton width="60%" height={12} />
            </View>
          </View>
        </View>
      ))}
    </Group>
  );
}

/** Rows of plain cards: a title line and a detail line each. */
export function CardSkeleton({ count = 2, avatar = false }: { count?: number; avatar?: boolean }) {
  const theme = useTheme();
  return (
    <Group style={styles.list}>
      {Array.from({ length: count }, (_, index) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else to key on
          key={index}
          style={[styles.card, styles.row, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
        >
          {avatar ? <Skeleton width={40} height={40} radius={12} /> : null}
          <View style={styles.lines}>
            <Skeleton width="70%" height={16} />
            <Skeleton width="45%" height={12} />
          </View>
        </View>
      ))}
    </Group>
  );
}

/** The badge showcase: two tiles per row. */
export function BadgeGridSkeleton() {
  const theme = useTheme();
  return (
    <Group style={styles.grid}>
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
          <Skeleton width={36} height={36} radius={18} />
          <Skeleton width="80%" height={14} />
          <Skeleton width="50%" height={12} />
        </View>
      ))}
    </Group>
  );
}

/** A detail page on its way: a cover, a heading and a couple of blocks. */
export function PageSkeleton({ cover = true }: { cover?: boolean }) {
  return (
    <Group style={styles.page}>
      {cover ? <Skeleton height="auto" radius={Radius.large} style={styles.cover} /> : null}
      <Skeleton width="40%" height={14} />
      <Skeleton width="85%" height={26} />
      <Skeleton width="60%" height={14} />
      <Skeleton height={120} radius={Radius.large} style={styles.block} />
      <Skeleton height={52} radius={Radius.medium} />
    </Group>
  );
}

/** The ticket screen: the stub, the tear line and the code. */
export function TicketSkeleton() {
  const theme = useTheme();
  return (
    <Group style={[styles.ticket, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={styles.lines}>
        <Skeleton width="40%" height={12} />
        <Skeleton width="80%" height={24} />
        <Skeleton width="60%" height={12} />
      </View>
      <Skeleton width={240} height={240} radius={Radius.medium} style={styles.qr} />
    </Group>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.three },
  card: { borderWidth: 1, borderRadius: Radius.large, padding: Spacing.three, gap: Spacing.three },
  banner: { width: '100%', aspectRatio: 3.2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  lines: { flex: 1, gap: Spacing.two },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: Spacing.two },
  tile: { flexBasis: '48%', borderRadius: Radius.large, padding: Spacing.three, gap: Spacing.two },
  page: { gap: Spacing.three, padding: Spacing.four },
  cover: { width: '100%', aspectRatio: 2.2 },
  block: { marginTop: Spacing.two },
  ticket: { borderWidth: 1, borderRadius: Radius.large, padding: Spacing.three, gap: Spacing.four },
  qr: { alignSelf: 'center' },
});
