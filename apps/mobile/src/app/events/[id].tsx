import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { useMyTickets, useOrgRole } from '@/api/queries';
import type { paths } from '@/api/schema';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorBanner, Loading, Notice, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateTime, formatPrice } from '@/format';
import { useNow } from '@/hooks/use-now';

type Event = paths['/events/{eventId}']['get']['responses'][200]['content']['application/json'];
type TicketType = Event['ticketTypes'][number];

/** Conditions that hold whatever the time, worth telling people up front. */
function rules(type: TicketType): string[] {
  const lines: string[] = [];
  if (type.minPointsRequired > 0) lines.push(`Bu kulüpten en az ${type.minPointsRequired} puanın olmalı.`);
  if (type.allocationMode === 'priority' && type.priorityPointsThreshold !== null && type.prioritySalesStartsAt) {
    lines.push(
      `${type.priorityPointsThreshold}+ puanı olan üyeler ${formatDateTime(type.prioritySalesStartsAt)} itibarıyla erken alabilir; herkes için satış ${formatDateTime(type.salesStartsAt)}.`,
    );
  }
  return lines;
}

/**
 * Whether to offer the claim button right now. It mirrors the API's sales rules
 * only far enough to hide a button that cannot work; points are checked by the
 * API, which has the final word.
 */
function sales(type: TicketType, now: number): { open: boolean; note?: string } {
  if (type.allocationMode === 'lottery') return { open: false, note: 'Bu bilet puan ağırlıklı çekilişle dağıtılır.' };
  if (now >= Date.parse(type.salesEndsAt)) return { open: false, note: 'Satış kapandı.' };
  if (type.remaining <= 0) return { open: false };
  if (now >= Date.parse(type.salesStartsAt)) return { open: true };
  const early = type.prioritySalesStartsAt;
  if (type.allocationMode === 'priority' && early && now >= Date.parse(early)) return { open: true };
  return { open: false, note: `Satış ${formatDateTime(type.salesStartsAt)} tarihinde açılır.` };
}

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const now = useNow(30_000);

  const event = useQuery({
    queryKey: ['events', id],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}', { params: { path: { eventId: id } } });
      if (error) throw error;
      return data;
    },
  });
  const tickets = useMyTickets();
  const held = tickets.data?.find((ticket) => ticket.event.id === id && ticket.status !== 'cancelled');
  const orgId = event.data?.organization.id ?? '';
  const { membership, canManage } = useOrgRole(orgId);

  const claim = useMutation({
    mutationFn: async (ticketTypeId: string) => {
      const { data, error } = await api.POST('/events/{eventId}/tickets', {
        params: { path: { eventId: id } },
        body: { ticketTypeId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (ticket) => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['me', 'tickets'] });
      router.push({ pathname: '/tickets/[id]', params: { id: ticket.id } });
    },
  });

  if (event.isPending) return <Loading />;

  return (
    <Screen belowHeader>
      {event.error ? (
        <ErrorBanner error={event.error} />
      ) : (
        <>
          <View style={styles.heading}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {event.data.organization.name}
            </ThemedText>
            <ThemedText type="subtitle">{event.data.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatDateTime(event.data.startsAt)}
              {event.data.locationName ? ` · ${event.data.locationName}` : ''}
            </ThemedText>
          </View>

          {event.data.status === 'cancelled' ? <Notice tone="danger">Bu etkinlik iptal edildi.</Notice> : null}

          {membership ? (
            // The club's own team lands here from the feed too: give them the door straight away.
            <Card>
              <ThemedText type="smallBold">Kulübünün etkinliği</ThemedText>
              <Button
                title="Kapıda QR okut"
                onPress={() => router.push({ pathname: '/scan/[eventId]', params: { eventId: id, orgId } })}
              />
              {canManage ? (
                <Button
                  title="Katılımcılar ve sayılar"
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/manage/[eventId]', params: { eventId: id, orgId } })}
                />
              ) : null}
            </Card>
          ) : null}

          {event.data.description ? <ThemedText>{event.data.description}</ThemedText> : null}
          {event.data.checkinPoints > 0 ? (
            <Notice tone="success">Kapıda biletin okutulunca {event.data.checkinPoints} kulüp puanı kazanırsın.</Notice>
          ) : null}

          {held ? (
            <Card>
              <ThemedText type="smallBold">Bu etkinlik için biletin var</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {held.ticketType.name}
              </ThemedText>
              <Button
                title="Bileti göster"
                onPress={() => router.push({ pathname: '/tickets/[id]', params: { id: held.id } })}
              />
            </Card>
          ) : (
            <>
              <ThemedText type="smallBold">Bilet türleri</ThemedText>
              {event.data.ticketTypes.map((type) => {
                const state = sales(type, now);
                return (
                  <Card key={type.id}>
                    <View style={styles.row}>
                      <ThemedText style={styles.grow}>{type.name}</ThemedText>
                      <ThemedText type="smallBold">{formatPrice(type.priceCents, type.currency)}</ThemedText>
                    </View>
                    {type.description ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {type.description}
                      </ThemedText>
                    ) : null}
                    <ThemedText type="small">
                      {type.remaining > 0 ? `${type.remaining} / ${type.capacity} yer kaldı` : 'Tükendi'}
                    </ThemedText>
                    {rules(type).map((rule) => (
                      <ThemedText key={rule} type="small" themeColor="textSecondary">
                        {rule}
                      </ThemedText>
                    ))}
                    {state.note ? (
                      <ThemedText type="small" themeColor="warning">
                        {state.note}
                      </ThemedText>
                    ) : null}
                    {event.data.status === 'published' && state.open ? (
                      <Button
                        title="Bileti al"
                        loading={claim.isPending && claim.variables === type.id}
                        onPress={() => claim.mutate(type.id)}
                      />
                    ) : null}
                  </Card>
                );
              })}
              <ErrorBanner error={claim.error} />
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
