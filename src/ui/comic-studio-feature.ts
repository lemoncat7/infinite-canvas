import type { ComicPlan, PromptAgentResult } from "../nodes/comic-types";
import type { FlowNode } from "../nodes/node-types";
import { ComicSessionController } from "../services/comic-session";
import { ComicSessionState } from "../services/comic-session-state";
import type { CanvasGuideMessage } from "./canvas-guide-controller";
import { ComicDialogueController } from "./comic-dialogue-controller";
import { ComicLabelController } from "./comic-labels";
import { ComicNewSessionController } from "./comic-new-session-controller";
import { ComicOutputController } from "./comic-output-controller";
import { ComicPlanController } from "./comic-plan-controller";
import { ComicSessionRecoveryView } from "./comic-session-recovery";
import { ComicSidePanelController } from "./comic-side-panel";
import { ComicStudioView } from "./comic-studio";
import { ComicStudioInteractionController } from "./comic-studio-interaction-controller";
import { ComicStudioLifecycleController } from "./comic-studio-lifecycle-controller";
import { createComicStudioShell } from "./comic-studio-shell";

type Tone = "success" | "warning" | "error";

export class ComicStudioFeature {
  private readonly state = new ComicSessionState();
  private readonly session: ComicSessionController;
  private readonly lifecycle: ComicStudioLifecycleController;
  private resetConversation: (clearPlan?: boolean) => void = () => {};

