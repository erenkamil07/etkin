import { Pressable, StyleSheet, View } from 'react-native';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { dateBadge, formatWeekdayTime } from '@/format';
import { useTheme } from '@/hooks/use-theme';
import { ThemedText } from './themed-text';
import { Pill } from './ui';

// Below this many seats the card calls it out in orange.
const FEW_SEATS = 10;

interface EventSummary {
  title: string;
  startsAt: string;
  locationName: string | null;
  organization: { name: string };
  remaining: number;
  capacity: number;
}

/** A calendar-page date on the left, the event on the right and how many seats are left. */
export function EventCard({ event, onPress }: { event: EventSummary; onPress: () => void }) {
  const theme = useTheme();
  const { day, month } = dateBadge(event.startsAt);
  const soldOut = event.remaining <= 0;
  const fewLeft = !soldOut && event.remaining <= Math.max(FEW_SEATS, event.capacity * 0.1);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
          borderColor: fewLeft ? theme.tintSoft : theme.border,
        },
      ]}
    >
      <View style={[styles.date, { backgroundColor: theme.tintSoft }]}>
        <ThemedText style={[styles.day, { color: theme.tint }]}>{day}</ThemedText>
        <ThemedText style={[styles.month, { color: theme.tint }]}>{month}</ThemedText>
      </View>
      <View style={styles.body}>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {event.organization.name}
        </ThemedText>
        <ThemedText style={styles.title} numberOfLines={2}>
          {event.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {formatWeekdayTime(event.startsAt)}
          {event.locationName ? ` · ${event.locationName}` : ''}
        </ThemedText>
        <View style={styles.pills}>
          {soldOut ? (
            <Pill tone="danger">Tükendi</Pill>
          ) : fewLeft ? (
            <Pill tone="tint">Son {event.remaining} yer</Pill>
          ) : (
            <Pill>{event.remaining} yer var</Pill>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.large,
    padding: Spacing.three,
  },
  date: {
    width: 58,
    height: 64,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  day: { fontFamily: Fonts.extrabold, fontSize: 24, lineHeight: 28 },
  month: { fontFamily: Fonts.bold, fontSize: 12, lineHeight: 16, letterSpacing: 1 },
  body: { flex: 1, gap: 2 },
  title: { fontFamily: Fonts.bold, fontSize: 17, lineHeight: 23 },
  pills: { flexDirection: 'row', marginTop: Spacing.two },
});
