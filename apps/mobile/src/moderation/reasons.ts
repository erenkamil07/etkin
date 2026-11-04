import type { paths } from '@/api/schema';

export type ReportReason = NonNullable<
  paths['/events/{eventId}/reports']['post']['requestBody']
>['content']['application/json']['reason'];

/** The reasons someone can pick when reporting an event, in the order the form shows them. */
export const REPORT_REASONS: Record<ReportReason, { label: string; detail: string }> = {
  inappropriate: {
    label: 'Uygunsuz ya da saldırgan içerik',
    detail: 'Hakaret, nefret söylemi, cinsellik ya da şiddet',
  },
  misleading: {
    label: 'Sahte ya da yanıltıcı etkinlik',
    detail: 'Böyle bir etkinlik yok ya da başka bir kulübü taklit ediyor',
  },
  spam: { label: 'Spam ya da reklam', detail: 'Etkinlik değil, bir ürünü ya da hizmeti tanıtıyor' },
  other: { label: 'Başka bir sorun', detail: 'Açıklamaya yaz' },
};
