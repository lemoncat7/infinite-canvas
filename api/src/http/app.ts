import Fastify from "fastify";

export const app = Fastify({ logger: true, bodyLimit: 150 * 1024 * 1024 });
