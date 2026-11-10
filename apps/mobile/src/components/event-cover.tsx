import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { API_URL } from '@/config';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { clubGradient, eventEmoji, hashString, seededRandom } from './art';
import { useSvgId } from './club-avatar';
import { ThemedText } from './themed-text';

export interface Cover {
  url: string;
  width: number;
  height: number;
}

/** What a generated cover is made from when the club uploaded no poster. */
export interface CoverSeed {
  eventId: string;
  orgId: string;
  title: string;
}

// Wide strips: a made-up cover shouldn't take the room a real poster gets in the feed.
const GENERATED_BANNER = 3.2;
const GENERATED_POSTER = 2.2;

/**
 * An event's poster. `banner` crops it to a wide strip from the top (where
 * posters put their title) for lists; `poster` shows all of it, as tall as a
 * phone allows. A local `uri` previews a pick before it is uploaded. With no
 * poster, `fallback` draws one in the club's colours.
 */
export function EventCover({
  cover,
  uri,
  variant,
  fallback,
}: {
  cover?: Cover | null;
  uri?: string;
  variant: 'banner' | 'poster';
  fallback?: CoverSeed;
}) {
  const theme = useTheme();
  const source = uri ?? (cover ? `${API_URL}${cover.url}` : null);
  if (!source) {
    return fallback ? (
      <GeneratedCover seed={fallback} ratio={variant === 'banner' ? GENERATED_BANNER : GENERATED_POSTER} />
    ) : null;
  }
  const ratio = cover ? cover.width / cover.height : 0.75;
  return (
    <Image
      source={source}
      accessibilityIgnoresInvertColors
      contentFit="cover"
      contentPosition="top"
      transition={150}
      style={[
        variant === 'banner' ? styles.banner : [styles.poster, { aspectRatio: Math.max(ratio, 0.6) }],
        { backgroundColor: theme.backgroundSelected },
      ]}
    />
  );
}

const W = 320;

/**
 * A made-up cover: the club's gradient, a few soft shapes that differ per event,
 * and a picture guessed from the title. It is drawn, not downloaded, so it costs
 * nothing and works offline.
 */
function GeneratedCover({ seed, ratio }: { seed: CoverSeed; ratio: number }) {
  const gradient = clubGradient(seed.orgId);
  const id = useSvgId('cover');
  const [height, setHeight] = useState(0);
  const H = W / ratio;
  const shapes = useMemo(() => {
    const random = seededRandom(hashString(seed.eventId));
    const pattern = Math.floor(random() * 3);
    return {
      pattern,
      blob: { cx: W * (0.15 + random() * 0.3), cy: H * (random() < 0.5 ? 0 : 1), r: H * (0.55 + random() * 0.3) },
      ring: { cx: W * (0.35 + random() * 0.2), cy: H * (0.2 + random() * 0.6), r: H * (0.18 + random() * 0.12) },
      tilt: -12 + random() * 24,
    };
  }, [seed.eventId, H]);
  // The picture sits in a disc on the right; this is its centre and size in viewBox units.
  const disc = { cx: W - H * 0.62, cy: H * 0.5, r: H * 0.36 };
  const scale = height / H;

  return (
    <View
      accessible={false}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      style={[styles.generated, { aspectRatio: ratio }]}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={gradient.from} />
            <Stop offset="1" stopColor={gradient.to} />
          </LinearGradient>
        </Defs>
        <Rect width={W} height={H} fill={`url(#${id})`} />
        <Circle {...shapes.blob} fill="#FFFFFF" opacity={0.12} />
        <Circle {...shapes.ring} fill="none" stroke="#FFFFFF" strokeWidth={3} opacity={0.3} />
        <Pattern kind={shapes.pattern} height={H} />
        <Circle {...disc} fill="#FFFFFF" opacity={0.22} />
      </Svg>
      {height > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.emojiBox,
            {
              left: `${((disc.cx - disc.r) / W) * 100}%`,
              top: (disc.cy - disc.r) * scale,
              width: disc.r * 2 * scale,
              height: disc.r * 2 * scale,
            },
          ]}
        >
          <ThemedText
            style={{
              fontSize: disc.r * scale,
              lineHeight: disc.r * scale * 1.25,
              transform: [{ rotate: `${shapes.tilt}deg` }],
            }}
          >
            {eventEmoji(seed.title)}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

/** One of three textures in the left half: dots, stripes or waves. */
function Pattern({ kind, height }: { kind: number; height: number }) {
  if (kind === 0) {
    const dots = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 6; col++) {
        dots.push(<Circle key={`${row}-${col}`} cx={18 + col * 16} cy={height * 0.2 + row * 16} r={2.5} />);
      }
    }
    return (
      <G fill="#FFFFFF" opacity={0.35}>
        {dots}
      </G>
    );
  }
  if (kind === 1) {
    return (
      <G stroke="#FFFFFF" strokeWidth={6} opacity={0.14}>
        {[0, 1, 2, 3, 4].map((index) => (
          <Path key={index} d={`M ${-40 + index * 28} ${height + 10} L ${40 + index * 28} -10`} />
        ))}
      </G>
    );
  }
  return (
    <G fill="none" stroke="#FFFFFF" strokeWidth={3} opacity={0.3}>
      {[0, 1, 2].map((index) => {
        const y = height * (0.3 + index * 0.2);
        return <Path key={index} d={`M 0 ${y} q 25 -14 50 0 t 50 0 t 50 0 t 50 0`} />;
      })}
    </G>
  );
}

const styles = StyleSheet.create({
  banner: { width: '100%', aspectRatio: 2.2, borderRadius: Radius.medium },
  poster: { width: '100%', borderRadius: Radius.large },
  generated: { width: '100%', borderRadius: Radius.medium, overflow: 'hidden' },
  emojiBox: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
});
