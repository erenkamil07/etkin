import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { publicApi } from '@/api/base';
import { api } from '@/api/client';
import { currentRefreshToken, endSession } from '@/auth/session';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorBanner, Loading, Screen } from '@/components/ui';

const ROLE = { owner: 'Kurucu', organizer: 'Organizatör', scanner: 'Kapı görevlisi' } as const;

export default function Profile() {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data, error } = await api.GET('/me');
      if (error) throw error;
      return data;
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
        <>
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

          {me.data.memberships.length > 0 ? (
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
        </>
      )}
      <Button title="Çıkış yap" variant="secondary" loading={signOut.isPending} onPress={() => signOut.mutate()} />
    </Screen>
  );
}
