import type { CanvasPersistenceRuntimeFeature } from "../canvas/canvas-persistence-runtime-feature";
import type { CanvasRenderingRuntimeFeature } from "../canvas/canvas-rendering-runtime-feature";
import { decodePromptClipboardText, normalizePromptText } from "../nodes/prompt-text";
import { apiFetch } from "../services/api";
import { AppUpdateController } from "../services/app-update-controller";
import type { CanvasWorkspaceContentRuntime } from "../ui/canvas-workspace-content-runtime";
import { CanvasFeedbackFeature } from "../ui/canvas-feedback-feature";
import type { CanvasGuideMessage } from "../ui/canvas-guide-controller";
import type { ToastType } from "../ui/toast-controller";
import type { AuthUser } from "../ui/user-menu-controller";
import { AccountSessionFeature } from "./account-session-feature";
import { escapeRuntimeHtml, type RuntimeFoundation } from "./runtime-foundation";

type Menu = "workspace" | "task" | "user" | "notifications" | "presence";

export class AccountRuntimeComposition {
  readonly session: AccountSessionFeature;
  readonly feedback = new CanvasFeedbackFeature({
    escapeHtml: escapeRuntimeHtml,
    normalizePrompt: normalizePromptText,
    decodePrompt: decodePromptClipboardText,
  });
  readonly updates: AppUpdateController;
  readonly refreshNodeModels: () => void;

  constructor(options: {
    foundation: RuntimeFoundation;
    persistence: () => CanvasPersistenceRuntimeFeature;
    rendering: () => CanvasRenderingRuntimeFeature;
    content: () => CanvasWorkspaceContentRuntime;
    resize: () => void;
    loadCapabilities: (redraw?: boolean) => Promise<unknown>;
    registerMenu: (menu: Menu, close: () => void) => void;
    closeMenus: (except?: Menu) => void;
  }) {
    const { foundation } = options;
    const { nodes, links, selection, nodeIds } = foundation;
    this.refreshNodeModels = () => {
      foundation.dom.nodeLayer
        .querySelectorAll(".flow-node")
        .forEach((element) => element.remove());
      options.rendering().render.draw();
    };
    this.updates = new AppUpdateController({
      authenticated: () => Boolean(this.session.auth.user),
      refreshCapabilities: () => options.loadCapabilities(true),
      showNotice: ({ dismiss, reload }) => this.showGuide({
        key: "app-update",
        title: "检测到服务器版本更新",
        detail: "刷新页面后即可使用最新版本。",
        priority: 80,
        actions: [
          { label: "稍后", run: dismiss },
          { label: "刷新生效", primary: true, run: reload },
        ],
      }),
      hideNotice: () => this.hideGuide("app-update"),
    });
    this.session = new AccountSessionFeature({
      auth: {
        nodes,
        links,
        getProjectId: () => foundation.projectId,
        setProjectId: (id) => { foundation.projectId = id; },
        getLoadedProjectId: () => options.persistence().loadedProjectId,
        isSaveBlocked: () => options.persistence().blocked,
        getServerVersion: () => options.persistence().serverVersion,
        ensureRenderer: () => options.rendering().render.ensure(),
        stopSave: (logout) => options.persistence().stopAndReset(logout),
        resetNodeLease: () => nodeIds.reset(),
        loadCanvas: (keepStatus) => options.persistence().load(keepStatus),
        loadAssets: () => options.content().assets.load(false),
        apiFetch,
        resize: options.resize,
        clearSelection: () => { selection.selectedId = 0; },
        registerUserMenu: (close) => options.registerMenu("user", close),
        closeTopbarMenus: (opening) => options.closeMenus(opening ? "user" : undefined),
        notify: (message, type, detail) => this.showToast(message, type, detail),
      },
      notifications: {
        registerTopbarMenu: (close) => options.registerMenu("notifications", close),
        closeNotificationMenus: (opening) =>
          options.closeMenus(opening ? "notifications" : undefined),
        closePresenceMenus: (opening) =>
          options.closeMenus(opening ? "presence" : undefined),
        showGuide: this.showGuide,
        hideGuide: this.hideGuide,
        isGuideVisible: (key) => this.feedback.isGuideVisible(key),
        checkAppUpdate: () => void this.updates.checkNow(),
        restoreAfterReconnect: () =>
          void options.content().creation.comic.restoreAfterReconnect(),
        toast: (message, type) => this.showToast(message, type),
      },
      account: {
        getProjectId: () => foundation.projectId,
        refreshNodeModels: this.refreshNodeModels,
        toast: (message, type) => this.showToast(message, type),
      },
    });
    this.updates.start();
  }

  get auth() { return this.session.auth; }
  get account() { return this.session.account; }

  showToast = (message: string, type: ToastType = "error", detail = "") =>
    this.feedback.showToast(message, type, detail);
  copyPrompt = (prompt?: string) => this.feedback.copyOriginalPrompt(prompt);
  hideGuide = (key?: string) => this.feedback.hideGuide(key);
  showGuide = (message: CanvasGuideMessage) => this.feedback.showGuide(message);
  showModeNotice = (title: string, detail: string) =>
    this.feedback.showModeNotice(title, detail);
}

export type RuntimeAuthUser = AuthUser;
