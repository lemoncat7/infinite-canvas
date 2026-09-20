import * as z from "zod/v4";
import { ApiFailure } from "./gateway.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const identifier = z.string().min(1).max(128);
export const requestId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,128}$/)
  .describe(
    "Stable ID for one intentional request; reuse unchanged on retries, never for different inputs.",
  );
export const pagination = {
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(30),
};

export async function result(action: () => Promise<unknown>) {
  return toolResult(async () => {
    const data = await action();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data) }],
      structuredContent: { data },
    };
  });
}

export async function toolResult(
  action: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await action();
  } catch (error) {
    const failure =
      error instanceof ApiFailure
        ? {
            status: error.status,
            details:
              error.status >= 500
                ? "Service unavailable; retry with the same request ID."
                : error.details,
          }
        : {
            status: 500,
            details:
              "Operation failed; retry with the same request ID. Do not create another billable job.",
          };
    return {
      isError: true,
      content: [{ type: "text" as const, text: JSON.stringify(failure) }],
    };
  }
}
