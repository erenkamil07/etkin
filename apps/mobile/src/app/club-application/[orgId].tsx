import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { api } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorBanner, Loading, Notice, Screen } from '@/components/ui';
import {
  type ApplicantRole,
  type ApplicationDraft,
  type ApplicationErrors,
  ApplicationFields,
  applicationBody,
  checkApplication,
} from '@/orgs/application';
import { useClubApplication } from '@/orgs/club-status';

/** The owner edits a waiting application, or fixes a refused one and applies again. */
export default function ClubApplication() {
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const application = useClubApplication(orgId, true);
  if (application.isPending) return <Loading />;
  if (application.error) {
    return (
      <Screen belowHeader>
        <ErrorBanner error={application.error} />
      </Screen>
    );
  }
  const { status, applicantRole, verificationUrl, applicationNote, rejectionReason } = application.data;
  return (
    <ApplicationForm
      orgId={orgId}
      refused={status === 'rejected'}
      rejectionReason={status === 'rejected' ? rejectionReason : null}
      initial={{
        role: applicantRole as ApplicantRole | null,
        link: verificationUrl ?? '',
        note: applicationNote ?? '',
      }}
    />
  );
}

function ApplicationForm({
  orgId,
  refused,
  rejectionReason,
  initial,
}: {
  orgId: string;
  refused: boolean;
  rejectionReason: string | null;
  initial: ApplicationDraft;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<ApplicationErrors>({});

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.PUT('/orgs/{orgId}/application', {
        params: { path: { orgId } },
        body: applicationBody(draft),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(['orgs', orgId, 'application'], saved);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['me'] }),
        queryClient.invalidateQueries({ queryKey: ['orgs', orgId], exact: true }),
      ]);
      router.back();
    },
  });

  return (
    <Screen belowHeader>
      {refused ? (
        <Notice tone="danger">{`Başvurun onaylanmadı.${rejectionReason ? `\nSebep: ${rejectionReason}` : ''}`}</Notice>
      ) : (
        <ThemedText themeColor="textSecondary">
          Başvurun inceleniyor. Bilgileri düzeltirsen sıradaki yerin değişmez.
        </ThemedText>
      )}
      <ApplicationFields value={draft} onChange={setDraft} errors={errors} />
      <ErrorBanner error={save.error} />
      <Button
        title={refused ? 'Tekrar başvur' : 'Kaydet'}
        loading={save.isPending}
        onPress={() => {
          const found = checkApplication(draft);
          setErrors(found);
          if (Object.keys(found).length === 0) save.mutate();
        }}
      />
    </Screen>
  );
}
