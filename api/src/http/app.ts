import Fastify from "fastify";

export const app = Fastify({ logger: {
  serializers: {
    // Signed download queries and OAuth codes must never enter automatic access logs.
    req(request) { return { method: request.method, url: request.url?.split('?')[0], host: request.hostname, remoteAddress: request.ip }; },
  },
}, bodyLimit: 150 * 1024 * 1024 });
