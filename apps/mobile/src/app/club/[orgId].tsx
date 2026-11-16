import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Switch, View } from 'react-native';
import { api } from '@/api/client';
import { useClub, useMe, useOrgRole } from '@/api/queries';
import type { paths } from '@/api/schema';
import { ClubAvatar } from '@/components/club-avatar';
import { EventCard } from '@/components/event-card';
import { CardSkeleton, EventCardSkeleton, PageSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorBanner, Pill, Screen, Segmented } from '@/components/ui';
import { UniversityPicker } from '@/components/university-picker';
import { Spacing } from '@/constants/theme';
import { formatDateTime } from '@/format';
import { useNow } from '@/hooks/use-now';
import { ClubStatusNotice } from '@/orgs/club-status';
import { JoinClub, MembershipInbox } from '@/orgs/membership';

type ClubEvent = paths['/orgs/{orgId}/events']['get']['responses'][200]['content']['application/json'][number];
type NoShowRule = NonNullable<
  paths['/orgs/{orgId}']['patch']['requestBody']['content']['application/json']['noShowRule']
>;

const LIMITS = ['2', '3', '4', '5'] as const;
const BAN_DAYS = ['7', '14', '30'] as const;

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
  const me = useMe();
  const now = useNow(60_000);
  const queryClient = useQueryClient();

  const club = useClub(orgId);
  // The club's campus decides whose "Üniversitem" feed its events lead.
  // The club's no-show rule: off, or N no-shows in 90 days → no tickets for D days.
  const rule = club.data?.noShowRule
    ? { limit: club.data.noShowRule.limit, banDays: club.data.noShowRule.banDays as NoShowRule['banDays'] }
    : null;
  const changeRule = useMutation({
    mutationFn: async (noShowRule: NoShowRule | null) => {
      const { data, error } = await api.PATCH('/orgs/{orgId}', { params: { path: { orgId } }, body: { noShowRule } });
      if (error) throw error;
      return data;
    },
    onSuccess: (updated) => queryClient.setQueryData(['orgs', orgId], updated),
  });
  const changeUniversity = useMutation({
    mutationFn: async (universityId: number | null) => {
      const { data, error } = await api.PATCH('/orgs/{orgId}', { params: { path: { orgId } }, body: { universityId } });
      if (error) throw error;
      return data;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['orgs', orgId], updated);
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });

  // The team sees every event, drafts included; everyone else the upcoming published ones.
  const events = useQuery({
    queryKey: ['orgs', orgId, 'events'],
    queryFn: async () => {
      const { data, error } = await api.GET('/orgs/{orgId}/events', { params: { path: { orgId } } });
      if (error) throw error;
      return data;
    },
    enabled: membership !== undefined,
  });
  const upcoming = useQuery({
    queryKey: ['events', 'club', orgId],
    queryFn: async () => {
      const { data, error } = await api.GET('/events', { params: { query: { orgId, limit: 50 } } });
      if (error) throw error;
      return data.items;
    },
    enabled: me.data !== undefined && membership === undefined,
  });

  const name = club.data?.name ?? membership?.name;

  if (club.isPending && !membership) return <PageSkeleton cover={false} />;

  return (
    <Screen belowHeader>
      <Stack.Screen options={{ title: name ?? 'Kulüp' }} />
      {club.error && !membership ? <ErrorBanner error={club.error} /> : null}
      {name ? (
        <View style={styles.header}>
          <ClubAvatar orgId={orgId} name={name} size={64} />
          <View style={styles.grow}>
            <ThemedText type="subtitle" numberOfLines={2}>
              {name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {[club.data?.university?.name, club.data && `${club.data.memberCount} üye`].filter(Boolean).join(' · ')}
            </ThemedText>
          </View>
        </View>
      ) : null}
      {club.data?.description ? <ThemedText type="small">{club.data.description}</ThemedText> : null}

      {/* The team already counts as members; everyone else can ask to join. */}
      {!membership && name && club.data?.status === 'approved' ? <JoinClub orgId={orgId} clubName={name} /> : null}

      <ClubStatusNotice orgId={orgId} />
      {canManage ? (
        <Button
          title="+ Yeni etkinlik"
          onPress={() => router.push({ pathname: '/new-event/[orgId]', params: { orgId } })}
        />
      ) : null}
      {canManage && club.data ? (
        <>
          <UniversityPicker
            label="Kulübün üniversitesi"
            value={club.data.university ?? undefined}
            onChange={(choice) => changeUniversity.mutate(choice?.id ?? null)}
          />
          {club.data.university ? null : (
            <ThemedText type="small" themeColor="warning">
              Üniversite seçilmezse etkinliklerin öğrencilerin "Üniversitem" listesinde görünmez.
            </ThemedText>
          )}
          <ErrorBanner error={changeUniversity.error} />
        </>
      ) : null}
      {canManage && club.data ? (
        <Card>
          <View style={styles.row}>
            <View style={styles.grow}>
              <ThemedText type="smallBold">Gelmeme kuralı</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {rule
                  ? `Son 90 günde ${rule.limit} etkinliğinize bilet alıp gelmeyen, ${rule.banDays} gün boyunca kulübünüzden bilet alamaz.`
                  : 'Kapalı. Açarsan bilet alıp sürekli gelmeyenler bir süre kulübünden bilet alamaz.'}
              </ThemedText>
            </View>
            <Switch
              value={rule !== null}
              onValueChange={(on) => changeRule.mutate(on ? { limit: 2, banDays: 14 } : null)}
            />
          </View>
          {rule ? (
            <>
              <ThemedText type="small">Kaç kez gelmeyince?</ThemedText>
              <Segmented
                options={LIMITS.map((value) => ({ value, label: `${value} kez` }))}
                value={String(rule.limit) as (typeof LIMITS)[number]}
                onChange={(value) => changeRule.mutate({ ...rule, limit: Number(value) })}
              />
              <ThemedText type="small">Kaç gün bilet alamasın?</ThemedText>
              <Segmented
                options={BAN_DAYS.map((value) => ({ value, label: `${value} gün` }))}
                value={String(rule.banDays) as (typeof BAN_DAYS)[number]}
                onChange={(value) => changeRule.mutate({ ...rule, banDays: Number(value) as NoShowRule['banDays'] })}
              />
              <ThemedText type="small" themeColor="textSecondary">
                Etkinlik başlamadan biletini iptal edenler ve katılımcı listesinde "Mazeretli" saydıkların gelmedi
                sayılmaz.
              </ThemedText>
            </>
          ) : null}
          <ErrorBanner error={changeRule.error} />
        </Card>
      ) : null}

      {canManage && name ? <MembershipInbox orgId={orgId} clubName={name} /> : null}

      <ThemedText type="smallBold">{membership ? 'Etkinlikler' : 'Yaklaşan etkinlikler'}</ThemedText>
      {!membership ? (
        upcoming.isPending ? (
          <EventCardSkeleton count={2} />
        ) : upcoming.error ? (
          <ErrorBanner error={upcoming.error} />
        ) : upcoming.data.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Kulübün şu an yaklaşan etkinliği yok.
          </ThemedText>
        ) : (
          upcoming.data.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              footer={event.audience === 'members' ? <Pill tone="warning">🔒 Üyelere özel</Pill> : null}
              onPress={() => router.push({ pathname: '/events/[id]', params: { id: event.id } })}
            />
          ))
        )
      ) : events.isPending ? (
        <CardSkeleton />
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
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
