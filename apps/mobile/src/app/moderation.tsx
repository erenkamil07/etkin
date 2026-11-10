import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import type { paths } from '@/api/schema';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, confirmAction, ErrorBanner, Loading, Pill, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateTime } from '@/format';
import { ClubApplications } from '@/moderation/club-applications';
import { REPORT_REASONS } from '@/moderation/reasons';

type ReportedEvent = paths['/admin/reports']['get']['responses'][200]['content']['application/json'][number];

const STATUS = { draft: 'Taslak', published: 'Yayında', cancelled: 'İptal', completed: 'Bitti' } as const;

/** The platform admin's review queues: clubs waiting for approval, then reported events (most reported first). */
export default function Moderation() {
  const queryClient = useQueryClient();
  const queue = useQuery({
    queryKey: ['admin', 'reports'],
    queryFn: async () => {
      const { data, error } = await api.GET('/admin/reports');
      if (error) throw error;
      return data;
    },
  });

  const decide = useMutation({
    mutationFn: async ({ eventId, action }: { eventId: string; action: 'remove' | 'dismiss' }) => {
      const params = { path: { eventId } };
      const { error } =
        action === 'remove'
          ? await api.POST('/admin/events/{eventId}/remove', { params })
          : await api.POST('/admin/events/{eventId}/dismiss-reports', { params });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });

  const remove = async (item: ReportedEvent) => {
    const go = await confirmAction(
      'Etkinlik kaldırılsın mı?',
      `“${item.event.title}” iptal edilir, biletleri iptal olur ve metni silinir. Geri alınamaz.`,
      'Kaldır',
    );
    if (go) decide.mutate({ eventId: item.event.id, action: 'remove' });
  };

  if (queue.isPending) return <Loading />;

  return (
    <Screen belowHeader>
      <ThemedText type="subtitle">Kulüp başvuruları</ThemedText>
      <ClubApplications />
      <ThemedText type="subtitle">Bildirilen etkinlikler</ThemedText>
      <ErrorBanner error={queue.error ?? decide.error} />
      {queue.data?.length === 0 ? <ThemedText themeColor="textSecondary">Açık bildirim yok.</ThemedText> : null}
      {queue.data?.map((item) => {
        const busy = decide.isPending && decide.variables.eventId === item.event.id;
        return (
          <Card key={item.event.id}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {item.event.organization.name}
            </ThemedText>
            <ThemedText type="default">{item.event.title}</ThemedText>
            <View style={styles.row}>
              <Pill tone="danger">{`${item.reports.length} bildirim`}</Pill>
              <Pill>{STATUS[item.event.status]}</Pill>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDateTime(item.event.startsAt)}
              </ThemedText>
            </View>
            {item.reports.map((report) => (
              <View key={report.id} style={styles.report}>
                <ThemedText type="smallBold">{REPORT_REASONS[report.reason].label}</ThemedText>
                {report.details ? <ThemedText type="small">{report.details}</ThemedText> : null}
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDateTime(report.createdAt)}
                </ThemedText>
              </View>
            ))}
            <Button title="Etkinliği kaldır" variant="danger" loading={busy} onPress={() => remove(item)} />
            <Button
              title="Sorun yok, kapat"
              variant="secondary"
              loading={busy}
              onPress={() => decide.mutate({ eventId: item.event.id, action: 'dismiss' })}
            />
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  report: { gap: 2, paddingVertical: Spacing.two },
});
