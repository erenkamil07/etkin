import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { api } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { Button, Choice, ErrorBanner, Field, Screen } from '@/components/ui';
import { type UniversityChoice, UniversityPicker } from '@/components/university-picker';
import { TERMS_URL } from '@/config';
import {
  type ApplicationDraft,
  type ApplicationErrors,
  ApplicationFields,
  applicationBody,
  checkApplication,
} from '@/orgs/application';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TURKISH: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };

/** "IEEE ODTÜ Öğrenci Kolu" → "ieee-odtu-ogrenci-kolu", the club's permanent short name. */
function slugify(name: string): string {
  return name
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşü]/g, (char) => TURKISH[char] ?? char)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

export default function NewClub() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // The short name follows the club name until someone edits it by hand.
  const [customSlug, setCustomSlug] = useState<string | null>(null);
  const slug = customSlug ?? slugify(name);
  // Everything a club writes is public, so its owner agrees to the community rules first.
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [university, setUniversity] = useState<UniversityChoice>(undefined);
  const [application, setApplication] = useState<ApplicationDraft>({ role: null, link: '', note: '' });
  const [errors, setErrors] = useState<
    { name?: string; slug?: string; university?: string; rules?: string } & ApplicationErrors
  >({});

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST('/orgs', {
        body: {
          name: name.trim(),
          slug,
          description: description.trim() || null,
          universityId: university?.id ?? null,
          ...applicationBody(application),
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (club) => {
      // Your new membership, and whether the club is approved, come with /me.
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      // The club page opens on "Başvurun alındı".
      router.replace({ pathname: '/club/[orgId]', params: { orgId: club.id } });
    },
  });

  const submit = () => {
    const found: typeof errors = checkApplication(application);
    if (name.trim().length < 2) found.name = 'Kulübün adını yaz.';
    if (slug.length < 3 || !SLUG.test(slug)) {
      found.slug = 'En az 3 karakter: küçük harf, rakam ve tire (ör. ieee-odtu).';
    }
    if (university === undefined)
      found.university = 'Kulübün hangi üniversitede? Listede yoksa en alttaki seçeneğe dokun.';
    if (!acceptedRules) found.rules = 'Devam etmek için topluluk kurallarını kabul et.';
    setErrors(found);
    if (Object.keys(found).length === 0) create.mutate();
  };

  return (
    <Screen belowHeader>
      <ThemedText themeColor="textSecondary">
        Kulübünü Etkin'e eklemek için başvur. Kulübün gerçekten var olduğunu ve senin yetkili olduğunu kontrol edip
        onaylıyoruz; başvurular genellikle 2 gün içinde sonuçlanır. Beklerken etkinliklerini taslak olarak
        hazırlayabilirsin.
      </ThemedText>
      <Field label="Kulüp adı" value={name} onChangeText={setName} error={errors.name} />
      <UniversityPicker label="Üniversite" value={university} onChange={setUniversity} error={errors.university} />
      <Field
        label="Kısa ad (kalıcı, değiştirilemez)"
        value={slug}
        onChangeText={(value) => setCustomSlug(value.toLocaleLowerCase('tr'))}
        autoCapitalize="none"
        autoCorrect={false}
        error={errors.slug}
      />
      <Field
        label="Açıklama (isteğe bağlı)"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
      />
      <ThemedText type="subtitle">Başvuru bilgileri</ThemedText>
      <ApplicationFields value={application} onChange={setApplication} errors={errors} />
      <Choice
        kind="checkbox"
        selected={acceptedRules}
        onPress={() => setAcceptedRules((value) => !value)}
        label={
          <>
            <ThemedText themeColor="tint" onPress={() => openBrowserAsync(TERMS_URL)}>
              Topluluk kurallarını
            </ThemedText>{' '}
            okudum; kulübümün paylaştıkları bu kurallara uyacak.
          </>
        }
      />
      {errors.rules ? (
        <ThemedText type="small" themeColor="danger">
          {errors.rules}
        </ThemedText>
      ) : null}
      <ErrorBanner error={create.error} />
      <Button title="Başvuruyu gönder" loading={create.isPending} onPress={submit} />
    </Screen>
  );
}
