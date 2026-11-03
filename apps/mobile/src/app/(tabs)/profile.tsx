import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { publicApi } from '@/api/base';
import { api } from '@/api/client';
import { useMe } from '@/api/queries';
import type { paths } from '@/api/schema';
import { currentRefreshToken, endSession } from '@/auth/session';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorBanner, Loading, ProgressBar, Screen } from '@/components/ui';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { formatDateTime } from '@/format';
import { useTheme } from '@/hooks/use-theme';

const ROLE = { owner: 'Kurucu', organizer: 'Organizatör', scanner: 'Kapı görevlisi' } as const;

const REASON = {
  checkin: 'Etkinliğe katılım',
  bonus: 'Bonus',
  redemption: 'Harcama',
  adjustment: 'Düzeltme',
  reversal: 'Geri alındı',
} as const;

/** Platform badges get their own picture; club badges share the medal. */
const BADGE_EMOJI: Record<string, string> = {
  first_checkin: '👣',
  regular_5: '⭐',
  regular_20: '🏆',
  explorer_3: '🧭',
};
const badgeEmoji = (code: string) => BADGE_EMOJI[code] ?? '🏅';

type BadgeGoal = paths['/me/badges/progress']['get']['responses'][200]['content']['application/json'][number];

/** What is left to do, e.g. "3 farklı kulübün etkinliğine katıl". Descriptions are written for when it is earned. */
function goal(badge: BadgeGoal): string {
  if (badge.rule === 'distinct_clubs') return `${badge.target} farklı kulübün etkinliğine katıl`;
  if (badge.organization) return `${badge.organization.name} etkinliklerinden ${badge.target} tanesine katıl`;
  return badge.target === 1 ? 'İlk etkinliğine katıl' : `${badge.target} etkinliğe katıl`;
}

function BadgeTile({
  code,
  name,
  detail,
  progress,
}: {
  code: string;
  name: string;
  detail: string;
  progress?: { current: number; target: number };
}) {
  const theme = useTheme();
  const locked = progress !== undefined;
  return (
    <View style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText style={[styles.emoji, locked && styles.locked]}>{badgeEmoji(code)}</ThemedText>
      <ThemedText type="smallBold" themeColor={locked ? 'textSecondary' : 'text'}>
        {name}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {detail}
      </ThemedText>
      {progress ? (
        <>
          <ProgressBar value={progress.current / progress.target} />
          <ThemedText type="small" themeColor="textSecondary">
            {progress.current} / {progress.target}
          </ThemedText>
        </>
      ) : null}
    </View>
  );
}

export default function Profile() {
  const queryClient = useQueryClient();
  const me = useMe();
  const points = useQuery({
    queryKey: ['me', 'points'],
    queryFn: async () => {
      const { data, error } = await api.GET('/me/points');
      if (error) throw error;
      return data;
    },
  });
  const badges = useQuery({
    queryKey: ['me', 'badges'],
    queryFn: async () => {
      const earned = api.GET('/me/badges').then(({ data, error }) => {
        if (error) throw error;
        return data;
      });
      const progress = api.GET('/me/badges/progress').then(({ data, error }) => {
        if (error) throw error;
        return data;
      });
      return { earned: await earned, progress: await progress };
    },
  });

  const signOut = useMutation({
    mutationFn: async () => {
      const refreshToken = currentRefreshToken();
      // Best effort: end this device's session on the server, then locally regardless.
      if (refreshToken) await publicApi.POST('/auth/logout', { body: { refreshToken } }).catch(() => undefined);
      await endSession();
      queryClient.clear();
    },
  });

  if (me.isPending) return <Loading />;

  return (
    <Screen>
      <ThemedText type="subtitle">Profil</ThemedText>
      {me.error ? (
        <ErrorBanner error={me.error} />
      ) : (
        <Card>
          <ThemedText type="default">{me.data.fullName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {me.data.email}
          </ThemedText>
          {me.data.university ? (
            <ThemedText type="small" themeColor="textSecondary">
              {me.data.university}
              {me.data.studentNumber ? ` · ${me.data.studentNumber}` : ''}
            </ThemedText>
          ) : null}
        </Card>
      )}

      <ThemedText type="smallBold">Puanların</ThemedText>
      {points.isPending ? (
        <Loading />
      ) : points.error ? (
        <ErrorBanner error={points.error} />
      ) : (
        <>
          <Card>
            <View style={styles.row}>
              <ThemedText type="title">{points.data.balance}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
                harcanabilir puan{'\n'}toplam kazanılan {points.data.lifetimeEarned}
              </ThemedText>
            </View>
            {points.data.clubs.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Etkinliklerde biletin kapıda okutuldukça kulüpten puan kazanırsın. Puanı yüksek üyeler sınırlı
                etkinliklere erken erişir.
              </ThemedText>
            ) : (
              points.data.clubs.map((club) => (
                <View key={club.organization.id} style={styles.row}>
                  <ThemedText type="small" style={styles.grow}>
                    {club.organization.name}
                  </ThemedText>
                  <ThemedText type="smallBold">{club.balance} puan</ThemedText>
                </View>
              ))
            )}
          </Card>

          {points.data.history.length > 0 ? (
            <Card>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Son hareketler
              </ThemedText>
              {points.data.history.slice(0, 5).map((entry) => (
                <View key={`${entry.at}-${entry.delta}-${entry.organization.id}`} style={styles.row}>
                  <View style={styles.grow}>
                    <ThemedText type="small">{entry.event?.title ?? entry.note ?? REASON[entry.reason]}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {REASON[entry.reason]} · {formatDateTime(entry.at)}
                    </ThemedText>
                  </View>
                  <ThemedText type="smallBold" themeColor={entry.delta > 0 ? 'success' : 'danger'}>
                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                  </ThemedText>
                </View>
              ))}
            </Card>
          ) : null}
        </>
      )}

      <ThemedText type="smallBold">Rozetler</ThemedText>
      {badges.isPending ? (
        <Loading />
      ) : badges.error ? (
        <ErrorBanner error={badges.error} />
      ) : (
        <View style={styles.grid}>
          {badges.data.earned.map((badge) => (
            <BadgeTile
              key={badge.code + (badge.organization?.id ?? '')}
              code={badge.code}
              name={badge.name}
              detail={badge.organization?.name ?? formatDateTime(badge.awardedAt)}
            />
          ))}
          {badges.data.progress.map((badge) => (
            <BadgeTile
              key={badge.code + (badge.organization?.id ?? '')}
              code={badge.code}
              name={badge.name}
              detail={goal(badge)}
              progress={{ current: badge.current, target: badge.target }}
            />
          ))}
        </View>
      )}

      {me.data && me.data.memberships.length > 0 ? (
        <>
          <ThemedText type="smallBold">Kulüplerin</ThemedText>
          {me.data.memberships.map((membership) => (
            <Card key={membership.organizationId}>
              <ThemedText type="default">{membership.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {ROLE[membership.role]}
              </ThemedText>
            </Card>
          ))}
        </>
      ) : null}

      <Button title="Çıkış yap" variant="secondary" loading={signOut.isPending} onPress={() => signOut.mutate()} />
      <View style={styles.tabBarSpace} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { flexBasis: '48%', flexGrow: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.one },
  emoji: { fontSize: 32, lineHeight: 40 },
  locked: { opacity: 0.35 },
  tabBarSpace: { height: BottomTabInset + Spacing.six },
});
