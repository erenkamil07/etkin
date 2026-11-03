import { useQuery } from '@tanstack/react-query';
import { FlatList, StyleSheet } from 'react-native';
import { api } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorBanner, Loading, Screen } from '@/components/ui';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { formatDateTime } from '@/format';

const STATUS = { active: 'Aktif', checked_in: 'Kullanıldı', cancelled: 'İptal' } as const;

export default function Tickets() {
  const tickets = useQuery({
    queryKey: ['me', 'tickets'],
    queryFn: async () => {
      const { data, error } = await api.GET('/me/tickets');
      if (error) throw error;
      return data;
    },
  });

  return (
    <Screen scroll={false}>
      <ThemedText type="subtitle">Biletlerim</ThemedText>
      {tickets.isPending ? (
        <Loading />
      ) : tickets.error ? (
        <ErrorBanner error={tickets.error} />
      ) : (
        <FlatList
          data={tickets.data}
          keyExtractor={(ticket) => ticket.id}
          refreshing={tickets.isRefetching}
          onRefresh={() => tickets.refetch()}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary">
              Henüz biletin yok. Etkinlikler sekmesinden bir etkinlik seç.
            </ThemedText>
          }
          renderItem={({ item }) => (
            <Card>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {item.event.organization.name} · {STATUS[item.status]}
              </ThemedText>
              <ThemedText type="default">{item.event.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDateTime(item.event.startsAt)} · {item.ticketType.name}
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
