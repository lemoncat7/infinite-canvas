export type PromptAgentStep = {
  title?: string;
  kind: "image" | "video" | "voice" | "tts";
  prompt: string;
  referenceIndexes?: number[];
  dependsOn?: number[];
  duration?: number;
  aspectRatio?: string;
  stage?: "character" | "voice" | "prop" | "scene" | "storyboard" | "tts" | "video";
  promptProfile?: "character" | "prop" | "scene" | "storyboard" | "composite" | "manual";
  styleConstraint?: string;
  formConstraint?: string;
  continuityConstraint?: string;
  crowdConstraint?: "required" | "forbidden";
  autoGenerate?: boolean;
  roleName?: string;
  voiceProfile?: string;
  voiceId?: string;
  voiceSpeed?: number;
  voicePitch?: number;
  voiceVolume?: number;
};

export type PromptAgentResult = {
  model: string;
  kind: "image" | "video";
  subject: string;
  scene: string;
  composition: string;
  lighting: string;
  style: string;
  motion: string;
  negativePrompt: string;
  finalPrompt: string;
  action?: "update_current" | "create_child" | "create_new";
  targetType?: "image" | "video";
  summary?: string;
  shouldGenerate?: boolean;
  layout?: "workflow" | "storyboard" | "comic-workflow";
  steps?: PromptAgentStep[];
  voiceConfig?: {
    roleName?: string;
    voiceId?: string;
    tone?: string;
    speed?: number;
    pitch?: number;
    volume?: number;
  };
};

export type ComicCharacterForm = {
  name: string;
  description: string;
  imagePrompt?: string;
};

export type ComicFrame = {
  title: string;
  imagePrompt: string;
  keyframe?: "start" | "middle" | "end";
  inherit?: string;
  change?: string;
  lock?: string;
  characterIndexes?: number[];
  characterForms?: Array<{ characterIndex: number; form: string }>;
  propIndexes?: number[];
};

export type ComicShot = {
  number: number;
  title: string;
  duration: number;
  storyBeat?: string;
  action?: string;
  scene: string;
  sceneId?: string;
  sceneView?: "main" | "reverse" | "left" | "right" | "top";
  scenePrompt?: string;
  characterIndexes?: number[];
  characterForms?: Array<{ characterIndex: number; form: string }>;
  propIndexes?: number[];
  hasAnonymousCrowd?: boolean;
  crowdPrompt?: string;
  dialogue: string;
  frames?: ComicFrame[];
  imagePrompt: string;
  videoPrompt: string;
  referenceIndexes: number[];
  transition?: string;
  continuity?: string;
};

export type ComicScene = {
  sceneId: string;
  baseSceneId?: string;
  variantType?: "base" | "area" | "state" | "time";
  name: string;
  description: string;
  imagePrompt?: string;
  propIndexes?: number[];
  environmentAnchors?: string[];
  views?: Array<{
    id: "main" | "reverse" | "left" | "right" | "top";
    name: string;
    imagePrompt?: string;
  }>;
};

export type ComicPlan = {
  title: string;
  logline: string;
  tone: string;
  duration: string;
  aspectRatio: string;
  characters: Array<{
    name: string;
    description: string;
    voiceProfile?: string;
    visualAsset?: boolean;
    imagePrompt?: string;
    forms?: ComicCharacterForm[];
  }>;
  props?: Array<{ name: string; description: string; imagePrompt?: string }>;
  scenes?: ComicScene[];
  outline: Array<{ act: string; content: string }>;
  shots: ComicShot[];
  changeSummary?: string;
  model?: string;
};

export type ComicBrief = {
  title?: string;
  premise?: string;
  genre?: string;
  audience?: string;
  duration?: string;
  aspectRatio?: string;
  visualStyle?: string;
  characters?: string;
  conflict?: string;
  ending?: string;
  dialogue?: string;
  constraints?: string[];
  confirmed?: string[];
  openQuestions?: string[];
};

export type PromptAgentMode = "create" | "general" | "agnes" | "voice";
