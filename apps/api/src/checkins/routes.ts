import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Database } from '../db.js';
import { BEARER, DateTimeOutput, OrgEventParams } from '../schemas.js';
import { type ScanInput, scanTicket } from './service.js';

const ScanVerdict = z.object({
  result: z
    .enum([
      'accepted',
      'duplicate',
      'invalid_token',
      'expired_token',
      'wrong_event',
      'ticket_cancelled',
      'outside_window',
    ])
    .describe('Only "accepted" lets the person in'),
  message: z.string(),
  replayed: z.boolean().describe('A retry with the same Idempotency-Key; nothing new was recorded'),
  attendee: z
    .object({ name: z.string(), avatarUrl: z.string().nullable(), studentNumber: z.string().nullable() })
    .nullable()
    .describe('Compare with the person at the door'),
  ticketType: z.string().nullable(),
  checkIn: z
    .object({
      id: z.uuid(),
      at: DateTimeOutput,
      gate: z.string().nullable(),
      method: z.enum(['qr', 'manual']),
      scannedBy: z.string(),
    })
    .nullable()
    .describe('This check-in, or for "duplicate" the original one'),
  pointsAwarded: z.number().int(),
  otherEvent: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  checkedInCount: z.number().int().describe('People admitted to this event so far'),
});

const Gate = z.string().trim().min(1).max(40).optional().describe('e.g. "Ana kapı"');
const DeviceId = z.string().min(1).max(128).optional();
const ScanHeaders = z.object({
  'idempotency-key': z.uuid().optional().describe('One per physical scan; reuse it when retrying'),
});

export const checkInRoutes: FastifyPluginAsyncZod<{ db: Database; qrMasterKey: Uint8Array }> = async (
  app,
  { db, qrMasterKey },
) => {
  const input = (
    params: { orgId: string; eventId: string },
    scannerId: string,
    body: { gate?: string | undefined; deviceId?: string | undefined },
    idempotencyKey: string | undefined,
  ): ScanInput => ({ ...params, scannerId, gate: body.gate, deviceId: body.deviceId, idempotencyKey });

  app.post(
    '/orgs/:orgId/events/:eventId/check-ins',
    {
      onRequest: app.authenticate,
      preHandler: app.requireOrgRole('scanner'),
      schema: {
        tags: ['check-in'],
        summary: 'Scan a ticket QR code at the door (any team role)',
        description:
          'Every scan returns 200 with a verdict; only result "accepted" admits the person. Send a fresh Idempotency-Key per physical scan and reuse it on network retries.',
        security: BEARER,
        params: OrgEventParams,
        headers: ScanHeaders,
        body: z.object({ qr: z.string().min(1).max(200), gate: Gate, deviceId: DeviceId }),
        response: { 200: ScanVerdict },
      },
    },
    async (request) =>
      scanTicket(
        db,
        qrMasterKey,
        input(request.params, currentUser(request).id, request.body, request.headers['idempotency-key']),
        { method: 'qr', qr: request.body.qr },
      ),
  );

  app.post(
    '/orgs/:orgId/events/:eventId/check-ins/manual',
    {
      onRequest: app.authenticate,
      preHandler: app.requireOrgRole('organizer'),
      schema: {
        tags: ['check-in'],
        summary: "Admit a ticket without its QR code, e.g. the holder's phone died (organizer+)",
        security: BEARER,
        params: OrgEventParams,
        headers: ScanHeaders,
        body: z.object({ ticketId: z.uuid(), gate: Gate, deviceId: DeviceId }),
        response: { 200: ScanVerdict },
      },
    },
    async (request) =>
      scanTicket(
        db,
        qrMasterKey,
        input(request.params, currentUser(request).id, request.body, request.headers['idempotency-key']),
        { method: 'manual', ticketId: request.body.ticketId },
      ),
  );
};
