import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { identifier, requestId, result } from './contracts.js';
import { ApiFailure, projectPath, type VioraGateway } from './gateway.js';
import { uploadImage } from './upload-tools.js';
import { MAX_UPLOAD_BYTES, type UploadSessions } from './upload-sessions.js';

export function registerChunkedUploadTools(server: McpServer, api: VioraGateway, sessions: UploadSessions) {
  server.registerTool('viora_asset_upload_chunked', {
    description: 'Upload images up to 100 MiB without enlarging MCP messages. begin: supply requestId, projectId, name, mimeType, size (bytes), sha256, optional placement. write: uploadId, zero-based index, raw base64 of 1 MiB chunks (last is remaining bytes). status: uploadId, returns received indices and cached result. complete: uploadId, validates SHA-256 and uses existing image upload API. cancel: uploadId, discards only uncommitted chunks. Same chunks and completion retries are deduplicated for 30 minutes in this server process. Restart loses sessions: inspect assets before starting over. Use a local script to send file bytes, not LLM-generated base64.',
    inputSchema: {
      action: z.enum(['begin', 'write', 'status', 'complete', 'cancel']),
      uploadId: identifier.optional(), requestId: requestId.optional(), projectId: identifier.optional(),
      name: z.string().trim().min(1).max(255).refine(v => !/[\x00-\x1f/\\]/.test(v), 'Filename only').optional(),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']).optional(),
      size: z.number().int().min(1).max(MAX_UPLOAD_BYTES).optional(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      placement: z.object({ x: z.number(), y: z.number(), width: z.number().positive().max(10000).default(280), height: z.number().positive().max(10000).default(280) }).optional(),
      index: z.number().int().min(0).max(99).optional(),
      data: z.string().min(4).max(1398104).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, args => result(async () => {
    const owner = api.uploadOwner();
    if (args.action === 'begin') {
      const { requestId, projectId, name, mimeType, size, sha256, placement } = args;
      if (!requestId || !projectId || !name || !mimeType || !size || !sha256) throw new ApiFailure(400, 'begin requires requestId, projectId, name, mimeType, size and sha256');
      await api.call('GET', `${projectPath(projectId)}/assets`);
      return sessions.begin(owner, requestId, { projectId, name, mimeType, size, sha256, placement });
    }
    if (!args.uploadId) throw new ApiFailure(400, 'uploadId required');
    if (args.action === 'status') return sessions.status(owner, args.uploadId);
    if (args.action === 'cancel') return sessions.cancel(owner, args.uploadId);
    if (args.action === 'write') {
      if (args.index === undefined || !args.data) throw new ApiFailure(400, 'write requires index and data');
      return sessions.write(owner, args.uploadId, args.index, args.data);
    }
    return sessions.complete(owner, args.uploadId, input => uploadImage(api, input));
  }));
}