  constructor(private readonly options: {
    nodes: FlowNode[];
    promptPanel: HTMLElement;
    getProjectId: () => string;
    getUserId: () => string | undefined;
    hasAuthenticatedContext: () => boolean;
    ensureProject: () => Promise<boolean>;
    getSelectedContexts: () => FlowNode[];
    isMultiSelect: () => boolean;
    exitMultiSelect: () => void;
    resetMarqueeGesture: () => void;
    closePromptAgent: () => void;
    applyPlan: (result: PromptAgentResult) => unknown;
    createLabel: () => FlowNode | undefined;
    persistCanvas: () => void;
    draw: () => void;
    startEmptyImages: () => void;
    showGuide: (message: CanvasGuideMessage) => unknown;
    hideGuide: (key: string) => void;
    clientLog: (event: string, data: Record<string, unknown>) => void;
    toast: (message: string, tone: Tone, detail?: string) => void;
  }) {
    const shell = createComicStudioShell();
    const studio = shell.studio;
    const briefPanel = shell.briefPanel;
    const sidePanel = new ComicSidePanelController({
      studio,
      briefPanel,
      sourcePlan: shell.sourcePlan,
      planPanel: shell.sidePlan,
      headerNav: shell.headerNav,
      getState: () => ({
        linkedLabelId: this.state.linkedLabelId,
        sessionId: this.state.sessionId,
        hasPlan: Boolean(this.state.plan),
        pendingRevision: this.state.pendingRevision,
        ready: this.state.ready,
        submitting: this.state.submitting,
      }),
      showWarning: (message) => options.toast(message, "warning"),
    });
    const view = new ComicStudioView(studio, briefPanel, () => sidePanel.position());
    const ownerKey = () => `${options.getUserId() || "anonymous"}:${options.getProjectId()}`;
    const renderPlan = (plan: ComicPlan) => view.renderPlan(plan);
    const renderBrief = () => {
      const linkedTitle = options.nodes
        .find((node) => node.id === this.state.linkedLabelId)
        ?.title.replace(/^漫剧方案\s*·\s*/, "");
      view.renderBrief({
        brief: this.state.brief,
        plan: this.state.plan,
        sessionId: this.state.sessionId,
        pendingRevision: this.state.pendingRevision,
        ready: this.state.ready,
        linkedTitle,
      });
    };
    const resetConversation = (clearPlan = true) => {
      this.state.reset(ownerKey(), clearPlan);
      renderBrief();
    };
    this.resetConversation = resetConversation;
    const labels = new ComicLabelController({
      studio,
      state: this.state,
      getLabels: () => options.nodes
        .filter((node) => node.kind === "prompt" && node.body.trim())
        .sort((a, b) => b.id - a.id),
      resetConversation,
      renderPlan,
      renderBrief,
    });
    const recovery = new ComicSessionRecoveryView({
      studio,
      state: this.state,
      ownerKey,
      setInteractionLocked: (locked) => view.setInteractionLocked(locked),
      renderBrief,
      renderPlan: (plan) => { if (plan) renderPlan(plan); },
      renderLabelState: () => labels.renderState(),
      showWarning: (message) => options.toast(message, "warning"),
    });
    this.session = new ComicSessionController({
      getProjectId: options.getProjectId,
      getOwnerKey: ownerKey,
      getTrackedSessionId: () => this.state.submitting ? this.state.sessionId : "",
      onEmpty: () => recovery.clear(),
      onSnapshot: (snapshot) => recovery.apply(snapshot),
    });
    this.lifecycle = new ComicStudioLifecycleController({
      studio,
      briefPanel,
      planPanel: shell.sidePlan,
      promptPanel: options.promptPanel,
      getOwnerKey: ownerKey,
      getStoredOwnerKey: () => this.state.ownerKey,
      setStoredOwnerKey: (owner) => { this.state.ownerKey = owner; },
      hasProject: () => Boolean(options.getProjectId()),
      hasAuthenticatedContext: options.hasAuthenticatedContext,
      ensureProject: options.ensureProject,
      resetConversation,
      invalidateSession: () => this.session.invalidate(),
      restoreSession: (force) => this.session.restore(force),
      resetMarqueeGesture: options.resetMarqueeGesture,
      isMultiSelect: options.isMultiSelect,
      exitMultiSelect: options.exitMultiSelect,
      closePromptAgent: options.closePromptAgent,
      renderLabelState: () => labels.renderState(),
      renderBrief,
    });
    const ensureProjectContext = () => this.lifecycle.ensureProjectContext();
    const context = () => {
      const selected = options.getSelectedContexts();
      const linked = options.nodes.find((node) => node.id === this.state.linkedLabelId);
      return { selected, linked };
    };
    const dialogue = new ComicDialogueController({
      studio,
      briefPanel,
      state: this.state,
      getProjectId: options.getProjectId,
      ensureProjectContext,
      getContext: () => {
        const { selected, linked } = context();
        return [
          ...(linked ? [`关联标签「${linked.title}」：${linked.body.slice(0, 5000)}`] : []),
          ...selected.map((node, index) =>
            `素材 ${index + 1}「${node.title}」：${node.generationPrompt || node.body || "视觉参考"}`),
        ];
      },
      renderBrief,
      showError: (message) => options.toast(message, "error"),
    });
    const plan = new ComicPlanController({
      studio,
      briefPanel,
      state: this.state,
      getProjectId: options.getProjectId,
      ensureProjectContext,
      getInputs: () => {
        const { selected, linked } = context();
        return {
          context: [
            ...(linked ? [`已关联故事标签「${linked.title}」：\n${linked.body}`] : []),
            ...selected.map((node, index) =>
              `素材 ${index + 1}「${node.title}」：${node.generationPrompt || node.body || "视觉参考"}`),
          ],
          visuals: selected
            .filter((node) => node.kind === "image" && node.mediaUrl)
            .map((node) => node.mediaUrl!),
        };
      },
      renderBrief,
      renderPlan,
      setInteractionLocked: (locked) => view.setInteractionLocked(locked),
      invalidateSession: () => this.session.invalidate(),
      restoreSession: () => this.session.restore(true),
      showToast: options.toast,
    });
    const output = new ComicOutputController({
      state: this.state,
      getNodes: () => options.nodes,
      prepareCanvas: () => {
        options.resetMarqueeGesture();
        if (options.isMultiSelect()) options.exitMultiSelect();
      },
      applyPlan: options.applyPlan,
      closeStudio: () => this.close(),
      onWorkflowReady: (stats) => {
        options.toast(
          `工作流已铺到画布：${stats.characterCount} 个角色、${stats.propCount} 个道具、${stats.sceneCount} 个场景、${stats.storyboardCount} 张关键帧${stats.compositeCount ? `、${stats.compositeCount} 张合成底图` : ""}`,
          "success",
        );
        window.setTimeout(() => options.showGuide({
          key: "comic-empty-images-guide",
          title: "连续分镜工作流已就绪",
          detail: `每次生图最多使用 2 张参考${stats.compositeCount ? `，${stats.compositeCount} 个复杂画面会逐层合成` : ""}；检查素材和提示词后，可点击顶栏“启动空图”。`,
          tone: "online",
          priority: 58,
          duration: 10000,
          actions: [
            { label: "知道了", run: () => options.hideGuide("comic-empty-images-guide") },
            {
              label: "启动空图",
              primary: true,
              run: () => {
                options.hideGuide("comic-empty-images-guide");
                options.startEmptyImages();
              },
            },
          ],
        }), 420);
      },
      onWorkflowError: (message, shots, nodeCount) => {
        options.toast("铺设漫剧工作流失败", "error", message);
        options.clientLog("comic_canvas_apply_failed", { message, shots, nodes: nodeCount });
      },
      createLabel: options.createLabel,
      renderLabelState: () => labels.renderState(),
      persistCanvas: options.persistCanvas,
      draw: options.draw,
      showSaved: (copy) => options.toast(
        copy ? "漫剧方案已另存为新标签" : "漫剧方案已保存并可继续修改",
        "success",
      ),
    });
    const newSession = new ComicNewSessionController({
      studio,
      state: this.state,
      closeMobilePanel: () => sidePanel.showMobile(null),
      resetConversation: () => resetConversation(true),
      renderLabelState: () => labels.renderState(),
      notify: options.toast,
    });
    new ComicStudioInteractionController({
      studio,
      briefPanel,
      planPanel: shell.sidePlan,
      headerNav: shell.headerNav,
      submitting: () => this.state.submitting,
      close: () => this.close(),
      newSession: () => newSession.start(),
      send: (message) => { void dialogue.submit(message); },
      requestPlan: () => { void plan.submit(); },
      applyCanvas: () => output.applyToCanvas(),
      saveLabel: (copy) => output.saveAsLabel(copy),
      closeMobilePanel: () => sidePanel.showMobile(null),
      renderLabelMenu: () => labels.renderMenu(),
    }).bind();
  }

  open() { this.lifecycle.open(); }
  close() { this.lifecycle.close(); }
  reset(clearPlan = true) { this.resetConversation(clearPlan); }
  unlinkLabel() { this.state.linkedLabelId = 0; }
  restoreAfterReconnect() { return this.lifecycle.restoreAfterReconnect(); }
}
