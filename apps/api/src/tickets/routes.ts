import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Database } from '../db.js';
import { BEARER, DateTimeOutput, EventParams } from '../schemas.js';
import { cancelTicket, claimTicket, getTicket, listMyTickets } from './service.js';

const Ticket = z.object({
  id: z.uuid(),
  status: z.enum(['active', 'checked_in', 'cancelled']),
  createdAt: DateTimeOutput,
  checkedInAt: DateTimeOutput.nullable(),
  cancelledAt: DateTimeOutput.nullable(),
  ticketType: z.object({ id: z.uuid(), name: z.string() }),
  event: z.object({
    id: z.uuid(),
    title: z.string(),
    startsAt: DateTimeOutput,
    endsAt: DateTimeOutput,
    locationName: z.string().nullable(),
    status: z.enum(['draft', 'published', 'cancelled', 'completed']),
    organization: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }),
  }),
});

const TicketParams = z.object({ ticketId: z.uuid() });

export const ticketRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/events/:eventId/tickets',
    {
      schema: {
        tags: ['tickets'],
        summary: 'Claim a ticket; repeating the call returns the ticket you already hold',
        security: BEARER,
        params: EventParams,
        body: z.object({ ticketTypeId: z.uuid() }),
        response: {
          201: Ticket.describe('A new ticket was issued'),
          200: Ticket.describe('You already held this ticket'),
        },
      },
    },
    async (request, reply) => {
      const { ticket, created } = await claimTicket(
        db,
        currentUser(request).id,
        request.params.eventId,
        request.body.ticketTypeId,
      );
      return reply.status(created ? 201 : 200).send(ticket);
    },
  );

  app.get(
    '/me/tickets',
    {
      schema: {
        tags: ['tickets'],
        summary: 'Your tickets, latest event first',
        security: BEARER,
        response: { 200: z.array(Ticket) },
      },
    },
    async (request) => listMyTickets(db, currentUser(request).id),
  );

  app.get(
    '/tickets/:ticketId',
    {
      schema: {
        tags: ['tickets'],
        summary: 'One of your tickets',
        security: BEARER,
        params: TicketParams,
        response: { 200: Ticket },
      },
    },
    async (request) => getTicket(db, currentUser(request).id, request.params.ticketId),
  );

  app.post(
    '/tickets/:ticketId/cancel',
    {
      schema: {
        tags: ['tickets'],
        summary: 'Give your seat back (until the event starts)',
        security: BEARER,
        params: TicketParams,
        response: { 200: Ticket },
      },
    },
    async (request) => cancelTicket(db, currentUser(request).id, request.params.ticketId),
  );
};
