import { router } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';
import { useMyTickets } from '@/api/queries';
import { EventCard } from '@/components/event-card';
import { FadeInItem } from '@/components/fade-in-item';
import { EventCardSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorBanner, Pill, Screen } from '@/components/ui';
import { BottomTabInset, Spacing } from '@/constants/theme';

const STATUS = {
  active: <Pill tone="tint">Geçerli · QR göster</Pill>,
  checked_in: <Pill tone="success">Kullanıldı</Pill>,
  cancelled: <Pill tone="danger">İptal</Pill>,
} as const;

export default function Tickets() {
  const tickets = useMyTickets();

  return (
    <Screen scroll={false}>
      <View>
        <ThemedText type="subtitle">Biletlerim</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Kapıda bileti açıp QR kodu okut
        </ThemedText>
      </View>
      {tickets.isPending ? (
        <EventCardSkeleton />
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
            <View style={styles.empty}>
              <ThemedText style={styles.emptyIcon}>🎫</ThemedText>
              <ThemedText type="smallBold">Henüz biletin yok</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                Bir etkinlik seç, biletini al; QR kodun burada seni bekliyor olacak.
              </ThemedText>
              <Button title="Etkinliklere göz at" onPress={() => router.navigate('/')} />
            </View>
          }
          renderItem={({ item, index }) => (
            <FadeInItem index={index}>
              <EventCard
                event={item.event}
                dimmed={item.status !== 'active'}
                footer={
                  <>
                    {STATUS[item.status]}
                    <ThemedText type="small" themeColor="textSecondary">
                      {item.ticketType.name}
                    </ThemedText>
                  </>
                }
                onPress={() => router.push({ pathname: '/tickets/[id]', params: { id: item.id } })}
              />
            </FadeInItem>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.six },
  empty: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.six },
  emptyIcon: { fontSize: 44, lineHeight: 56 },
  center: { textAlign: 'center' },
});
