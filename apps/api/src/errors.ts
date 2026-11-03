import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

/**
 * RFC 9457 problem details. `code` is the stable, machine-readable identifier
 * clients branch on (e.g. ALREADY_CHECKED_IN); `traceId` matches the
 * x-request-id header and the server logs.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance: string;
  traceId: string;
  errors?: { path: string; message: string }[];
}

/** An expected failure whose message is safe to show to the client. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  problem: Pick<ProblemDetails, 'status' | 'code' | 'detail' | 'errors'>,
) {
  const body: ProblemDetails = {
    type: 'about:blank',
    title: STATUS_TITLES[problem.status] ?? 'Error',
    instance: request.url,
    traceId: request.id,
    ...problem,
  };
  return reply.status(problem.status).type('application/problem+json').send(body);
}

export function registerErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) =>
    sendProblem(request, reply, {
      status: 404,
      code: 'NOT_FOUND',
      detail: `Route ${request.method} ${request.url} does not exist`,
    }),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return sendProblem(request, reply, {
        status: 400,
        code: 'VALIDATION_FAILED',
        detail: `Invalid request ${error.validationContext ?? 'input'}`,
        errors: error.validation.map((issue) => ({
          path: issue.instancePath.replace(/^\//, '').replaceAll('/', '.'),
          message: issue.message ?? 'Invalid value',
        })),
      });
    }

    if (error instanceof AppError) {
      return sendProblem(request, reply, { status: error.status, code: error.code, detail: error.message });
    }

    // Fastify's own client errors (malformed JSON, payload too large, ...) are safe to echo.
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return sendProblem(request, reply, { status, code: error.code ?? 'BAD_REQUEST', detail: error.message });
    }

    request.log.error({ err: error }, 'unhandled error');
    return sendProblem(request, reply, {
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'An unexpected error occurred',
    });
  });
}
