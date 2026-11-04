import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { api } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { Button, Choice, ErrorBanner, Field, Notice, Screen } from '@/components/ui';
import { TERMS_URL } from '@/config';
import { REPORT_REASONS, type ReportReason } from '@/moderation/reasons';

export default function ReportEvent() {
  const { eventId, title } = useLocalSearchParams<{ eventId: string; title?: string }>();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [missingReason, setMissingReason] = useState(false);

  const send = useMutation({
    mutationFn: async (picked: ReportReason) => {
      const { error } = await api.POST('/events/{eventId}/reports', {
        params: { path: { eventId } },
        body: { reason: picked, details: details.trim() || null },
      });
      if (error) throw error;
    },
  });

  if (send.isSuccess) {
    return (
      <Screen belowHeader>
        <Notice tone="success">
          Bildirimin bize ulaştı, teşekkürler. Etkinliği inceleyip kurallara aykırıysa kaldıracağız.
        </Notice>
        <Button title="Etkinliğe dön" onPress={() => router.back()} />
      </Screen>
    );
  }

  const submit = () => {
    setMissingReason(reason === null);
    if (reason) send.mutate(reason);
  };

  return (
    <Screen belowHeader>
      <ThemedText themeColor="textSecondary">
        {title ? `“${title}” etkinliğinde` : 'Bu etkinlikte'} kurallara aykırı bir şey mi var? Bildirimini Etkin ekibi
        inceler; kimin bildirdiğini kulüp göremez.
      </ThemedText>

      <ThemedText type="smallBold">Sorun ne?</ThemedText>
      {(Object.keys(REPORT_REASONS) as ReportReason[]).map((key) => (
        <Choice
          key={key}
          label={REPORT_REASONS[key].label}
          detail={REPORT_REASONS[key].detail}
          selected={reason === key}
          onPress={() => {
            setReason(key);
            setMissingReason(false);
          }}
        />
      ))}
      {missingReason ? (
        <ThemedText type="small" themeColor="danger">
          Bir sebep seç.
        </ThemedText>
      ) : null}

      <Field
        label="Açıklama (isteğe bağlı)"
        value={details}
        onChangeText={setDetails}
        multiline
        numberOfLines={4}
        maxLength={1000}
        placeholder="Ne gördüğünü kısaca anlat"
      />

      <ErrorBanner error={send.error} />
      <Button title="Bildir" loading={send.isPending} onPress={submit} />
      <ThemedText type="small" themeColor="tint" onPress={() => openBrowserAsync(TERMS_URL)}>
        Topluluk kuralları
      </ThemedText>
    </Screen>
  );
}
