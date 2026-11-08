import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useDeferredValue, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { useOrgRole } from '@/api/queries';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, confirmAction, ErrorBanner, Field, Loading, Notice, ProgressBar, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateTime, formatTime } from '@/format';
import { useNow } from '@/hooks/use-now';
import { checkIn, describeVerdict } from '@/orgs/check-in';

// The door is busy while it is open: keep the numbers live without anyone pulling to refresh.
const LIVE_REFRESH_MS = 10_000;

export default function EventDashboard() {
  const { orgId, eventId } = useLocalSearchParams<{ orgId: string; eventId: string }>();
  const { canManage } = useOrgRole(orgId);
  const queryClient = useQueryClient();
  const now = useNow(30_000);
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim());

  const event = useQuery({
    queryKey: ['events', eventId],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}', { params: { path: { eventId } } });
      if (error) throw error;
      return data;
    },
  });
  const path = { orgId, eventId };
  const stats = useQuery({
    queryKey: ['orgs', orgId, 'events', eventId, 'stats'],
    queryFn: async () => {
      const { data, error } = await api.GET('/orgs/{orgId}/events/{eventId}/stats', { params: { path } });
      if (error) throw error;
      return data;
    },
    enabled: canManage,
    refetchInterval: LIVE_REFRESH_MS,
  });
  const attendees = useQuery({
    queryKey: ['orgs', orgId, 'events', eventId, 'attendees', query],
    queryFn: async () => {
      const { data, error } = await api.GET('/orgs/{orgId}/events/{eventId}/attendees', {
        params: { path, query: query ? { q: query } : {} },
      });
      if (error) throw error;
      return data;
    },
    enabled: canManage,
    refetchInterval: LIVE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });

  const admit = useMutation({
    mutationFn: async (attendee: { ticketId: string; name: string }) => {
      const ok = await confirmAction(
        'Elle giriş',
        `${attendee.name} QR kodu olmadan içeri alınacak. Kimliğini kontrol ettin mi?`,
        'İçeri al',
      );
      if (!ok) return null;
      return checkIn(orgId, eventId, { ticketId: attendee.ticketId });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orgs', orgId, 'events', eventId] }),
  });
  const admitted = admit.data ? describeVerdict(admit.data) : null;

  // After the event, a ticket nobody used is a no-show; excusing it keeps it out of the club's no-show rule.
  const excuse = useMutation({
    mutationFn: async ({ ticketId, excused }: { ticketId: string; excused: boolean }) => {
      const { error } = await api.POST('/orgs/{orgId}/events/{eventId}/tickets/{ticketId}/excuse', {
        params: { path: { ...path, ticketId } },
        body: { excused },
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orgs', orgId, 'events', eventId, 'attendees'] }),
  });

  const refreshEvent = () => {
    queryClient.invalidateQueries({ queryKey: ['events'] });
    queryClient.invalidateQueries({ queryKey: ['orgs', orgId, 'events'] });
  };
  const publish = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/orgs/{orgId}/events/{eventId}/publish', { params: { path } });
      if (error) throw error;
    },
    onSuccess: refreshEvent,
  });
  const cancel = useMutation({
    mutationFn: async () => {
      const ok = await confirmAction(
        'Etkinliği iptal et',
        'Etkinlik listeden kalkar ve yeni bilet alınamaz. Bu geri alınamaz.',
        'İptal et',
      );
      if (!ok) return;
      const { error } = await api.POST('/orgs/{orgId}/events/{eventId}/cancel', { params: { path } });
      if (error) throw error;
    },
    onSuccess: refreshEvent,
  });

  if (event.isPending) return <Loading />;
  if (event.error) {
    return (
      <Screen belowHeader>
        <ErrorBanner error={event.error} />
      </Screen>
    );
  }

  const doorOpen =
    event.data.status === 'published' &&
    now >= Date.parse(event.data.checkinOpensAt) &&
    now < Date.parse(event.data.checkinClosesAt);
  const tickets = stats.data?.tickets;
  const ended = now >= Date.parse(event.data.endsAt);

  return (
    <Screen belowHeader>
      <View style={styles.heading}>
        <ThemedText type="subtitle">{event.data.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDateTime(event.data.startsAt)}
          {event.data.locationName ? ` · ${event.data.locationName}` : ''}
        </ThemedText>
        <ThemedText type="smallBold" themeColor={doorOpen ? 'success' : 'textSecondary'}>
          {doorOpen ? 'Kapı açık' : 'Kapı kapalı'} · {formatTime(event.data.checkinOpensAt)} –{' '}
          {formatTime(event.data.checkinClosesAt)}
        </ThemedText>
      </View>

      {event.data.status === 'draft' ? (
        <Notice tone="warning">Taslak: öğrenciler bu etkinliği henüz göremez.</Notice>
      ) : null}
      {event.data.status === 'cancelled' ? <Notice tone="danger">Bu etkinlik iptal edildi.</Notice> : null}
      <ErrorBanner error={publish.error ?? cancel.error} />

      {event.data.status === 'draft' && canManage ? (
        <Button title="Yayınla" loading={publish.isPending} onPress={() => publish.mutate()} />
      ) : null}
      {event.data.status === 'published' ? (
        <Button
          title="Kapıda QR okut"
          onPress={() => router.push({ pathname: '/scan/[eventId]', params: { eventId, orgId } })}
        />
      ) : null}

      {!canManage ? (
        <Notice tone="warning">Sayılar ve katılımcı listesi kulübün organizatörlerine açık.</Notice>
      ) : (
        <>
          {stats.error ? <ErrorBanner error={stats.error} /> : null}
          {tickets ? (
            <Card>
              <View style={styles.row}>
                <ThemedText type="title">{tickets.checkedIn}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
                  içeride, {tickets.issued} biletten{'\n'}
                  {tickets.waiting} kişi bekleniyor
                  {tickets.noShows !== null ? ` · ${tickets.noShows} gelmedi` : ''}
                </ThemedText>
              </View>
              <ProgressBar value={tickets.issued > 0 ? tickets.checkedIn / tickets.issued : 0} />
              {stats.data?.byTicketType.map((type) => (
                <View key={type.id} style={styles.row}>
                  <ThemedText type="small" style={styles.grow}>
                    {type.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {type.checkedIn} içeride · {type.issued} / {type.capacity} bilet
                  </ThemedText>
                </View>
              ))}
            </Card>
          ) : null}

          <ThemedText type="smallBold">Katılımcılar</ThemedText>
          <Field
            label="Ara"
            placeholder="İsim ya da öğrenci numarası"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
          {admitted ? (
            <Notice tone={admitted.tone}>
              {admitted.title}
              {admitted.detail ? `: ${admitted.detail.replaceAll('\n', ' · ')}` : ''}
            </Notice>
          ) : null}
          <ErrorBanner error={admit.error ?? excuse.error ?? attendees.error} />
          {attendees.isPending ? (
            <Loading />
          ) : attendees.data?.length === 0 ? (
            <ThemedText themeColor="textSecondary">
              {query ? 'Aramaya uyan bilet sahibi yok.' : 'Henüz bilet alan yok.'}
            </ThemedText>
          ) : (
            attendees.data?.map((attendee) => (
              <Card key={attendee.ticketId}>
                <View style={styles.row}>
                  <View style={styles.grow}>
                    <ThemedText>{attendee.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {[attendee.studentNumber, attendee.ticketType].filter(Boolean).join(' · ')}
                    </ThemedText>
                  </View>
                  {attendee.status === 'checked_in' ? (
                    <ThemedText type="smallBold" themeColor="success">
                      İçeride{attendee.checkedInAt ? ` ${formatTime(attendee.checkedInAt)}` : ''}
                    </ThemedText>
                  ) : attendee.status === 'cancelled' ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      İptal
                    </ThemedText>
                  ) : ended ? (
                    <View style={styles.noShow}>
                      <ThemedText type="small" themeColor={attendee.excused ? 'textSecondary' : 'warning'}>
                        {attendee.excused ? 'Gelmedi · Mazeretli' : 'Gelmedi'}
                      </ThemedText>
                      <Pressable
                        accessibilityRole="button"
                        disabled={excuse.isPending}
                        onPress={() => excuse.mutate({ ticketId: attendee.ticketId, excused: !attendee.excused })}
                        hitSlop={8}
                      >
                        <ThemedText type="linkPrimary">{attendee.excused ? 'Geri al' : 'Mazeretli say'}</ThemedText>
                      </Pressable>
                    </View>
                  ) : doorOpen ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={admit.isPending}
                      onPress={() => admit.mutate({ ticketId: attendee.ticketId, name: attendee.name })}
                      hitSlop={8}
                    >
                      <ThemedText type="linkPrimary">Elle giriş</ThemedText>
                    </Pressable>
                  ) : (
                    <ThemedText type="small" themeColor="textSecondary">
                      Bekleniyor
                    </ThemedText>
                  )}
                </View>
              </Card>
            ))
          )}

          {event.data.status === 'draft' || event.data.status === 'published' ? (
            <Button
              title="Etkinliği iptal et"
              variant="secondary"
              loading={cancel.isPending}
              onPress={() => cancel.mutate()}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 },
  noShow: { alignItems: 'flex-end', gap: 2 },
});
