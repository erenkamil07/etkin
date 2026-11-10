import { ThemedText } from '@/components/themed-text';
import { Choice, Field } from '@/components/ui';

export type ApplicantRole = 'president' | 'board_member' | 'advisor' | 'other';

export const APPLICANT_ROLES: { value: ApplicantRole; label: string }[] = [
  { value: 'president', label: 'Başkan' },
  { value: 'board_member', label: 'Yönetim kurulu üyesi' },
  { value: 'advisor', label: 'Akademik danışman' },
  { value: 'other', label: 'Diğer' },
];

export const ROLE_LABEL = Object.fromEntries(APPLICANT_ROLES.map(({ value, label }) => [value, label])) as Record<
  ApplicantRole,
  string
>;

/** What the applicant tells the Etkin team so they can check the club is real and theirs. */
export interface ApplicationDraft {
  role: ApplicantRole | null;
  link: string;
  note: string;
}

export type ApplicationErrors = { role?: string; link?: string };

/** The API's rule: "@kulup" or "kulup" is an Instagram account; otherwise a web address. */
function looksLikeLink(text: string): boolean {
  const value = text.trim();
  if (/^@?[A-Za-z0-9._]{1,30}$/.test(value) && (value.startsWith('@') || !value.includes('.'))) return true;
  return /^(https?:\/\/)?[^\s/@:]+\.[^\s/@:]+(\/\S*)?$/i.test(value);
}

export function checkApplication(draft: ApplicationDraft): ApplicationErrors {
  const errors: ApplicationErrors = {};
  if (!draft.role) errors.role = 'Kulüpteki görevini seç.';
  if (!looksLikeLink(draft.link)) {
    errors.link = 'Kulübün Instagram hesabını (@kulupadi) ya da web sayfasının adresini yaz.';
  }
  return errors;
}

/** The request body's application fields. Call after `checkApplication` found nothing. */
export const applicationBody = (draft: ApplicationDraft) => ({
  applicantRole: draft.role ?? 'other',
  verificationLink: draft.link.trim(),
  applicationNote: draft.note.trim() || null,
});

export function ApplicationFields({
  value,
  onChange,
  errors,
}: {
  value: ApplicationDraft;
  onChange: (draft: ApplicationDraft) => void;
  errors: ApplicationErrors;
}) {
  return (
    <>
      <ThemedText type="smallBold">Kulüpteki görevin</ThemedText>
      {APPLICANT_ROLES.map((role) => (
        <Choice
          key={role.value}
          label={role.label}
          selected={value.role === role.value}
          onPress={() => onChange({ ...value, role: role.value })}
        />
      ))}
      {errors.role ? (
        <ThemedText type="small" themeColor="danger">
          {errors.role}
        </ThemedText>
      ) : null}
      <Field
        label="Kulübün Instagram hesabı ya da web sayfası"
        placeholder="@kulupadi"
        value={value.link}
        onChangeText={(link) => onChange({ ...value, link })}
        autoCapitalize="none"
        autoCorrect={false}
        error={errors.link}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Kulübün gerçekten var olduğunu ve senin yetkili olduğunu buradan kontrol ederiz; gerekirse kulübün hesabına
        mesaj atarız.
      </ThemedText>
      <Field
        label="Eklemek istediğin bir not (isteğe bağlı)"
        value={value.note}
        onChangeText={(note) => onChange({ ...value, note })}
        multiline
        numberOfLines={3}
        maxLength={500}
      />
    </>
  );
}
