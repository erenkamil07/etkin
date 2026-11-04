import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { publicApi } from '@/api/base';
import { getDeviceId } from '@/auth/device';
import { startSession } from '@/auth/session';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorBanner, Field, Screen } from '@/components/ui';
import { PRIVACY_URL } from '@/config';

interface Form {
  fullName: string;
  email: string;
  password: string;
  university: string;
  studentNumber: string;
}

/** The API's rules, checked here first so mistakes are explained in Turkish. */
function validate(form: Form): Partial<Record<keyof Form, string>> {
  const errors: Partial<Record<keyof Form, string>> = {};
  if (form.fullName.trim().length < 2) errors.fullName = 'Adını ve soyadını yaz.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Geçerli bir e-posta adresi yaz.';
  if (form.password.length < 8) errors.password = 'Şifre en az 8 karakter olmalı.';
  return errors;
}

export default function SignUp() {
  const [form, setForm] = useState<Form>({ fullName: '', email: '', password: '', university: '', studentNumber: '' });
  const [errors, setErrors] = useState<ReturnType<typeof validate>>({});
  const set = (key: keyof Form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  const signUp = useMutation({
    mutationFn: async () => {
      const { data, error } = await publicApi.POST('/auth/register', {
        body: {
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          password: form.password,
          university: form.university.trim() || undefined,
          studentNumber: form.studentNumber.trim() || undefined,
          deviceId: await getDeviceId(),
        },
      });
      if (error) throw error;
      await startSession(data);
    },
  });

  const submit = () => {
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length === 0) signUp.mutate();
  };

  return (
    <Screen>
      <ThemedText type="subtitle">Kayıt ol</ThemedText>

      <Field
        label="Ad soyad"
        value={form.fullName}
        onChangeText={set('fullName')}
        autoComplete="name"
        error={errors.fullName}
      />
      <Field
        label="E-posta"
        value={form.email}
        onChangeText={set('email')}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        error={errors.email}
      />
      <Field
        label="Şifre"
        value={form.password}
        onChangeText={set('password')}
        secureTextEntry
        autoComplete="new-password"
        error={errors.password}
      />
      <Field label="Üniversite (isteğe bağlı)" value={form.university} onChangeText={set('university')} />
      <Field
        label="Öğrenci numarası (isteğe bağlı)"
        value={form.studentNumber}
        onChangeText={set('studentNumber')}
        keyboardType="number-pad"
      />

      <ErrorBanner error={signUp.error} />
      <Button title="Hesabı oluştur" loading={signUp.isPending} onPress={submit} />

      <ThemedText type="small" themeColor="textSecondary">
        Hesap oluşturarak{' '}
        <ThemedText type="small" themeColor="tint" onPress={() => openBrowserAsync(PRIVACY_URL)}>
          Gizlilik Politikası
        </ThemedText>
        'nı okuduğunu kabul edersin.
      </ThemedText>

      <Link href="/sign-in">
        <ThemedText type="linkPrimary">Zaten hesabın var mı? Giriş yap</ThemedText>
      </Link>
    </Screen>
  );
}
