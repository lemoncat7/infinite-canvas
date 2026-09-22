// Usage: VIORA_MCP_URL=... VIORA_MCP_TOKEN=... node scripts/mcp-upload-image.mjs <projectId> <file> [requestId]
// Optional VIORA_UPLOAD_PLACEMENT='{"x":0,"y":0,"width":280,"height":280}'.
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [projectId, file, requestId = randomUUID()] = process.argv.slice(2);
const url = process.env.VIORA_MCP_URL, token = process.env.VIORA_MCP_TOKEN;
const client = new Client({ name: 'viora-local-image-upload', version: '1.0.0' });
try {
  if (!projectId || !file || !url || !token) throw new Error('Provide projectId, file and VIORA_MCP_URL / VIORA_MCP_TOKEN environment variables');
  if ((await stat(file)).size > 100 * 1024 * 1024) throw new Error('File exceeds 100 MiB');
  const bytes = await readFile(file);
  if (!bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error('File must be 1 byte to 100 MiB');
  const mimeType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' }[extname(file).toLowerCase()];
  if (!mimeType) throw new Error('Unsupported image extension');
  const placement = process.env.VIORA_UPLOAD_PLACEMENT ? JSON.parse(process.env.VIORA_UPLOAD_PLACEMENT) : undefined;
  console.error(`Upload requestId: ${requestId}. Reuse this ID and identical inputs after interruption. If the server restarted or 30 minutes elapsed, inspect assets before retrying.`);
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const call = async args => {
    const response = await client.callTool({ name: 'viora_asset_upload_chunked', arguments: args });
    if (response.isError) throw new Error(response.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
    return response.structuredContent.data;
  };
  const session = await call({ action: 'begin', requestId, projectId, name: basename(file), mimeType, size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), ...(placement ? { placement } : {}) });
  if (session.state === 'complete') console.log(JSON.stringify(session.result, null, 2));
  else {
    if (session.state !== 'receiving') throw new Error(`Upload is ${session.state}; inspect status/assets before retrying`);
    const received = new Set(session.receivedChunks);
    for (let index = 0; index < session.chunkCount; index++) {
      if (received.has(index)) continue;
      await call({ action: 'write', uploadId: session.uploadId, index,
        data: bytes.subarray(index * session.chunkBytes, (index + 1) * session.chunkBytes).toString('base64') });
      console.error(`Uploaded chunk ${index + 1}/${session.chunkCount}`);
    }
    console.log(JSON.stringify(await call({ action: 'complete', uploadId: session.uploadId }), null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Upload failed');
  process.exitCode = 1;
} finally {
  await client.close();
}
