import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { publicApi } from '@/api/base';
import { api } from '@/api/client';
import { useClubApplications, useMe, useMyTickets } from '@/api/queries';
import { currentRefreshToken, endSession } from '@/auth/session';
import { Avatar } from '@/components/avatar';
import { ClubAvatar } from '@/components/club-avatar';
import { PressableScale } from '@/components/pressable-scale';
import { BadgeGridSkeleton, CardSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorBanner, Pill, Screen } from '@/components/ui';
import { UniversityPicker } from '@/components/university-picker';
import { PRIVACY_URL, TERMS_URL } from '@/config';
import { BottomTabInset, Radius, Spacing } from '@/constants/theme';
import { formatDate, formatDateTime } from '@/format';
import { useTheme } from '@/hooks/use-theme';
import { type BadgeItem, BadgeSheet, BadgeTile, badgeKey } from '@/profile/badges';
import { NewBadges } from '@/profile/new-badges';
import { PhotoAtEventsSwitch } from '@/profile/photo-at-events';
import { UNIVERSITY_HINT } from '@/universities';

const ROLE = { owner: 'Kurucu', organizer: 'Organizatör', scanner: 'Kapı görevlisi' } as const;

const REASON = {
  checkin: 'Etkinliğe katılım',
  bonus: 'Bonus',
  redemption: 'Harcama',
  adjustment: 'Düzeltme',
  reversal: 'Geri alındı',
} as const;

/** How many attended events the profile lists; the Biletlerim tab has them all. */
const RECENT_EVENTS = 5;

