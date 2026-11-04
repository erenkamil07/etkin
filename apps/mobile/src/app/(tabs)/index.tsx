import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { EventCard, seatsLeft } from '@/components/event-card';
import { ThemedText } from '@/components/themed-text';
import { ErrorBanner, Loading, Pill, Screen } from '@/components/ui';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { formatPrice } from '@/format';

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
      <View>
        <ThemedText type="subtitle">Etkinlikler</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Kulüplerin yaklaşan etkinlikleri
        </ThemedText>
      </View>
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
          ListEmptyComponent={
            <View style={styles.empty}>
              <ThemedText style={styles.emptyIcon}>🎟️</ThemedText>
              <ThemedText type="smallBold">Şimdilik yaklaşan etkinlik yok</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                Kulüpler yeni etkinlik açınca burada görünecek.
              </ThemedText>
            </View>
          }
          renderItem={({ item }) => {
            const seats = seatsLeft(item);
            return (
              <EventCard
                event={item}
                footer={
                  <View style={styles.pills}>
                    {seats.pill}
                    {item.priceFromCents > 0 ? (
                      <Pill tone="tint">{formatPrice(item.priceFromCents, 'TRY')}</Pill>
                    ) : null}
                  </View>
                }
                highlight={seats.fewLeft}
                onPress={() => router.push({ pathname: '/events/[id]', params: { id: item.id } })}
              />
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.six },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  empty: { alignItems: 'center', gap: Spacing.one, paddingTop: Spacing.six },
  emptyIcon: { fontSize: 44, lineHeight: 56 },
  center: { textAlign: 'center' },
});
