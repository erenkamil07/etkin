import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Switch, View } from 'react-native';
import { api } from '@/api/client';
import { useClub, useOrgRole } from '@/api/queries';
import type { paths } from '@/api/schema';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorBanner, Loading, Screen, Segmented } from '@/components/ui';
import { UniversityPicker } from '@/components/university-picker';
import { Spacing } from '@/constants/theme';
import { formatDateTime } from '@/format';
import { useNow } from '@/hooks/use-now';

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
