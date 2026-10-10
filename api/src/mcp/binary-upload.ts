import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ApiFailure } from './gateway.js';
import { MAX_UPLOAD_BYTES, type UploadSessions } from './upload-sessions.js';

/** Capability permits staging bytes only. Committing still requires the original MCP credential. */
export class BinaryUploads {
  private readonly secret = randomBytes(32);
  constructor(private readonly sessions: UploadSessions) {}
  ticket(owner: string, uploadId: string) {
    this.sessions.status(owner, uploadId);
    const signature = createHmac('sha256', this.secret).update(`${owner}:${uploadId}`).digest('hex');
    return `${owner}.${signature}`;
  }
  verify(uploadId: string, ticket: string) {
    if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(ticket)) throw new ApiFailure(403, 'Invalid upload ticket');
    const owner = ticket.split('.')[0];
    const expected = this.ticket(owner, uploadId);
    if (!timingSafeEqual(Buffer.from(ticket), Buffer.from(expected))) throw new ApiFailure(403, 'Invalid upload ticket');
    return owner;
  }
}

export function registerBinaryUploadRoute(app: FastifyInstance, sessions: UploadSessions, binary: BinaryUploads) {
  // Encapsulation keeps binary parsing out of unrelated API endpoints.
  app.register(async scope => {
    let receiving = false;
    const active = new WeakSet<object>();
    const release = (request: object) => { if (active.delete(request)) receiving = false; };
    scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_req, body, done) => done(null, body));
    scope.put<{ Params: { uploadId: string } }>('/mcp-uploads/:uploadId', {
      bodyLimit: MAX_UPLOAD_BYTES,
      onRequest: async (request, reply) => {
        reply.header('cache-control', 'no-store');
        try {
          binary.verify(request.params.uploadId, String(request.headers.authorization || '').replace(/^Bearer /, ''));
          if (receiving) return reply.code(429).send({ error: 'Another binary transfer is active; retry later' });
          receiving = true;
          active.add(request);
        } catch (error) {
          if (error instanceof ApiFailure) return reply.code(error.status).send({ error: error.details });
          throw error;
        }
      },
      onResponse: async request => { release(request); },
      onRequestAbort: async request => { release(request); },
      handler: async (request, reply) => {
        try {
          const owner = binary.verify(request.params.uploadId, String(request.headers.authorization || '').replace(/^Bearer /, ''));
          if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'Use application/octet-stream and raw file bytes' });
          return sessions.writeBinary(owner, request.params.uploadId, request.body);
        } catch (error) {
          if (error instanceof ApiFailure) return reply.code(error.status).send({ error: error.details });
          throw error;
        }
      },
    });
  });
}
