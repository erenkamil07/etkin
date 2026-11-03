import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { useOrgRole } from '@/api/queries';
import type { paths } from '@/api/schema';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorBanner, Loading, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateTime } from '@/format';
import { useNow } from '@/hooks/use-now';

type ClubEvent = paths['/orgs/{orgId}/events']['get']['responses'][200]['content']['application/json'][number];

const STATUS = { draft: 'Taslak', published: 'Yayında', cancelled: 'İptal', completed: 'Bitti' } as const;

/** Running and upcoming events first (soonest on top), then past ones (latest on top). */
function byRelevance(now: number) {
  return (a: ClubEvent, b: ClubEvent) => {
    const aOver = Date.parse(a.endsAt) < now;
    const bOver = Date.parse(b.endsAt) < now;
    if (aOver !== bOver) return aOver ? 1 : -1;
    const order = Date.parse(a.startsAt) - Date.parse(b.startsAt);
    return aOver ? -order : order;
  };
}

export default function Club() {
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { membership, canManage } = useOrgRole(orgId);
  const now = useNow(60_000);

  const events = useQuery({
    queryKey: ['orgs', orgId, 'events'],
    queryFn: async () => {
      const { data, error } = await api.GET('/orgs/{orgId}/events', { params: { path: { orgId } } });
      if (error) throw error;
      return data;
    },
  });

  return (
    <Screen belowHeader>
      <Stack.Screen options={{ title: membership?.name ?? 'Kulüp' }} />
      {canManage ? (
        <Button
          title="+ Yeni etkinlik"
          onPress={() => router.push({ pathname: '/new-event/[orgId]', params: { orgId } })}
        />
      ) : null}
      <ThemedText type="smallBold">Etkinlikler</ThemedText>
      {events.isPending ? (
        <Loading />
      ) : events.error ? (
        <ErrorBanner error={events.error} />
      ) : events.data.length === 0 ? (
        <ThemedText themeColor="textSecondary">Kulübün henüz etkinliği yok.</ThemedText>
      ) : (
        [...events.data].sort(byRelevance(now)).map((event) => {
          const doorOpen =
            event.status === 'published' &&
            now >= Date.parse(event.checkinOpensAt) &&
            now < Date.parse(event.checkinClosesAt);
          return (
            <Card
              key={event.id}
              onPress={() => router.push({ pathname: '/manage/[eventId]', params: { eventId: event.id, orgId } })}
            >
              <View style={styles.row}>
                <ThemedText type="smallBold" themeColor={doorOpen ? 'success' : 'textSecondary'} style={styles.grow}>
                  {doorOpen ? 'Kapı açık' : STATUS[event.status]}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {event.capacity - event.remaining} / {event.capacity} bilet
                </ThemedText>
              </View>
              <ThemedText>{event.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDateTime(event.startsAt)}
                {event.locationName ? ` · ${event.locationName}` : ''}
              </ThemedText>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
