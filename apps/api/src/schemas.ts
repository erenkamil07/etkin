import { z } from 'zod';

/** Accepts any ISO 8601 offset (e.g. +03:00 for Istanbul); responses always use UTC (Z). */
export const DateTimeInput = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
export const DateTimeOutput = z.iso.datetime();

export const OrgParams = z.object({ orgId: z.uuid() });
export const EventParams = z.object({ eventId: z.uuid() });
export const OrgEventParams = OrgParams.extend({ eventId: z.uuid() });

/** OpenAPI marker for routes that need `Authorization: Bearer <accessToken>`. */
export const BEARER = [{ bearerAuth: [] }];

/** For PATCH bodies: every field optional, but an empty object is a client mistake. */
export const atLeastOneField = (body: Record<string, unknown>) =>
  Object.values(body).some((value) => value !== undefined);

export const iso = (date: Date) => date.toISOString();
export const isoOrNull = (date: Date | null) => (date ? date.toISOString() : null);
