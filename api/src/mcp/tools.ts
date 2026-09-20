import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { registerCanvasTools } from "./canvas-tools.js";
import { identifier, pagination, result } from "./contracts.js";
import { page, projectPath, VioraGateway } from "./gateway.js";
import { registerGenerationTools } from "./generation-tools.js";
import { registerAssetTools } from "./asset-tools.js";

export function createVioraMcp(gateway: VioraGateway) {
  const server = new McpServer(
    { name: "viora-infinite-canvas", version: "1.0.0" },
    {
      instructions:
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
  return server;
}
