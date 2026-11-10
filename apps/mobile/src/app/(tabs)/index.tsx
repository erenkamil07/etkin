import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { useMe } from '@/api/queries';
import { EventCard, seatsLeft } from '@/components/event-card';
import { FadeInItem } from '@/components/fade-in-item';
import { EventCardSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorBanner, Pill, Screen, Segmented } from '@/components/ui';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { formatPrice } from '@/format';

type Scope = 'mine' | 'all';

export default function Events() {
  const me = useMe();
  const university = me.data?.university ?? null;
  // Your own campus first; the whole country is one tap away.
  const [chosen, setChosen] = useState<Scope>('mine');
  const scope: Scope = university ? chosen : 'all';
  const universityId = scope === 'mine' ? university?.id : undefined;

  const events = useQuery({
    queryKey: ['events', 'upcoming', universityId ?? 'all'],
    queryFn: async () => {
      const { data, error } = await api.GET('/events', { params: { query: { limit: 50, universityId } } });
      if (error) throw error;
      return data.items;
    },
    // Wait for the profile, so a student with a university never sees the whole country flash first.
    enabled: !me.isPending,
  });

  return (
    <Screen scroll={false}>
      <View>
        <ThemedText type="subtitle">Etkinlikler</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {scope === 'mine' && university ? university.name : 'Türkiye genelindeki kulüpler'}
        </ThemedText>
      </View>
      {university ? (
        <Segmented
          options={[
            { value: 'mine', label: 'Üniversitem' },
            { value: 'all', label: 'Tüm Türkiye' },
          ]}
          value={scope}
          onChange={setChosen}
        />
      ) : me.data ? (
        <Pressable accessibilityRole="link" onPress={() => router.push('/profile')}>
          <ThemedText type="small" themeColor="tint">
            Üniversiteni Profil'den seç, önce kendi kampüsünün etkinliklerini gör ›
          </ThemedText>
        </Pressable>
      ) : null}
      {me.isPending || events.isPending ? (
        <EventCardSkeleton />
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
              <ThemedText type="smallBold">
                {scope === 'mine' ? 'Üniversitende yaklaşan etkinlik yok' : 'Şimdilik yaklaşan etkinlik yok'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                Kulüpler yeni etkinlik açınca burada görünecek.
              </ThemedText>
              {scope === 'mine' ? (
                <Button title="Tüm Türkiye'yi gör" variant="secondary" onPress={() => setChosen('all')} />
              ) : null}
            </View>
          }
          renderItem={({ item, index }) => {
            const seats = seatsLeft(item);
            return (
              <FadeInItem index={index}>
                <EventCard
                  event={item}
                  showUniversity={scope === 'all'}
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
              </FadeInItem>
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
  empty: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.six },
  emptyIcon: { fontSize: 44, lineHeight: 56 },
  center: { textAlign: 'center' },
});
