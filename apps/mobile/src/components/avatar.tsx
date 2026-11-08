import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { apiImage } from '@/api/upload';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ThemedText } from './themed-text';

/** "Ayşe Yılmaz" → "AY". */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase('tr'))
    .join('');

/** A round profile photo, or the person's initials when they have none. `uri` previews a local pick. */
export function Avatar({
  url,
  uri,
  name,
  size = 56,
}: {
  url?: string | null;
  uri?: string | null;
  name: string;
  size?: number;
}) {
  const theme = useTheme();
  const source = uri ?? (url ? apiImage(url) : null);
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (source) {
    return (
      <Image
        source={source}
        accessibilityIgnoresInvertColors
        accessibilityLabel={name}
        contentFit="cover"
        transition={150}
        style={[round, { backgroundColor: theme.backgroundSelected }]}
      />
    );
  }
  return (
    <View accessibilityLabel={name} style={[round, styles.initials, { backgroundColor: theme.tintSoft }]}>
      <ThemedText style={{ color: theme.tint, fontFamily: Fonts.extrabold, fontSize: size * 0.38 }}>
        {initials(name)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  initials: { alignItems: 'center', justifyContent: 'center' },
});
