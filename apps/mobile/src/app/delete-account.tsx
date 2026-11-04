import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/api/client';
import { endSession } from '@/auth/session';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, confirmAction, ErrorBanner, Field, Screen } from '@/components/ui';

const WHAT_HAPPENS = [
  'Adın, e-postan, öğrenci numaran, üniversiten ve şifren silinir.',
  'Henüz başlamamış etkinliklerdeki biletlerin iptal edilir; yerler başkalarına açılır.',
  'Kulüp ekiplerinden çıkarsın; yönettiğin kulüplere erişimin biter.',
  'Katıldığın etkinlikler kulüplerin sayılarında isimsiz olarak kalır.',
  'Bu e-postayla daha sonra yeniden hesap açabilirsin.',
];

export default function DeleteAccount() {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');

  const remove = useMutation({
    mutationFn: async () => {
      const ok = await confirmAction(
        'Hesabını sil',
        'Hesabın ve kişisel bilgilerin kalıcı olarak silinecek. Bu işlem geri alınamaz.',
        'Kalıcı olarak sil',
      );
      if (!ok) return;
      const { error } = await api.DELETE('/me', { body: { password } });
      if (error) throw error;
      // The server has already ended every session; forget this one too.
      await endSession();
      queryClient.clear();
    },
  });

  return (
    <Screen belowHeader>
      <ThemedText type="subtitle">Hesabını sil</ThemedText>
      <Card>
        {WHAT_HAPPENS.map((line) => (
          <ThemedText key={line} type="small">
            • {line}
          </ThemedText>
        ))}
      </Card>
      <Field
        label="Onaylamak için şifreni yaz"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
      />
      <ErrorBanner error={remove.error} />
      <Button
        title="Hesabımı kalıcı olarak sil"
        variant="danger"
        loading={remove.isPending}
        onPress={() => {
          if (password) remove.mutate();
        }}
      />
    </Screen>
  );
}
