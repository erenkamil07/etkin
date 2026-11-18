import { StyleSheet, View } from 'react-native';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Avatar } from './avatar';
import { ThemedText } from './themed-text';

export interface Attendees {
  count: number;
  /** Up to three photos of holders who chose to show them on events. */
  photos: string[];
}

/**
 * "👤👤👤 200 kişi katılıyor": a few faces and how many hold tickets. Faces are
 * only of people who turned it on in their settings; the count is everyone.
 * Just a display, nothing to tap. Hidden until someone has a ticket.
 */
export function AttendeeFaces({
  attendees,
  size = 26,
  ringColor,
}: {
  attendees?: Attendees | null;
  size?: number;
  /** The background behind the faces, so each one is cut out of the next. */
  ringColor?: string;
}) {
  const theme = useTheme();
  if (!attendees || attendees.count === 0) return null;
  const ring = Math.max(2, Math.round(size / 13));
  return (
    <View accessible accessibilityLabel={`${attendees.count} kişi katılıyor`} style={styles.row}>
      <View style={[styles.dot, { backgroundColor: theme.success }]} />
      {attendees.photos.length > 0 ? (
        <View style={styles.stack}>
          {attendees.photos.map((url, index) => (
            <View
              key={url}
              style={{
                marginLeft: index === 0 ? 0 : -size * 0.3,
                zIndex: attendees.photos.length - index,
                borderWidth: ring,
                borderColor: ringColor ?? theme.backgroundElement,
                borderRadius: size,
              }}
            >
              <Avatar url={url} name="Katılımcı" size={size} />
            </View>
          ))}
        </View>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        <ThemedText type="smallBold" themeColor="success">
          {attendees.count}
        </ThemedText>{' '}
        kişi katılıyor
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: 4 },
  stack: { flexDirection: 'row', alignItems: 'center' },
});
