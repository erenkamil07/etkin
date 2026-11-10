import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { api } from '@/api/client';
import { useOrgRole } from '@/api/queries';
import { Button, Notice } from '@/components/ui';

const RECENT_MS = 7 * 86_400_000;

/** The club owner's application, with the reason when it was refused. */
export function useClubApplication(orgId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['orgs', orgId, 'application'],
    queryFn: async () => {
      const { data, error } = await api.GET('/orgs/{orgId}/application', { params: { path: { orgId } } });
      if (error) throw error;
      return data;
    },
    enabled,
  });
}

/**
 * Where the club's application stands, at the top of its page: waiting,
 * refused (with why, and a way to apply again), or just approved.
 */
export function ClubStatusNotice({ orgId }: { orgId: string }) {
  const { membership } = useOrgRole(orgId);
  const status = membership?.clubStatus;
  const isOwner = membership?.role === 'owner';
  const application = useClubApplication(orgId, isOwner && status === 'rejected');
  const edit = () => router.push({ pathname: '/club-application/[orgId]', params: { orgId } });

  if (status === 'pending') {
    return (
      <>
        <Notice tone="warning">
          Başvurun alındı ve inceleniyor. Genellikle 2 gün içinde sonuçlanır; sonucu burada ve Profil'de görürsün. Bu
          sırada etkinliklerini taslak olarak hazırlayabilirsin, onaylanınca tek dokunuşla yayınlarsın.
        </Notice>
        {isOwner ? <Button title="Başvuru bilgilerini düzenle" variant="secondary" onPress={edit} /> : null}
      </>
    );
  }
  if (status === 'rejected') {
    const reason = application.data?.rejectionReason;
    return (
      <>
        <Notice tone="danger">
          {`Kulüp başvurun onaylanmadı.${reason ? `\nSebep: ${reason}` : ''}\nBilgileri düzeltip tekrar başvurabilirsin.`}
        </Notice>
        {isOwner ? <Button title="Düzeltip tekrar başvur" onPress={edit} /> : null}
      </>
    );
  }
  const reviewedAt = membership?.reviewedAt ? Date.parse(membership.reviewedAt) : 0;
  if (status === 'approved' && Date.now() - reviewedAt < RECENT_MS) {
    return <Notice tone="success">Kulübün onaylandı ✅ Artık etkinliklerini yayınlayabilirsin.</Notice>;
  }
  return null;
}
