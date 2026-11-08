import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import { API_URL } from '@/config';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface Cover {
  url: string;
  width: number;
  height: number;
}

/**
 * An event's poster. `banner` crops it to a wide strip from the top (where
 * posters put their title) for lists; `poster` shows all of it, as tall as a
 * phone allows. A local `uri` previews a pick before it is uploaded.
 */
export function EventCover({
  cover,
  uri,
  variant,
}: {
  cover?: Cover | null;
  uri?: string;
  variant: 'banner' | 'poster';
}) {
  const theme = useTheme();
  const source = uri ?? (cover ? `${API_URL}${cover.url}` : null);
  if (!source) return null;
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

const styles = StyleSheet.create({
  banner: { width: '100%', aspectRatio: 2.2, borderRadius: Radius.medium },
  poster: { width: '100%', borderRadius: Radius.large },
});
