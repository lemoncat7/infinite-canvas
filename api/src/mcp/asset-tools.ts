import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { identifier, toolResult } from "./contracts.js";
import { ApiFailure, type VioraGateway } from "./gateway.js";

type Asset = {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
};

export function registerAssetTools(server: McpServer, api: VioraGateway) {
  server.registerTool(
    "viora_asset_get",
    {
      description:
        "Retrieve a generated/uploaded image or video by assetId OR completed jobId. Returns a 15-minute, single-asset download URL requiring NO Authorization header, plus an inline image preview when requested. To send the file as an attachment: use your local download/shell tool to save download.url inside the CURRENT SESSION WORKING DIRECTORY, then pass that actual local path to your attachment tool. Do not ask for the MCP Bearer token. This remote server cannot write the client's disk. Never claim a local file exists before downloading it. On expiration call this tool again; never regenerate the media just to download it.",
      inputSchema: {
        assetId: identifier.optional(),
        jobId: identifier.optional(),
        preview: z
          .boolean()
          .default(true)
          .describe(
            "Include an image thumbnail. False returns metadata/download instructions only.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ assetId, jobId, preview }) =>
      toolResult(async () => {
        if (Boolean(assetId) === Boolean(jobId))
          throw new ApiFailure(400, "Provide exactly one of assetId or jobId");
        let id = assetId;
        if (jobId) {
          const job = await api.call(
            "GET",
            `/jobs/${encodeURIComponent(jobId)}`,
          );
          if (job.status !== "succeeded")
            throw new ApiFailure(409, {
              message:
                "Generation has not succeeded; query viora_generation_get for status before retrieving its result.",
              status: job.status,
            });
          const match =
            typeof job.result_url === "string" &&
            job.result_url.match(/^\/api\/assets\/([^/?#]+)\/content(?:\/|$)/);
          if (!match)
            throw new ApiFailure(
              422,
              "The job has no archived asset; use viora_generation_get to inspect its result",
            );
          try {
            id = decodeURIComponent(match[1]);
          } catch {
            throw new ApiFailure(422, "Invalid archived asset reference");
          }
        }
        const asset = await api.call<Asset>(
          "GET",
          `/assets/${encodeURIComponent(id!)}`,
        );
        const kind = asset.mimeType.startsWith("image/")
          ? "image"
          : asset.mimeType.startsWith("video/")
            ? "video"
            : "file";
        const content: CallToolResult["content"] = [];
        let previewStatus = !preview
          ? "disabled"
          : kind !== "image"
            ? "not_applicable"
            : "included";
        if (preview && kind === "image") {
          try {
            content.push(await api.imagePreview(asset.id));
          } catch (error) {
            // Preview failure must not hide a valid original file. Authorization failures still fail closed.
            if (
              error instanceof ApiFailure &&
              [401, 403, 404].includes(error.status)
            )
              throw error;
            previewStatus = "unavailable";
          }
        }
        const ticket = await api.call<{ path: string; expiresAt: string }>(
          "POST",
          `/assets/${encodeURIComponent(asset.id)}/download-ticket`,
          {},
        );
        const downloadUrl = api.downloadUrl(ticket.path);
        const suggestedFilename =
          asset.name
            .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_")
            .replace(/^[. ]+|[. ]+$/g, "")
            .slice(0, 180) || `asset-${asset.id}`;
        const data = {
          id: asset.id,
          projectId: asset.projectId,
          name: asset.name,
          kind,
          mimeType: asset.mimeType,
          size: asset.size,
          createdAt: asset.createdAt,
          download: {
            url: downloadUrl,
            path: asset.url,
            method: "GET",
            authentication:
              "None for download.url; the URL itself is a short-lived, single-file credential. download.path is the legacy authenticated path.",
            expiresAt: ticket.expiresAt,
            suggestedFilename,
            saveTo:
              "Current session working directory, using an available local file download or shell tool; avoid overwriting existing files.",
            nextStep:
              "Download the original bytes, verify completion, then provide the saved local path to the attachment/send tool. Do not send the preview as the original. Do not print the temporary URL in public channel replies.",
          },
          preview: {
            status: previewStatus,
            original: false,
            ...(previewStatus === "unavailable"
              ? {
                  message:
                    "Thumbnail unavailable; download the original file instead.",
                }
              : {}),
          },
        };
        content.unshift({ type: "text", text: JSON.stringify(data) });
        content.push({
          type: "resource_link",
          uri: downloadUrl,
          name: suggestedFilename,
          mimeType: asset.mimeType,
          size: asset.size,
          description:
            "Original file. Temporary single-asset URL; download into the current session directory before sending as an attachment.",
        });
        return { content, structuredContent: { data } };
      }),
  );
}
