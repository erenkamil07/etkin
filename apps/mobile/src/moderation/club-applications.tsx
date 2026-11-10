import { useMutation, useQueryClient } from '@tanstack/react-query';
import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { type ClubApplication, useClubApplications } from '@/api/queries';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, confirmAction, ErrorBanner, Field, Loading, Notice, Pill } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { formatDateTime } from '@/format';
import { useTheme } from '@/hooks/use-theme';
import { type ApplicantRole, ROLE_LABEL } from '@/orgs/application';

/** One-tap reasons for the usual refusals; the admin can still write their own. */
const QUICK_REASONS = [
  'Kulübün hesabında ya da sayfasında yetkili olduğunu doğrulayamadık.',
  'Bu kulüp Etkin’de zaten var; kulübün sahibinden seni ekibe eklemesini iste.',
  'Verdiğin bağlantı açılmıyor ya da kulübe ait değil.',
];

const STATUS = { pending: 'bekliyor', approved: 'onaylı', rejected: 'reddedildi' } as const;

/** The platform admin's queue of clubs waiting for approval, oldest first. */
export function ClubApplications() {
  const queryClient = useQueryClient();
  const applications = useClubApplications();
  const [refusing, setRefusing] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const decide = useMutation({
    mutationFn: async ({ orgId, approve }: { orgId: string; approve: boolean }) => {
      const params = { path: { orgId } };
      const { error } = approve
        ? await api.POST('/admin/club-applications/{orgId}/approve', { params })
        : await api.POST('/admin/club-applications/{orgId}/reject', { params, body: { reason: reason.trim() } });
      if (error) throw error;
    },
    onSuccess: () => {
      setRefusing(null);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'club-applications'] });
    },
  });

  const approve = async (item: ClubApplication) => {
    const go = await confirmAction('Kulüp onaylansın mı?', `“${item.club.name}” etkinlik yayınlayabilecek.`, 'Onayla');
    if (go) decide.mutate({ orgId: item.club.id, approve: true });
  };

  if (applications.isPending) return <Loading />;
  if (applications.error) return <ErrorBanner error={applications.error} />;

  return (
    <>
      <ErrorBanner error={decide.error} />
      {applications.data.length === 0 ? (
        <ThemedText themeColor="textSecondary">Bekleyen kulüp başvurusu yok.</ThemedText>
      ) : null}
      {applications.data.map((item) => {
        const busy = decide.isPending && decide.variables.orgId === item.club.id;
        return (
          <Card key={item.club.id}>
            <View style={styles.row}>
              <Pill tone="warning">Onay bekliyor</Pill>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDateTime(item.submittedAt)}
              </ThemedText>
            </View>
            <ThemedText type="default">{item.club.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.club.university?.name ?? 'Üniversite seçilmemiş'} · {item.club.slug}
            </ThemedText>
            {item.club.description ? (
              <ThemedText type="small" numberOfLines={4}>
                {item.club.description}
              </ThemedText>
            ) : null}

            <View style={styles.section}>
              <ThemedText type="smallBold">
                {item.applicant ? item.applicant.fullName : 'Başvuran hesabını silmiş'}
                {item.applicantRole ? ` · ${ROLE_LABEL[item.applicantRole as ApplicantRole]}` : ''}
              </ThemedText>
              {item.applicant ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {item.applicant.email}
                </ThemedText>
              ) : null}
              {item.verificationUrl ? (
                <Pressable
                  accessibilityRole="link"
                  hitSlop={8}
                  onPress={() => item.verificationUrl && openBrowserAsync(item.verificationUrl)}
                >
                  <ThemedText type="small" themeColor="tint">
                    {item.verificationUrl.replace(/^https?:\/\//, '')} ↗
                  </ThemedText>
                </Pressable>
              ) : null}
              {item.applicationNote ? <ThemedText type="small">Not: {item.applicationNote}</ThemedText> : null}
            </View>

            {item.similarClubs.length > 0 ? (
              <Notice tone="warning">
                {`Benzer isimli kulüp var: ${item.similarClubs
                  .map((club) => `${club.name} (${STATUS[club.status]})`)
                  .join(', ')}. Aynı kulüp olmasın?`}
              </Notice>
            ) : null}
            {item.previousRejection ? (
              <Notice tone="warning">{`Daha önce reddedildi: ${item.previousRejection}`}</Notice>
            ) : null}

            {refusing === item.club.id ? (
              <RefuseForm
                reason={reason}
                onChange={setReason}
                busy={busy}
                onCancel={() => setRefusing(null)}
                onRefuse={() => decide.mutate({ orgId: item.club.id, approve: false })}
              />
            ) : (
              <>
                <Button title="Onayla" loading={busy} onPress={() => approve(item)} />
                <Button
                  title="Reddet"
                  variant="secondary"
                  onPress={() => {
                    setReason('');
                    setRefusing(item.club.id);
                  }}
                />
              </>
            )}
          </Card>
        );
      })}
    </>
  );
}

function RefuseForm({
  reason,
  onChange,
  busy,
  onCancel,
  onRefuse,
}: {
  reason: string;
  onChange: (reason: string) => void;
  busy: boolean;
  onCancel: () => void;
  onRefuse: () => void;
}) {
  const theme = useTheme();
  const [error, setError] = useState<string>();
  return (
    <View style={styles.section}>
      {QUICK_REASONS.map((text) => (
        <Pressable
          key={text}
          accessibilityRole="button"
          onPress={() => onChange(text)}
          style={[styles.quick, { borderColor: reason === text ? theme.tint : theme.border }]}
        >
          <ThemedText type="small">{text}</ThemedText>
        </Pressable>
      ))}
      <Field
        label="Sebep (kulüp sahibine gösterilir)"
        value={reason}
        onChangeText={onChange}
        multiline
        maxLength={500}
        error={error}
      />
      <Button
        title="Başvuruyu reddet"
        variant="danger"
        loading={busy}
        onPress={() => {
          const tooShort = reason.trim().length < 3;
          setError(tooShort ? 'Kulüp sahibi neyi düzelteceğini bilsin: kısa bir sebep yaz.' : undefined);
          if (!tooShort) onRefuse();
        }}
      />
      <Button title="Vazgeç" variant="secondary" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  section: { gap: Spacing.one, paddingVertical: Spacing.two },
  quick: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.two },
});
