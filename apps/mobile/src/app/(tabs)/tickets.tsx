import { router } from 'expo-router';
import { FlatList, StyleSheet } from 'react-native';
import { useMyTickets } from '@/api/queries';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorBanner, Loading, Screen } from '@/components/ui';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { formatDateTime } from '@/format';

const STATUS = { active: 'Aktif', checked_in: 'Kullanıldı', cancelled: 'İptal' } as const;

export default function Tickets() {
  const tickets = useMyTickets();

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
            <Card onPress={() => router.push({ pathname: '/tickets/[id]', params: { id: item.id } })}>
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
