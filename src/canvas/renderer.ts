export type RenderNode = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  accent: string;
  kind: string;
  role?: "generator" | "result";
  title: string;
  body: string;
  status?: string;
  progress?: number;
  mediaUrl?: string;
  model?: string;
  videoSettings?: {
    seconds?: string;
    resolution?: string;
    aspectRatio?: string;
    referenceMode?: "keyframes" | "references";
  };
  voiceSettings?: {
    voiceId?: string;
    defaultSpeed?: number;
    pitch?: number;
    volume?: number;
    roleName?: string;
  };
  ttsSettings?: {
    emotion?: string;
    format?: string;
    duration?: number;
  };
};

export type RenderLink = {
  from: number;
  to: number;
  fromSide: "top" | "right" | "bottom" | "left";
  toSide: "top" | "right" | "bottom" | "left";
};

export type CanvasRenderSnapshot = {
  nodes: readonly RenderNode[];
  links: readonly RenderLink[];
  camera: { x: number; y: number; zoom: number };
  selectedId: number;
  selectedIds: readonly number[];
  dark: boolean;
  backgroundMode: "dots" | "lines" | "blank";
  hoveredLinkIndex: number;
  touchSelectedLinkIndex: number;
  pendingConnection?: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    fromSide: "top" | "right" | "bottom" | "left";
    snapped: boolean;
  };
};

export interface CanvasRenderer {
  mount(parent: HTMLElement): Promise<void>;
  render(snapshot: CanvasRenderSnapshot): void;
  suspend(): void;
  resume(): void;
  destroy(): void;
}
