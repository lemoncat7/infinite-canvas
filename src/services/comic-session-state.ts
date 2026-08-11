import type { ComicBrief, ComicPlan } from "../nodes/comic-types";
import type { ComicSessionSnapshot } from "./comic";

export class ComicSessionState {
  plan: ComicPlan | null = null;
  submitting = false;
  originalIdea = "";
  linkedLabelId = 0;
  sessionId = "";
  ownerKey = "";
  brief: ComicBrief | null = null;
  ready = false;
  pendingRevision = "";

  reset(ownerKey: string, clearPlan = true) {
    this.sessionId = "";
    this.ownerKey = ownerKey;
    this.brief = null;
    this.ready = false;
    this.pendingRevision = "";
    if (clearPlan) this.plan = null;
  }

  clear(ownerKey: string) {
    this.submitting = false;
    this.originalIdea = "";
    this.linkedLabelId = 0;
    this.reset(ownerKey, true);
  }

  restore(snapshot: ComicSessionSnapshot) {
    this.sessionId = String(snapshot.id || "");
    this.brief = snapshot.brief || null;
    this.pendingRevision = String(snapshot.pendingRevision || "");
    this.plan = snapshot.plan || null;
    this.ready = snapshot.phase === "ready";
    this.submitting = snapshot.generationStatus === "running";
  }
}
