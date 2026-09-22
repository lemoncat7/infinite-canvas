import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { registerCanvasTools } from "./canvas-tools.js";
import { identifier, pagination, result } from "./contracts.js";
import { page, projectPath, VioraGateway } from "./gateway.js";
import { registerGenerationTools } from "./generation-tools.js";
import { registerAssetTools } from "./asset-tools.js";
import { registerUploadTools } from "./upload-tools.js";
import { registerChunkedUploadTools } from './chunked-upload-tools.js';
import type { UploadSessions } from './upload-sessions.js';

export function createVioraMcp(gateway: VioraGateway, uploads: UploadSessions) {
  const server = new McpServer(
    { name: "viora-infinite-canvas", version: "1.2.0" },
    {
      instructions:
        "For local images over 1 MiB use viora_asset_upload_chunked (up to 100 MiB), preferably from a local script that reads and sends chunks without copying base64 into conversation. Upload sessions expire after 30 minutes and do not survive restart. " +
        "Video submission returns a separate resultNodeId. Poll viora_generation_get with syncCanvas=true through the final state to persist the result. Repair pending canvas links with viora_generation_sync, never a new generation; createMissing=true is an explicit request to add a missing result. syncCanvas=false is strictly read-only. " +
        "Use the current model catalog. Read the canvas version and allocate node IDs before writing. Preserve full node records on updates. A 409 requires re-reading and reconciling, not overwriting. Generation is asynchronous and can cost credits: submit once with a stable requestId, then poll the job. To deliver generated files, call viora_asset_get for a temporary no-header download URL, save it into the current session working directory using your local tools, then send the saved file as an attachment. Never request/expose the long-lived MCP token or claim a local path before downloading. V1 does not expose administrator configuration or deletion tools.",
    },
  );
  server.registerTool(
    "viora_projects_list",
    {
      description: "List only projects owned by the authenticated user.",
      inputSchema: pagination,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ offset, limit }) =>
      result(async () =>
        page(await gateway.call<unknown[]>("GET", "/projects"), offset, limit),
      ),
  );
  server.registerTool(
    "viora_project_create",
    {
      description:
        "Create an empty project. This operation is not idempotent; check projects before retrying after a lost response.",
      inputSchema: { name: z.string().trim().min(1).max(60) },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ name }) => result(() => gateway.call("POST", "/projects", { name })),
  );
  server.registerTool(
    "viora_models_list",
    {
      description:
        "Read enabled models, defaults, capabilities and credit costs. Does not expose upstream credentials.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => result(() => gateway.call("GET", "/models/catalog")),
  );
  server.registerTool(
    "viora_assets_list",
    {
      description:
        "List generated/uploaded assets with authenticated /api/assets/... download URLs. Resolve these paths against the Viora site origin and send Authorization: Bearer. URLs do not grant public access.",
      inputSchema: { projectId: identifier.optional(), ...pagination },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ projectId, offset, limit }) =>
      result(async () =>
        page(
          await gateway.call<unknown[]>(
            "GET",
            projectId ? `${projectPath(projectId)}/assets` : "/assets",
          ),
          offset,
          limit,
        ),
      ),
  );
  registerCanvasTools(server, gateway);
  registerGenerationTools(server, gateway);
  registerAssetTools(server, gateway);
  registerUploadTools(server, gateway);
  registerChunkedUploadTools(server, gateway, uploads);
  return server;
}