function Stat({ value, label }: { value: number | undefined; label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="title" style={styles.statValue}>
        {value ?? '–'}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

/** A new club's application: waiting, refused, or approved in the last week. */
function ClubStatusPill({ status, reviewedAt }: { status: string; reviewedAt: string | null }) {
  if (status === 'pending') return <Pill tone="warning">İnceleniyor</Pill>;
  if (status === 'rejected') return <Pill tone="danger">Onaylanmadı</Pill>;
  const recent = reviewedAt !== null && Date.now() - Date.parse(reviewedAt) < 7 * 86_400_000;
  return recent ? <Pill tone="success">Onaylandı</Pill> : null;
}

/** Where your request to join a club stands. */
function MembershipPill({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  if (status === 'approved') return <Pill tone="success">Üye</Pill>;
  if (status === 'pending') return <Pill tone="warning">Onay bekliyor</Pill>;
  return <Pill tone="danger">Onaylanmadı</Pill>;
}

function Chevron() {
  return (
    <ThemedText type="subtitle" themeColor="textSecondary">
      ›
    </ThemedText>
  );
}

function SettingsRow({ label, onPress, last = false }: { label: string; onPress: () => void; last?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}
    >
      <ThemedText type="default" style={styles.grow}>
        {label}
      </ThemedText>
      <Chevron />
    </Pressable>
  );
}

export default function Profile() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const me = useMe();
  const tickets = useMyTickets();
  const pendingClubs = useClubApplications().data?.length ?? 0;
  const [openBadge, setOpenBadge] = useState<BadgeItem | null>(null);
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
      // Promise.all, not two awaits: if the first request fails, the second
      // one's rejection must still be handled (a signed-out user fails both).
      const [earned, progress] = await Promise.all([
        api.GET('/me/badges').then(({ data, error }) => {
          if (error) throw error;
          return data;
        }),
        api.GET('/me/badges/progress').then(({ data, error }) => {
          if (error) throw error;
          return data;
        }),
      ]);
      return { earned, progress };
    },
  });

  // The feed shows this university's events first.
  const changeUniversity = useMutation({
    mutationFn: async (universityId: number | null) => {
      const { data, error } = await api.PATCH('/me', { body: { universityId } });
      if (error) throw error;
      return data;
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(['me'], profile);
      queryClient.invalidateQueries({ queryKey: ['events'] });
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

  if (me.isPending) {
    return (
      <Screen>
        <CardSkeleton count={1} avatar />
        <CardSkeleton count={3} />
      </Screen>
    );
  }

  // Most recent first: the door scan is when you were really there.
  const attended = (tickets.data ?? [])
    .filter((ticket) => ticket.status === 'checked_in')
    .sort((a, b) => (b.checkedInAt ?? '').localeCompare(a.checkedInAt ?? ''));
  const badgeItems: BadgeItem[] = badges.data
    ? [...badges.data.earned.map((earned) => ({ earned })), ...badges.data.progress.map((goal) => ({ goal }))]
    : [];

  return (
    <Screen>
      <ThemedText type="subtitle">Profil</ThemedText>
      {me.error ? (
        <ErrorBanner error={me.error} />
      ) : (
        <Card>
          <View style={styles.header}>
            <Avatar url={me.data.avatarUrl} name={me.data.fullName} size={72} />
            <View style={styles.grow}>
              <ThemedText type="default" style={styles.name}>
                {me.data.fullName}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {me.data.email}
              </ThemedText>
              {me.data.university || me.data.studentNumber ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {[me.data.university?.name, me.data.studentNumber && `No: ${me.data.studentNumber}`]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>
              ) : null}
            </View>
          </View>
          {/* "MEÜ Yazılım Topluluğu üyesi": the clubs that accepted you, on your card. */}
          {me.data.clubs.some((club) => club.status === 'approved') ? (
            <View style={styles.memberOf}>
              {me.data.clubs
                .filter((club) => club.status === 'approved')
                .map((club) => (
                  <PressableScale
                    key={club.organizationId}
                    accessibilityRole="link"
                    onPress={() => router.push({ pathname: '/club/[orgId]', params: { orgId: club.organizationId } })}
                    style={[styles.memberChip, { backgroundColor: theme.backgroundSelected }]}
                  >
                    <ClubAvatar orgId={club.organizationId} name={club.name} size={20} />
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.chipLabel}>
                      {club.name} üyesi
                    </ThemedText>
                  </PressableScale>
                ))}
            </View>
          ) : null}
          <Button title="Profili düzenle" variant="secondary" onPress={() => router.push('/edit-profile')} />
        </Card>
      )}

      <View style={styles.stats}>
        <Stat value={tickets.data ? attended.length : undefined} label="Katıldığın etkinlik" />
        <Stat value={points.data?.balance} label="Puan" />
        <Stat value={badges.data?.earned.length} label="Rozet" />
      </View>

      <NewBadges userId={me.data?.id} earned={badges.data?.earned} onOpen={(earned) => setOpenBadge({ earned })} />

      {me.data?.platformRole === 'admin' ? (
        <Card onPress={() => router.push('/moderation')}>
          <View style={styles.row}>
            <View style={styles.grow}>
              <ThemedText type="default">Moderasyon</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Kulüp başvuruları ve bildirilen etkinlikler
              </ThemedText>
            </View>
            {pendingClubs > 0 ? <Pill tone="tint">{`${pendingClubs} yeni başvuru`}</Pill> : null}
            <Chevron />
          </View>
        </Card>
      ) : null}

      {me.data ? (
        <>
          <ThemedText type="smallBold">Kulüplerim</ThemedText>
          {me.data.clubs.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Henüz bir kulübe üye değilsin. Bir etkinlik sayfasında kulübün adına dokunup üye olabilirsin.
            </ThemedText>
          ) : (
            me.data.clubs.map((club) => (
              <Card
                key={club.organizationId}
                onPress={() => router.push({ pathname: '/club/[orgId]', params: { orgId: club.organizationId } })}
              >
                <View style={styles.row}>
                  <ClubAvatar orgId={club.organizationId} name={club.name} />
                  <View style={styles.grow}>
                    <ThemedText type="default">{club.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {club.status === 'approved' && club.decidedAt
                        ? `${formatDate(club.decidedAt)} tarihinden beri üye`
                        : `${formatDate(club.requestedAt)} tarihinde istedin`}
                    </ThemedText>
                  </View>
                  <MembershipPill status={club.status} />
                  <Chevron />
                </View>
              </Card>
            ))
          )}
        </>
      ) : null}

      {/* Club team first: at an event this is the way to the door scanner. */}
      {me.data ? (
        <>
          <ThemedText type="smallBold">Kulüp yönetimi</ThemedText>
          {me.data.memberships.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Bir kulübün ekibinde değilsin. Kulübünü kurarsan etkinlik açıp kapıda bilet okutabilirsin.
            </ThemedText>
          ) : null}
          {me.data.memberships.map((membership) => (
            <Card
              key={membership.organizationId}
              onPress={() => router.push({ pathname: '/club/[orgId]', params: { orgId: membership.organizationId } })}
            >
              <View style={styles.row}>
                <ClubAvatar orgId={membership.organizationId} name={membership.name} />
                <View style={styles.grow}>
                  <ThemedText type="default">{membership.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {ROLE[membership.role]} · etkinlikler, katılımcılar, QR okutma
                  </ThemedText>
                  {/* Under the name, so a long club name keeps its width. */}
                  {membership.pendingRequests > 0 ? (
                    <View style={styles.requestsPill}>
                      <Pill tone="tint">{`${membership.pendingRequests} yeni üyelik isteği`}</Pill>
                    </View>
                  ) : null}
                </View>
                <ClubStatusPill status={membership.clubStatus} reviewedAt={membership.reviewedAt} />
                <Chevron />
              </View>
            </Card>
          ))}
          <Button title="+ Kulüp oluştur" variant="secondary" onPress={() => router.push('/new-club')} />
        </>
      ) : null}

      <ThemedText type="smallBold">Katıldığın etkinlikler</ThemedText>
      {tickets.isPending ? (
        <CardSkeleton />
      ) : tickets.error ? (
        <ErrorBanner error={tickets.error} />
      ) : attended.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Biletin kapıda okutulduğu etkinlikler burada birikir.
        </ThemedText>
      ) : (
        attended.slice(0, RECENT_EVENTS).map((ticket) => (
          <Card
            key={ticket.id}
            onPress={() => router.push({ pathname: '/events/[id]', params: { id: ticket.event.id } })}
          >
            <View style={styles.row}>
              <View style={styles.grow}>
                <ThemedText type="default" numberOfLines={1}>
                  {ticket.event.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {ticket.event.organization.name} · {formatDate(ticket.event.startsAt)}
                </ThemedText>
              </View>
              <Chevron />
            </View>
          </Card>
        ))
      )}

      <ThemedText type="smallBold">Puanların</ThemedText>
      {points.isPending ? (
        <CardSkeleton count={1} />
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
                  <ClubAvatar orgId={club.organization.id} name={club.organization.name} size={24} />
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
        <BadgeGridSkeleton />
      ) : badges.error ? (
        <ErrorBanner error={badges.error} />
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Ayrıntısı için rozete dokun.
          </ThemedText>
          <View style={styles.grid}>
            {badgeItems.map((item) => (
              <BadgeTile key={badgeKey(item)} item={item} onPress={() => setOpenBadge(item)} />
            ))}
          </View>
        </>
      )}
      <BadgeSheet item={openBadge} onClose={() => setOpenBadge(null)} />

      <ThemedText type="smallBold">Ayarlar</ThemedText>
      {me.data ? (
        <Card>
          <UniversityPicker
            label="Üniversite"
            // No university reads as "pick one", whether it was never set or isn't listed.
            value={me.data.university ?? undefined}
            onChange={(choice) => changeUniversity.mutate(choice?.id ?? null)}
            disabled={me.data.universityLockedUntil !== null}
            hint={
              me.data.universityLockedUntil
                ? `${formatDate(me.data.universityLockedUntil)} tarihinde yeniden değiştirebilirsin. Acil bir durumda bize yaz.`
                : UNIVERSITY_HINT
            }
          />
          <ErrorBanner error={changeUniversity.error} />
        </Card>
      ) : null}
      {me.data ? (
        <Card>
          <PhotoAtEventsSwitch />
        </Card>
      ) : null}
      <View style={[styles.settings, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
        <SettingsRow label="Gizlilik politikası" onPress={() => openBrowserAsync(PRIVACY_URL)} />
        <SettingsRow
          label="Kullanım koşulları ve topluluk kuralları"
          onPress={() => openBrowserAsync(TERMS_URL)}
          last
        />
      </View>

      <Button title="Çıkış yap" variant="secondary" loading={signOut.isPending} onPress={() => signOut.mutate()} />
      <Pressable accessibilityRole="button" onPress={() => router.push('/delete-account')} hitSlop={8}>
        <ThemedText type="small" themeColor="danger" style={styles.center}>
          Hesabımı sil
        </ThemedText>
      </Pressable>
      <View style={styles.tabBarSpace} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginBottom: Spacing.two },
  name: { fontSize: 18 },
  grow: { flex: 1 },
  stats: { flexDirection: 'row', gap: Spacing.two },
  stat: { flex: 1, borderRadius: Radius.large, borderWidth: 1, padding: Spacing.three, gap: Spacing.half },
  statValue: { fontSize: 28, lineHeight: 34 },
  requestsPill: { marginTop: Spacing.one },
  memberOf: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginBottom: Spacing.two },
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    maxWidth: '100%',
    borderRadius: Radius.pill,
    paddingVertical: Spacing.one,
    paddingLeft: Spacing.one,
    paddingRight: Spacing.three,
  },
  chipLabel: { flexShrink: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: Spacing.two },
  settings: { borderRadius: Radius.large, borderWidth: 1, overflow: 'hidden' },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  tabBarSpace: { height: BottomTabInset + Spacing.six },
  center: { textAlign: 'center' },
});
