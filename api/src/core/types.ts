export type CanvasPayload = {
  nodes: unknown[];
  links: unknown[];
  camera?: unknown;
  version?: number;
};

export type CanvasOperation = {
  type: "node" | "link" | "camera";
  action: "upsert" | "delete";
  key: string;
  value?: unknown;
};

export type JobInput = {
  projectId?: string;
  nodeId: number;
  kind: "image" | "video";
  prompt: string;
  promptProfile?:
    "character" | "prop" | "scene" | "storyboard" | "composite" | "manual";
  model?: string;
  inputUrls?: string[];
  parameters?: Record<string, unknown>;
};
