import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpRequestOrigin } from '../dist/mcp/request-origin.js';

test('MCP origins follow each connection and only trust configured proxy peers', () => {
  const previous = { ...process.env };
  const request = (host, extra = {}, peer = '127.0.0.1', protocol = 'http') => ({
    headers: { host, ...extra }, protocol, raw: { socket: { remoteAddress: peer } },
  });
  try {
    process.env.MCP_PUBLIC_BASE_URL = 'https://old.example';
    process.env.GENERATION_PUBLIC_BASE_URL = 'https://provider.example';
    delete process.env.MCP_TRUSTED_PROXY_IPS;
    assert.equal(mcpRequestOrigin(request('192.168.2.9:4173')), 'http://192.168.2.9:4173');
    assert.equal(mcpRequestOrigin(request('canvas.example:1443', {}, undefined, 'https')), 'https://canvas.example:1443');
    assert.equal(mcpRequestOrigin(request('[::1]:4173')), 'http://[::1]:4173');
    const forwarded = { 'x-forwarded-host': 'canvas.example:1443', 'x-forwarded-proto': 'https' };
    assert.equal(mcpRequestOrigin(request('192.168.2.9:4173', forwarded)), 'http://192.168.2.9:4173');
    process.env.MCP_TRUSTED_PROXY_IPS = '192.168.224.8';
    assert.equal(mcpRequestOrigin(request('api:3000', forwarded, '::ffff:192.168.224.8')), 'https://canvas.example:1443');
    assert.equal(mcpRequestOrigin(request('192.168.2.9:4173', forwarded)), 'http://192.168.2.9:4173');
    for (const host of ['bad/path', 'user@host', 'host,other', 'host?x', 'host#x', '']) {
      assert.throws(() => mcpRequestOrigin(request(host)));
    }
    assert.throws(() => mcpRequestOrigin(request('api:3000', { ...forwarded, 'x-forwarded-proto': 'https,http' }, '192.168.224.8')));
    assert.equal(process.env.GENERATION_PUBLIC_BASE_URL, 'https://provider.example');
  } finally {
    for (const key of ['MCP_PUBLIC_BASE_URL', 'GENERATION_PUBLIC_BASE_URL', 'MCP_TRUSTED_PROXY_IPS']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
