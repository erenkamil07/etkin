import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { useMe } from '@/api/queries';
import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Button, confirmAction, ErrorBanner, Field, Loading, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { pickProfilePhoto, uploadProfilePhoto } from '@/profile/photo';

export default function EditProfile() {
  const me = useMe();
  if (!me.data) return <Loading />;
  return <EditForm initial={me.data} />;
}

function EditForm({
  initial,
}: {
  initial: { fullName: string; studentNumber: string | null; avatarUrl: string | null };
}) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState(initial.fullName);
  const [studentNumber, setStudentNumber] = useState(initial.studentNumber ?? '');
  const [nameError, setNameError] = useState<string>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me'] });

  // The photo is saved the moment it is picked or removed; the fields wait for "Kaydet".
  const photo = useMutation({
    mutationFn: async (action: 'pick' | 'remove') => {
      if (action === 'remove') {
        const ok = await confirmAction('Fotoğrafı kaldır', 'Profil fotoğrafın silinecek.', 'Kaldır');
        if (!ok) return;
        const { error } = await api.DELETE('/me/avatar');
        if (error) throw error;
        return;
      }
      const uri = await pickProfilePhoto();
      if (uri) await uploadProfilePhoto(uri);
    },
    onSuccess: refresh,
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH('/me', {
        body: { fullName: fullName.trim(), studentNumber: studentNumber.trim() || null },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      // Opened from a link on the web there is no page to go back to.
      if (router.canGoBack()) router.back();
      else router.replace('/profile');
    },
  });

  // `initial` follows the cached profile, so a new photo shows as soon as it is saved.
  const avatarUrl = initial.avatarUrl;

  return (
    <Screen belowHeader>
      <View style={styles.photo}>
        <Avatar url={avatarUrl} name={fullName || initial.fullName} size={112} />
        <View style={styles.photoActions}>
          <Button
            title={avatarUrl ? 'Fotoğrafı değiştir' : 'Fotoğraf ekle'}
            variant="secondary"
            loading={photo.isPending && photo.variables === 'pick'}
            onPress={() => photo.mutate('pick')}
          />
          {avatarUrl ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => photo.mutate('remove')}>
              <ThemedText type="small" themeColor="danger" style={styles.center}>
                Fotoğrafı kaldır
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Fotoğrafını sadece bilet aldığın etkinliklerin kulüp ekipleri görür: kapıda biletin okutulunca bilet sahibinin
        sen olduğunu anlarlar.
      </ThemedText>
      <ErrorBanner error={photo.error} />

      <Field label="Ad soyad" value={fullName} onChangeText={setFullName} autoComplete="name" error={nameError} />
      <Field
        label="Öğrenci numarası (isteğe bağlı)"
        value={studentNumber}
        onChangeText={setStudentNumber}
        keyboardType="number-pad"
      />
      <ErrorBanner error={save.error} />
      <Button
        title="Kaydet"
        loading={save.isPending}
        onPress={() => {
          const tooShort = fullName.trim().length < 2;
          setNameError(tooShort ? 'Adını ve soyadını yaz.' : undefined);
          if (!tooShort) save.mutate();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  photoActions: { flex: 1, gap: Spacing.two },
  center: { textAlign: 'center' },
});
