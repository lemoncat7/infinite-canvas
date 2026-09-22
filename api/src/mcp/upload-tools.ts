import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { randomUUID } from 'node:crypto';
import { identifier, result } from './contracts.js';
import { ApiFailure, projectPath, type VioraGateway } from './gateway.js';
import type { CanvasSnapshot } from './canvas-tools.js';

type UploadedAsset = { id: string; name: string; mimeType: string; size: number; url: string };
export type ImageUploadInput = {
  projectId: string; name: string; mimeType: string; data: string;
  placement?: { x: number; y: number; width: number; height: number };
};

export function registerUploadTools(server: McpServer, api: VioraGateway) {
  server.registerTool('viora_asset_upload', {
    description: 'Upload ONE local image to a project asset library. The caller must read the local file and supply raw base64 (not a path or data URL). Maximum decoded size 1 MiB due to MCP message limits. Optionally add an image canvas node. NOT idempotent: after a lost response inspect assets before retrying. A canvas failure still returns the uploaded asset; use canvas_apply to attach it, never upload again.',
    inputSchema: {
      projectId: identifier,
      name: z.string().trim().min(1).max(255).refine(v => !/[\x00-\x1f/\\]/.test(v), 'Use a filename, not a path'),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']),
      data: z.string().min(4).max(1398104).describe('Raw base64 of at most 1 MiB of image bytes'),
      placement: z.object({
        x: z.number(), y: z.number(),
        width: z.number().positive().max(10000).default(280),
        height: z.number().positive().max(10000).default(280),
      }).optional().describe('Omit to upload only; provide to create an image node'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, ({ projectId, name, mimeType, data, placement }) => result(async () => {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
      throw new ApiFailure(400, 'Supply canonical raw base64, not a file path or data URL');
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > 1024 * 1024) throw new ApiFailure(413, 'Single-call upload is limited to 1 MiB; use viora_asset_upload_chunked for images up to 100 MiB');
    if (bytes.toString('base64') !== data) throw new ApiFailure(400, 'Invalid base64 encoding');
    return uploadImage(api, { projectId, name, mimeType, data, placement });
  }));
}

/** Shared MCP orchestration; both transports use the existing upload API. */
export async function uploadImage(api: VioraGateway, { projectId, name, mimeType, data, placement }: ImageUploadInput) {
    const path = projectPath(projectId);
    // Existing API owns authorization, image validation, storage and persistence.
    const [asset] = await api.call<UploadedAsset[]>('POST', `${path}/assets`, { files: [{ name, mimeType, data }] });
    if (!placement) return { asset, canvasSync: 'not_requested' };
    let node: Record<string, unknown> | undefined;
    const batchId = `mcp-upload-${randomUUID()}`;
    try {
      const lease = await api.call<{ start: number }>('POST', `${path}/canvas/id-block`, { count: 1 });
      node = { id: lease.start, kind: 'image', ...placement, title: asset.name, body: '', accent: '#8ee7ff', mediaUrl: asset.url };
      for (let attempt = 0; attempt < 3; attempt++) {
        const canvas = await api.call<CanvasSnapshot>('GET', `${path}/canvas`);
        try {
          await api.call('POST', `${path}/canvas/sync`, {
            clientId: 'viora-mcp-client', batchId, baseVersion: canvas.version,
            operations: [{ type: 'node', action: 'upsert', key: String(node.id), value: node }],
          });
          return { asset, nodeId: node.id, canvasSync: 'synced' };
        } catch (error) {
          if (!(error instanceof ApiFailure) || error.status !== 409 || attempt === 2) throw error;
          // Never overwrite a node inserted by another client using this ID.
          const latest = await api.call<CanvasSnapshot>('GET', `${path}/canvas`);
          if (latest.nodes.some(n => n.id === node!.id)) throw error;
        }
      }
    } catch {
      return { asset, canvasSync: 'pending', node,
        warning: 'Image uploaded successfully. Read the canvas and use canvas_apply to attach asset.url; do not upload again. Check whether the node already exists after a lost response.' };
    }
}
