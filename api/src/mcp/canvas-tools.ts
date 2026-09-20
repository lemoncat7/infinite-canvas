import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { identifier, pagination, result } from "./contracts.js";
import { page, projectPath, type VioraGateway } from "./gateway.js";

const batchId = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
const side = z.enum(["top", "right", "bottom", "left"]);
const node = z
  .object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    kind: z.enum(["prompt", "image", "video", "note", "voice", "tts", "audio"]),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    title: z.string().max(500),
    body: z.string().max(100000),
    accent: z.string().max(100),
  })
  .passthrough();
const link = z.object({
  from: z.number().int().positive(),
  to: z.number().int().positive(),
  fromSide: side,
  toSide: side,
  inputOrder: z.number().int().min(0).optional(),
});

export type CanvasSnapshot = {
  projectId: string;
  version: number;
  updatedAt: string;
  camera: unknown;
  nodes: Record<string, unknown>[];
  links: Record<string, unknown>[];
};

export function registerCanvasTools(server: McpServer, api: VioraGateway) {
  server.registerTool(
    "viora_canvas_read",
    {
      description:
        "Read canvas version, camera, and paged nodes/links. Follow nextOffset in each collection for large canvases. Use complete node records when updating.",
      inputSchema: { projectId: identifier, ...pagination },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ projectId, offset, limit }) =>
      result(async () => {
        const canvas = await api.call<CanvasSnapshot>(
          "GET",
          `${projectPath(projectId)}/canvas`,
        );
        return {
          ...canvas,
          nodes: page(canvas.nodes, offset, limit),
          links: page(canvas.links, offset, limit),
        };
      }),
  );
  server.registerTool(
    "viora_canvas_allocate_ids",
    {
      description:
        "Reserve a collision-free node ID block before creating nodes. Unused IDs are harmless; this is not a generation request.",
      inputSchema: {
        projectId: identifier,
        count: z.number().int().min(1).max(1000).default(100),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ projectId, count }) =>
      result(() =>
        api.call("POST", `${projectPath(projectId)}/canvas/id-block`, {
          count,
        }),
      ),
  );
  server.registerTool(
    "viora_canvas_apply",
    {
      description:
        "Create/update full nodes and reference links in a version-checked batch. Read first; retain fields not being changed. Reuse batchId for identical retries. On 409 read and reconcile; do not blindly overwrite. Does not delete or clear anything.",
      inputSchema: {
        projectId: identifier,
        baseVersion: z.number().int().min(1),
        batchId,
        nodes: z.array(node).max(100).default([]),
        links: z.array(link).max(100).default([]),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ projectId, baseVersion, batchId, nodes, links }) =>
      result(async () => {
        const operations = [
          ...nodes.map((value) => ({
            type: "node",
            action: "upsert",
            key: String(value.id),
            value,
          })),
          ...links.map((value) => ({
            type: "link",
            action: "upsert",
            key: `${value.from}:${value.to}:${value.fromSide}:${value.toSide}`,
            value,
          })),
        ];
        const updated = await api.call<CanvasSnapshot>(
          "POST",
          `${projectPath(projectId)}/canvas/sync`,
          { clientId: "viora-mcp-client", batchId, baseVersion, operations },
        );
        return {
          projectId,
          version: updated.version,
          updatedAt: updated.updatedAt,
          nodeCount: updated.nodes.length,
          linkCount: updated.links.length,
        };
      }),
  );
}
