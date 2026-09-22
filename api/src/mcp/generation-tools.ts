import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { CanvasSnapshot } from "./canvas-tools.js";
import { identifier, requestId, result } from "./contracts.js";
import { ApiFailure, projectPath, type VioraGateway } from "./gateway.js";
import { syncGenerationCanvas, type McpJob } from './generation-canvas.js';

export function registerGenerationTools(server: McpServer, api: VioraGateway) {
  server.registerTool(
    "viora_generation_submit",
    {
      description:
        "Submit one asynchronous image/video job on an existing matching source node. Videos get a separate result card with a reference link; source contents are preserved. Returns resultNodeId and canvasSync. May spend credits. Reuse the SAME requestId and inputs on retries. Poll generation_get with syncCanvas=true until terminal, including the final poll, to persist results on the canvas. If linking fails use generation_sync; NEVER submit another billable job to repair the canvas.",
      inputSchema: {
        projectId: identifier,
        nodeId: z.number().int().positive(),
        requestId,
        kind: z.enum(["image", "video"]),
        prompt: z.string().trim().min(1).max(4000),
        model: identifier.optional(),
        inputUrls: z.array(z.string().min(1).max(4000)).max(16).optional().describe('Actual reference image URLs in input order. MCP links matching image cards to this job result and can create missing same-project asset cards; inspect referencesSync for unresolved inputs.'),
        parameters: z
          .object({
            size: z.string().optional(),
            quality: z.string().optional(),
            background: z.string().optional(),
            seconds: z.union([z.string(), z.number()]).optional(),
            resolution: z.string().optional(),
            aspect_ratio: z.string().optional(),
            reference_mode: z.enum(["keyframes", "references"]).optional(),
            seed: z.number().int().optional(),
            negative_prompt: z.string().optional(),
          })
          .strict()
          .optional(),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ requestId, ...input }) =>
      result(async () => {
        const path = `${projectPath(input.projectId)}/canvas`;
        const canvas = await api.call<CanvasSnapshot>("GET", path);
        const target = canvas.nodes.find(
          (node) => node.id === input.nodeId && node.kind === input.kind,
        );
        if (!target)
          throw new ApiFailure(
            400,
            "Create a matching image/video node before submitting generation.",
          );
        const job = await api.call<Record<string, unknown>>(
          "POST",
          "/jobs",
          input,
          requestId,
        );
        // Fetch the complete job: submit/replay responses omit project/result fields.
        // A failed follow-up must still report that generation was accepted.
        try {
          const latest = await api.call<McpJob>('GET', `/jobs/${encodeURIComponent(String(job.id))}`);
          return { ...job, ...latest, ...await syncGenerationCanvas(api, latest, { createMissing: true }) };
        } catch {
          return { ...job, canvasLinked: false, canvasSync: 'pending',
            warning: 'Job accepted. Retry viora_generation_get or viora_generation_sync with this jobId; do not generate again.' };
        }
      }),
  );
  server.registerTool(
    "viora_generation_get",
    {
      description:
        "Read job status and, by default, synchronize the existing result card through the canvas API. Poll at least 2 seconds apart until terminal; the final poll saves mediaUrl and metadata. syncCanvas=false is strictly read-only. Missing/deleted cards are NOT recreated by polling; use generation_sync(createMissing=true) intentionally. result_url requires authenticated download.",
      inputSchema: { jobId: identifier, syncCanvas: z.boolean().default(true) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ jobId, syncCanvas }) => result(async () => {
      const job = await api.call<McpJob>('GET', `/jobs/${encodeURIComponent(jobId)}`);
      return syncCanvas ? { ...job, ...await syncGenerationCanvas(api, job) } : job;
    }),
  );
  server.registerTool(
    'viora_generation_sync',
    {
      description: 'Repair/synchronize an EXISTING job and its input-image reference links without submitting generation or spending credits. Repairs legacy video role and exact result associations. createMissing=true may add a missing result when the source exists, and missing same-project reference image cards. Never recreates a removed source or overwrites a different job. Returns resultNodeId, referencesSync or pending warnings.',
      inputSchema: { jobId: identifier, createMissing: z.boolean().default(false) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ jobId, createMissing }) => result(async () => {
      const job = await api.call<McpJob>('GET', `/jobs/${encodeURIComponent(jobId)}`);
      return { ...job, ...await syncGenerationCanvas(api, job, { createMissing, repairReferences: true }) };
    }),
  );
}
