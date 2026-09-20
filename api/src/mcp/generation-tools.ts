import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { CanvasSnapshot } from "./canvas-tools.js";
import { identifier, requestId, result } from "./contracts.js";
import { ApiFailure, projectPath, type VioraGateway } from "./gateway.js";

export function registerGenerationTools(server: McpServer, api: VioraGateway) {
  server.registerTool(
    "viora_generation_submit",
    {
      description:
        "Submit one asynchronous image/video job on an existing matching canvas node; returns immediately. May spend credits shown by models_list. A stable requestId is REQUIRED: retries never create or charge a second job. Poll generation_get for results. If canvas linking conflicts, the job still exists; do not resubmit under a new ID.",
      inputSchema: {
        projectId: identifier,
        nodeId: z.number().int().positive(),
        requestId,
        kind: z.enum(["image", "video"]),
        prompt: z.string().trim().min(1).max(4000),
        model: identifier.optional(),
        inputUrls: z.array(z.string().min(1).max(4000)).max(16).optional(),
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
        if (job.replayed && target.jobId === job.id)
          return { ...job, canvasLinked: true };
        if (job.replayed && target.jobId && target.jobId !== job.id)
          return {
            ...job,
            canvasLinked: false,
            warning:
              "Node now references a different job; original result remains available via generation_get.",
          };
        try {
          await api.call("POST", `${path}/sync`, {
            clientId: "viora-mcp-client",
            batchId: `mcp-job-${job.id}`,
            baseVersion: canvas.version,
            operations: [
              {
                type: "node",
                action: "upsert",
                key: String(input.nodeId),
                value: {
                  ...target,
                  jobId: job.id,
                  status: job.status,
                  progress: job.progress,
                },
              },
            ],
          });
          return { ...job, canvasLinked: true };
        } catch {
          return {
            ...job,
            canvasLinked: false,
            warning:
              "Job accepted but canvas linking failed/conflicted. Read the current canvas and attach this jobId; do not generate again.",
          };
        }
      }),
  );
  server.registerTool(
    "viora_generation_get",
    {
      description:
        "Read your asynchronous job status, progress, error and result_url. Poll with backoff (at least 2 seconds), not a tight loop. result_url requires authenticated download.",
      inputSchema: { jobId: identifier },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ jobId }) =>
      result(() => api.call("GET", `/jobs/${encodeURIComponent(jobId)}`)),
  );
}
