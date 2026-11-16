import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { type ClubMember, useClubMembership, useMe, useMembershipList } from '@/api/queries';
import { Avatar } from '@/components/avatar';
import { CardSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, confirmAction, ErrorBanner, Field, Notice, Pill } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDate } from '@/format';

/** After joining, leaving or answering: the profile, the club and the lists all move. */
function useRefresh(orgId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['me'] });
    queryClient.invalidateQueries({ queryKey: ['orgs', orgId] });
  };
}

/**
 * A student's side of club membership: ask to join (with a student number, which
 * the club's organizers check against their own list), wait, or leave.
 */
export function JoinClub({ orgId, clubName }: { orgId: string; clubName: string }) {
  const me = useMe();
  const membership = useClubMembership(orgId);
  const refresh = useRefresh(orgId);
  const [studentNumber, setStudentNumber] = useState('');
  const [numberError, setNumberError] = useState<string>();
  const needsNumber = me.data !== undefined && !me.data.studentNumber;

  const join = useMutation({
    mutationFn: async () => {
      if (needsNumber) {
        const { error } = await api.PATCH('/me', { body: { studentNumber: studentNumber.trim() } });
        if (error) throw error;
      }
      const { error } = await api.POST('/orgs/{orgId}/membership', { params: { path: { orgId } } });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const leave = useMutation({
    mutationFn: async (kind: 'leave' | 'withdraw') => {
      const ok =
        kind === 'withdraw' ||
        (await confirmAction(
          'Kulüpten ayrıl',
          `${clubName} üyeliğin biter ve üyelere özel etkinliklere bilet alamazsın. İstersen sonra yeniden üye olabilirsin.`,
          'Ayrıl',
        ));
      if (!ok) return;
      const { error } = await api.DELETE('/orgs/{orgId}/membership', { params: { path: { orgId } } });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const ask = () => {
    if (needsNumber && studentNumber.trim().length === 0) {
      setNumberError('Öğrenci numaranı yaz; kulüp yetkilileri üyeliğini bununla kontrol eder.');
      return;
    }
    setNumberError(undefined);
    join.mutate();
  };

  if (membership?.status === 'approved') {
    return (
      <Card>
        <View style={styles.row}>
          <Pill tone="success">Üyesin</Pill>
          <ThemedText type="small" style={styles.grow}>
            {clubName} üyesisin. Üyelere özel etkinliklere bilet alabilirsin.
          </ThemedText>
        </View>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => leave.mutate('leave')}>
          <ThemedText type="small" themeColor="danger">
            Kulüpten ayrıl
          </ThemedText>
        </Pressable>
        <ErrorBanner error={leave.error} />
      </Card>
    );
  }

  if (membership?.status === 'pending') {
    return (
      <>
        <Notice tone="warning">
          Üyelik isteğin {clubName} yetkililerine iletildi. Onaylandığında burada ve profilinde göreceksin.
        </Notice>
        <Button
          title="İsteği geri çek"
          variant="secondary"
          loading={leave.isPending}
          onPress={() => leave.mutate('withdraw')}
        />
        <ErrorBanner error={leave.error} />
      </>
    );
  }

  return (
    <Card>
      <ThemedText type="smallBold">
        {membership?.status === 'rejected' ? 'Üyelik isteğin onaylanmadı' : 'Kulübe üye ol'}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {membership?.status === 'rejected'
          ? 'Bir yanlışlık olduğunu düşünüyorsan kulüple konuşup yeniden isteyebilirsin.'
          : 'Üyelere özel etkinliklere bilet alabilmek için üye ol. İsteğin kulüp yetkililerine gider; adını, fotoğrafını ve öğrenci numaranı görürler.'}
      </ThemedText>
      {needsNumber ? (
        <Field
          label="Öğrenci numaran"
          value={studentNumber}
          onChangeText={setStudentNumber}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={32}
          error={numberError}
        />
      ) : null}
      <Button
        title={membership?.status === 'rejected' ? 'Yeniden iste' : 'Üye ol'}
        loading={join.isPending}
        onPress={ask}
      />
      <ErrorBanner error={join.error} />
    </Card>
  );
}

function MemberLine({ member, detail }: { member: ClubMember; detail: string }) {
  return (
    <View style={styles.row}>
      <Avatar url={member.avatarUrl} name={member.fullName} size={40} />
      <View style={styles.grow}>
        <ThemedText type="default" numberOfLines={1}>
          {member.fullName}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {[member.studentNumber && `No: ${member.studentNumber}`, member.university?.name, detail]
            .filter(Boolean)
            .join(' · ')}
        </ThemedText>
      </View>
    </View>
  );
}

/**
 * The organizers' side: requests to answer (checked against the club's own member
 * list by student number), then the members, who can be taken off the list.
 */
export function MembershipInbox({ orgId, clubName }: { orgId: string; clubName: string }) {
  const queryClient = useQueryClient();
  const refresh = useRefresh(orgId);
  const requests = useMembershipList(orgId, 'pending', true);
  const members = useMembershipList(orgId, 'approved', true);

  const decide = useMutation({
    mutationFn: async ({ userId, approve }: { userId: string; approve: boolean }) => {
      const path = { params: { path: { orgId, userId } } };
      const { error } = approve
        ? await api.POST('/orgs/{orgId}/memberships/{userId}/approve', path)
        : await api.POST('/orgs/{orgId}/memberships/{userId}/reject', path);
      if (error) throw error;
    },
    onSuccess: refresh,
    // A request someone else already answered is gone from the list either way.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['orgs', orgId, 'memberships'] }),
  });
  const remove = useMutation({
    mutationFn: async (member: ClubMember) => {
      const ok = await confirmAction(
        'Üyelikten çıkar',
        `${member.fullName} artık ${clubName} üyesi sayılmaz ve üyelere özel etkinliklere bilet alamaz.`,
        'Çıkar',
      );
      if (!ok) return;
      const { error } = await api.DELETE('/orgs/{orgId}/memberships/{userId}', {
        params: { path: { orgId, userId: member.userId } },
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  return (
    <>
      <View style={styles.row}>
        <ThemedText type="smallBold" style={styles.grow}>
          Üyelik istekleri
        </ThemedText>
        {requests.data && requests.data.length > 0 ? <Pill tone="tint">{`${requests.data.length} yeni`}</Pill> : null}
      </View>
      {requests.isPending ? (
        <CardSkeleton count={1} avatar />
      ) : requests.error ? (
        <ErrorBanner error={requests.error} />
      ) : requests.data.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Bekleyen istek yok. Öğrenciler kulüp sayfasından üye olmak isteyebilir.
        </ThemedText>
      ) : (
        requests.data.map((request) => {
          const busy = decide.isPending && decide.variables?.userId === request.userId;
          return (
            <Card key={request.userId}>
              <MemberLine member={request} detail={`${formatDate(request.requestedAt)} tarihinde istedi`} />
              <View style={styles.buttons}>
                <View style={styles.grow}>
                  <Button
                    title="Onayla"
                    loading={busy && decide.variables?.approve === true}
                    onPress={() => decide.mutate({ userId: request.userId, approve: true })}
                  />
                </View>
                <View style={styles.grow}>
                  <Button
                    title="Reddet"
                    variant="secondary"
                    loading={busy && decide.variables?.approve === false}
                    onPress={() => decide.mutate({ userId: request.userId, approve: false })}
                  />
                </View>
              </View>
            </Card>
          );
        })
      )}
      <ErrorBanner error={decide.error} />

      <ThemedText type="smallBold">Üyeler{members.data ? ` (${members.data.length})` : ''}</ThemedText>
      {members.isPending ? (
        <CardSkeleton count={1} avatar />
      ) : members.error ? (
        <ErrorBanner error={members.error} />
      ) : members.data.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Henüz onaylı üye yok. Kulüp ekibi her zaman üye sayılır.
        </ThemedText>
      ) : (
        <Card>
          {members.data.map((member) => (
            <View key={member.userId} style={styles.row}>
              <View style={styles.grow}>
                <MemberLine
                  member={member}
                  detail={member.decidedAt ? `${formatDate(member.decidedAt)} tarihinden beri` : ''}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${member.fullName} üyelikten çıkar`}
                hitSlop={8}
                onPress={() => remove.mutate(member)}
              >
                <ThemedText type="small" themeColor="danger">
                  Çıkar
                </ThemedText>
              </Pressable>
            </View>
          ))}
        </Card>
      )}
      <ErrorBanner error={remove.error} />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 },
  buttons: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
});
