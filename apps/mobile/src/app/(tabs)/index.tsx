import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, StyleSheet } from 'react-native';
import { api } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorBanner, Loading, Screen } from '@/components/ui';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { formatDateTime } from '@/format';

export default function Events() {
  const events = useQuery({
    queryKey: ['events', 'upcoming'],
    queryFn: async () => {
      const { data, error } = await api.GET('/events', { params: { query: { limit: 50 } } });
      if (error) throw error;
      return data.items;
    },
  });

  return (
    <Screen scroll={false}>
      <ThemedText type="subtitle">Etkinlikler</ThemedText>
      {events.isPending ? (
        <Loading />
      ) : events.error ? (
        <ErrorBanner error={events.error} />
      ) : (
        <FlatList
          data={events.data}
          keyExtractor={(event) => event.id}
          refreshing={events.isRefetching}
          onRefresh={() => events.refetch()}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<ThemedText themeColor="textSecondary">Yaklaşan etkinlik yok.</ThemedText>}
          renderItem={({ item }) => (
            <Card onPress={() => router.push({ pathname: '/events/[id]', params: { id: item.id } })}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {item.organization.name}
              </ThemedText>
              <ThemedText type="default">{item.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDateTime(item.startsAt)}
                {item.locationName ? ` · ${item.locationName}` : ''}
              </ThemedText>
              <ThemedText type="small">
                {item.remaining > 0 ? `${item.remaining} / ${item.capacity} yer kaldı` : 'Tükendi'}
              </ThemedText>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.six },
});
