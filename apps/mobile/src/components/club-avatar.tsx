import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Fonts } from '@/constants/theme';
import { clubGradient, clubInitials } from './art';
import { ThemedText } from './themed-text';

/** SVG ids are global on the web, and useId's characters aren't all valid in `url(#…)`. */
export function useSvgId(prefix: string): string {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * A club's badge: its initials on its own gradient. Clubs have no logo upload,
 * so this tells them apart at a glance, and their events' covers use the same colours.
 */
export function ClubAvatar({ orgId, name, size = 40 }: { orgId: string; name: string; size?: number }) {
  const gradient = clubGradient(orgId);
  const id = useSvgId('club');
  const radius = size * 0.3;
  return (
    <View accessibilityLabel={name} style={[styles.box, { width: size, height: size, borderRadius: radius }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={gradient.from} />
            <Stop offset="1" stopColor={gradient.to} />
          </LinearGradient>
        </Defs>
        <Rect width={size} height={size} rx={radius} fill={`url(#${id})`} />
      </Svg>
      <ThemedText
        style={{ color: gradient.ink, fontFamily: Fonts.extrabold, fontSize: size * 0.38, lineHeight: size * 0.5 }}
      >
        {clubInitials(name)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
