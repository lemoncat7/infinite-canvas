import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { identifier, requestId, result } from './contracts.js';
import { ApiFailure, projectPath, type VioraGateway } from './gateway.js';
import { uploadImage } from './upload-tools.js';
import { MAX_UPLOAD_BYTES, type UploadSessions } from './upload-sessions.js';
import type { BinaryUploads } from './binary-upload.js';

export function registerChunkedUploadTools(server: McpServer, api: VioraGateway, sessions: UploadSessions, binary?: BinaryUploads) {
  server.registerTool(binary ? 'viora_asset_upload_local' : 'viora_asset_upload_chunked', {
    description: binary
      ? 'Upload a local image directly without Base64. begin requires requestId, projectId, filename name, mimeType, size in bytes, sha256, optional placement; returns a short-lived PUT URL and headers. Use your local shell HTTP client to send raw file bytes, then complete with uploadId to import and optionally place on canvas. status retrieves progress/result; cancel discards uncommitted data. Up to 100 MiB, PNG/JPEG/WebP/GIF/AVIF only. Server cannot read client paths. Retry same bytes and complete safely. Sessions expire after 30 minutes and are lost on restart; inspect project assets before restarting an ambiguous completion. Never expose the temporary ticket in user-facing replies.'
      : 'Upload images up to 100 MiB in Base64 chunks. Prefer viora_asset_upload_local for local files. begin requires requestId, projectId, name, mimeType, size, sha256, optional placement. write requires uploadId, index and data (1 MiB chunks, last remainder). status/complete/cancel require uploadId. Sessions expire after 30 minutes and do not survive restart. Complete retries are deduplicated.',
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
      const session = sessions.begin(owner, requestId, { projectId, name, mimeType, size, sha256, placement });
      if (!binary) return session;
      return { ...session, upload: { method: 'PUT', url: api.downloadUrl(`/api/mcp-uploads/${session.uploadId}`),
        headers: { Authorization: `Bearer ${binary.ticket(owner, session.uploadId)}`, 'Content-Type': 'application/octet-stream' } },
        instructions: 'Use a local HTTP tool to PUT raw file bytes (curl --data-binary @LOCAL_FILE) with the returned headers. No Base64, no long-lived API token. Then call this tool action=complete with uploadId. The remote server cannot read your local path. Tickets expire with the session after 30 minutes; restart discards unfinished transfers. Images only.' };
    }
    if (!args.uploadId) throw new ApiFailure(400, 'uploadId required');
    if (args.action === 'status') return sessions.status(owner, args.uploadId);
    if (args.action === 'cancel') return sessions.cancel(owner, args.uploadId);
    if (args.action === 'write') {
      if (binary) throw new ApiFailure(400, 'Use HTTP PUT with raw file bytes from begin, not MCP write');
      if (args.index === undefined || !args.data) throw new ApiFailure(400, 'write requires index and data');
      return sessions.write(owner, args.uploadId, args.index, args.data);
    }
    return sessions.complete(owner, args.uploadId, input => uploadImage(api, input));
  }));
}
