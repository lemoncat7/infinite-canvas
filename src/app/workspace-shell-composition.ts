import type { CanvasRenderingRuntimeFeature } from "../canvas/canvas-rendering-runtime-feature";
import type { CanvasHistoryFeature } from "../canvas/canvas-history-feature";
import type { GenerationCapabilities } from "../nodes/node-types";
import type { CanvasNodeRuntimeFeature } from "../nodes/canvas-node-runtime-feature";
import { apiFetch } from "../services/api";
import type { CanvasControlsRuntime } from "../ui/canvas-controls-runtime";
import type { CanvasWorkspaceContentRuntime } from "../ui/canvas-workspace-content-runtime";
import type { AuthUser } from "../ui/user-menu-controller";
import type { AccountRuntimeComposition } from "./account-runtime-composition";
import { WorkspaceRuntimeFeature } from "./workspace-runtime-feature";

export function createWorkspaceShell(options: {
  account: AccountRuntimeComposition;
  content: CanvasWorkspaceContentRuntime;
  controls: CanvasControlsRuntime;
  nodeRuntime: CanvasNodeRuntimeFeature;
  rendering: CanvasRenderingRuntimeFeature;
  history: CanvasHistoryFeature;
  capabilities: () => GenerationCapabilities;
  applyCapabilities: (capabilities: GenerationCapabilities) => void;
}) {
  const quickMenu = options.controls.quickMenu;
  return new WorkspaceRuntimeFeature<AuthUser>({
    capabilities: {
      current: options.capabilities,
      apply: options.applyCapabilities,
      availabilityChanged: () => options.rendering.render.draw(),
    },
    bootstrap: {
      apiFetch,
      setUser: (user) => options.account.auth.setUser(user),
      user: () => options.account.auth.user,
      setReady: () => options.account.auth.markReady(),
      renderUser: () => options.account.auth.renderUser(),
      touchSession: () => options.account.auth.touch(),
      loadCapabilities: () => Promise.resolve(),
      synchronizeCanvas: () => options.account.auth.synchronize(true),
      loadAssets: () => options.content.assets.load(false),
      status: (message, visible) => options.account.auth.status(message, visible),
      randomizeTheme: options.account.auth.randomizeTheme,
      applyRoute: () => options.account.auth.applyRoute(),
      notifyError: (message) => options.account.showToast(message, "error"),
    },
    overlay: {
      quickMenu,
      closeQuickMenu: options.controls.closeQuickMenu,
      closeAssetContextIfOutside: (target) =>
        options.content.assets.closeContextIfOutside(target),
    },
    keyboard: {
      closeQuickMenu: () => {
        if (!quickMenu.classList.contains("open")) return false;
        options.controls.closeQuickMenu();
        return true;
      },
      closeNodeInfo: () => {
        const modal = document.querySelector<HTMLElement>("#node-info-modal");
        if (!modal?.classList.contains("open")) return false;
        options.nodeRuntime.editor.closeInfo();
        return true;
      },
      closeAssetPreview: () => {
        if (!options.content.assets.isPreviewOpen) return false;
        options.content.assets.closePreview();
        return true;
      },
      undo: () => { void options.history.undo(); },
      redo: () => { void options.history.redo(); },
      deleteSelected: () => { void options.nodeRuntime.lifecycle.deleteSelected(); },
    },
  });
}

export type WorkspaceShell = ReturnType<typeof createWorkspaceShell>;
