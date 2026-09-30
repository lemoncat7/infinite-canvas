import type { FastifyRequest } from 'fastify';

/** Download credentials must stay on the origin used by this MCP client.
 * Forwarding headers are accepted only from explicitly configured direct peers.
 */
export function mcpRequestOrigin(request: FastifyRequest): string {
  const normalize = (ip: string) => ip.replace(/^::ffff:/, '');
  const peers = (process.env.MCP_TRUSTED_PROXY_IPS || '').split(',').map(ip => normalize(ip.trim())).filter(Boolean);
  const trusted = peers.includes(normalize(request.raw.socket.remoteAddress || ''));
  const forwardedHost = trusted ? request.headers['x-forwarded-host'] : undefined;
  const forwardedProto = trusted ? request.headers['x-forwarded-proto'] : undefined;
  const host = forwardedHost ?? request.headers.host;
  const protocol = forwardedProto ?? request.protocol;
  if (typeof host !== 'string' || !host || /[\s,/@?#\\]/.test(host) ||
      (protocol !== 'http' && protocol !== 'https')) {
    throw new Error('Invalid MCP request origin');
  }
  const origin = new URL(`${protocol}://${host}`);
  if (origin.username || origin.password || origin.pathname !== '/') throw new Error('Invalid MCP request origin');
  return origin.origin;
}
