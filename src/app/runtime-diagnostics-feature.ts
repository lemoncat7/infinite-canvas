import { ClientDiagnostics } from "../services/client-diagnostics";

export class RuntimeDiagnosticsFeature {
  private readonly diagnostics = new ClientDiagnostics();

  constructor() {
    this.diagnostics.bindGlobalErrors();
    const interrupted = sessionStorage.getItem("flow-theme-transition-inflight");
    if (!interrupted) return;
    sessionStorage.removeItem("flow-theme-transition-inflight");
    try {
      this.log("theme-transition-interrupted", JSON.parse(interrupted));
    } catch {
      this.log("theme-transition-interrupted", { raw: interrupted });
    }
  }

  log = (event: string, details: unknown = {}) =>
    this.diagnostics.log(event, details);
}
