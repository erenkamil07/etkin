import type { paths } from '@/api/schema';

type NewEvent = paths['/orgs/{orgId}/events']['post']['requestBody']['content']['application/json'];
type NewTicketType =
  paths['/orgs/{orgId}/events/{eventId}/ticket-types']['post']['requestBody']['content']['application/json'];

export interface TicketTypeDraft {
  name: string;
  capacity: string;
}

/** What the form holds: everything as typed, so half-typed values never throw. */
export interface EventDraft {
  title: string;
  description: string;
  location: string;
  date: string; // GG.AA.YYYY
  time: string; // SS:DD
  hours: string;
  points: string;
  ticketTypes: TicketTypeDraft[];
  /** Members with enough club points buy before everyone else. */
  priority: boolean;
  priorityPoints: string;
  priorityHours: string;
}

export type DraftErrors = Partial<Record<Exclude<keyof EventDraft, 'ticketTypes'>, string>> & {
  ticketTypes?: Partial<Record<keyof TicketTypeDraft, string>>[];
};

export const emptyTicketType = (): TicketTypeDraft => ({ name: 'Standart', capacity: '' });

export const emptyDraft = (): EventDraft => ({
  title: '',
  description: '',
  location: '',
  date: '',
  time: '19:00',
  hours: '2',
  points: '1',
  ticketTypes: [emptyTicketType()],
  priority: false,
  priorityPoints: '3',
  priorityHours: '24',
});

// Dates and times are typed as digits and formatted as you go, so the plain
// number pad works on every phone (Android's has no "." or ":").

/** "04112026" → "04.11.2026". */
export function typeDate(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('.');
}

/** "1930" → "19:30". */
export function typeTime(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

/** "04.11.2026" for a date `days` from today. */
export function dateIn(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** Local date and time, or null for anything that is not a real moment (31.02, 25:00). */
function parseMoment(date: string, time: string): Date | null {
  const d = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [day, month, year, hour, minute] = [d[1], d[2], d[3], t[1], t[2]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const moment = new Date(year, month - 1, day, hour, minute);
  const roundTrips =
    moment.getDate() === day && moment.getMonth() === month - 1 && moment.getHours() === hour && minute < 60;
  return roundTrips ? moment : null;
}

const wholeNumber = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value) : Number.NaN);
const decimal = (value: string) => Number(value.trim().replace(',', '.'));

/**
 * Checks the draft and turns it into API requests. The API validates
 * everything again; this only explains mistakes in Turkish before sending.
 */
export function buildEvent(
  draft: EventDraft,
  now: number,
): { errors: DraftErrors } | { event: NewEvent; ticketTypes: NewTicketType[] } {
  const errors: DraftErrors = {};
  const title = draft.title.trim();
  if (title.length < 3) errors.title = 'En az 3 karakterlik bir başlık yaz.';

  const startsAt = parseMoment(draft.date, draft.time);
  if (!parseMoment(draft.date, '00:00')) errors.date = 'Tarihi GG.AA.YYYY olarak yaz.';
  else if (!startsAt) errors.time = 'Saati SS:DD olarak yaz.';
  else if (startsAt.getTime() <= now) errors.date = 'Etkinlik ileri bir tarihte olmalı.';

  const hours = decimal(draft.hours);
  if (!(hours >= 0.5 && hours <= 72)) errors.hours = '0,5 ile 72 saat arası.';
  const points = wholeNumber(draft.points);
  if (!(points >= 0 && points <= 100)) errors.points = '0 ile 100 arası.';

  const names = new Set<string>();
  const typeErrors = draft.ticketTypes.map((type) => {
    const found: Partial<Record<keyof TicketTypeDraft, string>> = {};
    const name = type.name.trim().toLocaleLowerCase('tr');
    if (!name) found.name = 'Bir ad ver.';
    else if (names.has(name)) found.name = 'Bu ad iki kez kullanılmış.';
    names.add(name);
    const capacity = wholeNumber(type.capacity);
    if (!(capacity >= 1 && capacity <= 100_000)) found.capacity = '1 ile 100.000 arası.';
    return found;
  });
  if (typeErrors.some((found) => Object.keys(found).length > 0)) errors.ticketTypes = typeErrors;

  const priorityPoints = wholeNumber(draft.priorityPoints);
  const priorityHours = decimal(draft.priorityHours);
  if (draft.priority) {
    if (!(priorityPoints >= 1)) errors.priorityPoints = 'En az 1 puan.';
    if (!(priorityHours > 0)) errors.priorityHours = 'Kaç saat önce açılacağını yaz.';
    else if (startsAt && now + priorityHours * 3_600_000 >= startsAt.getTime()) {
      errors.priorityHours = 'Herkese açık satış etkinlikten önce başlamalı; daha kısa bir süre seç.';
    }
  }

  if (Object.keys(errors).length > 0 || !startsAt) return { errors };

  const generalSales = new Date(now + priorityHours * 3_600_000).toISOString();
  return {
    event: {
      title,
      description: draft.description.trim() || null,
      locationName: draft.location.trim() || null,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + hours * 3_600_000).toISOString(),
      checkinPoints: points,
    },
    ticketTypes: draft.ticketTypes.map((type) => ({
      name: type.name.trim(),
      capacity: wholeNumber(type.capacity),
      // Early access opens now; everyone else can buy `priorityHours` later.
      ...(draft.priority
        ? {
            allocationMode: 'priority' as const,
            priorityPointsThreshold: priorityPoints,
            prioritySalesStartsAt: new Date(now).toISOString(),
            salesStartsAt: generalSales,
          }
        : {}),
    })),
  };
}
