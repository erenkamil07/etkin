import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { publicApi } from '@/api/base';
import { getDeviceId } from '@/auth/device';
import { startSession } from '@/auth/session';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorBanner, Field, Screen } from '@/components/ui';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const signIn = useMutation({
    mutationFn: async () => {
      const { data, error } = await publicApi.POST('/auth/login', {
        body: { email: email.trim(), password, deviceId: await getDeviceId() },
      });
      if (error) throw error;
      await startSession(data);
    },
  });

  return (
    <Screen>
      <ThemedText type="subtitle">Etkin</ThemedText>
      <ThemedText themeColor="textSecondary">Kulüp etkinliklerine katıl, kapıda QR ile gir, puan topla.</ThemedText>

      <Field
        label="E-posta"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        placeholder="ad.soyad@universite.edu.tr"
      />
      <Field
        label="Şifre"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={() => signIn.mutate()}
      />

      <ErrorBanner error={signIn.error} />
      <Button title="Giriş yap" loading={signIn.isPending} onPress={() => signIn.mutate()} />

      <Link href="/sign-up">
        <ThemedText type="linkPrimary">Hesabın yok mu? Kayıt ol</ThemedText>
      </Link>
    </Screen>
  );
}
