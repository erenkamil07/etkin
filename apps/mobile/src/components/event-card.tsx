import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { dateBadge, formatWeekdayTime } from '@/format';
import { useTheme } from '@/hooks/use-theme';
import { type Cover, EventCover } from './event-cover';
import { PressableScale } from './pressable-scale';
import { ThemedText } from './themed-text';
import { Pill } from './ui';

// Below this many seats the feed calls it out in orange.
const FEW_SEATS = 10;

interface EventSummary {
  id: string;
  title: string;
  startsAt: string;
  locationName: string | null;
  organization: { id: string; name: string; university?: { name: string } | null };
  cover?: Cover | null;
}

/**
 * The poster on top when there is one, then a calendar-page date on the left and
 * the event on the right. The feed puts the seats left underneath; the ticket
 * list puts the ticket's status there.
 */
export function EventCard({
  event,
  onPress,
  footer,
  highlight = false,
  dimmed = false,
  showUniversity = false,
}: {
  event: EventSummary;
  onPress: () => void;
  footer?: ReactNode;
  /** Name the club's university too, for feeds that mix campuses. */
  showUniversity?: boolean;
  /** An orange border, for "hurry" moments such as the last few seats. */
  highlight?: boolean;
  /** Faded, for things that are over: used or cancelled tickets. */
  dimmed?: boolean;
}) {
  const theme = useTheme();
  const { day, month } = dateBadge(event.startsAt);

  return (
    <PressableScale
      accessibilityRole="button"
      onPress={onPress}
      scaleTo={0.98}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
          borderColor: highlight ? theme.tintSoft : theme.border,
          opacity: dimmed ? 0.6 : 1,
        },
      ]}
    >
      <EventCover
        cover={event.cover}
        variant="banner"
        fallback={{ eventId: event.id, orgId: event.organization.id, title: event.title }}
      />
      <View style={styles.row}>
        <View style={[styles.date, { backgroundColor: dimmed ? theme.backgroundSelected : theme.tintSoft }]}>
          <ThemedText style={[styles.day, { color: dimmed ? theme.textSecondary : theme.tint }]}>{day}</ThemedText>
          <ThemedText style={[styles.month, { color: dimmed ? theme.textSecondary : theme.tint }]}>{month}</ThemedText>
        </View>
        <View style={styles.body}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {event.organization.name}
            {showUniversity && event.organization.university ? ` · ${event.organization.university.name}` : ''}
          </ThemedText>
          <ThemedText style={styles.title} numberOfLines={2}>
            {event.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {formatWeekdayTime(event.startsAt)}
            {event.locationName ? ` · ${event.locationName}` : ''}
          </ThemedText>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </PressableScale>
  );
}

/** The feed's seat label: plain, "Son N yer" in orange when few are left, red when sold out. */
export function seatsLeft({ remaining, capacity }: { remaining: number; capacity: number }) {
  const soldOut = remaining <= 0;
  const fewLeft = !soldOut && remaining <= Math.max(FEW_SEATS, capacity * 0.1);
  const pill = soldOut ? (
    <Pill tone="danger">Tükendi</Pill>
  ) : fewLeft ? (
    <Pill tone="tint">Son {remaining} yer</Pill>
  ) : (
    <Pill>{remaining} yer var</Pill>
  );
  return { pill, fewLeft };
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.large,
    padding: Spacing.three,
  },
  row: { flexDirection: 'row', gap: Spacing.three },
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
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
});
