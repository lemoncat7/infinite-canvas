import { apiFetch } from "./api";

export class ClientDiagnostics {
  bindGlobalErrors() {
    window.addEventListener("error", (event) => this.log("window-error", {
      message: event.message,
      file: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack,
    }));
    window.addEventListener("unhandledrejection", (event) => this.log("unhandled-rejection", {
      reason: event.reason instanceof Error
        ? { message: event.reason.message, stack: event.reason.stack }
        : String(event.reason),
    }));
  }

  log(event: string, details: unknown = {}) {
    const payload = {
      event,
      details,
      userAgent: navigator.userAgent,
      path: location.pathname,
      timestamp: new Date().toISOString(),
    };
    console.info("[client-diagnostic]", payload);
    void apiFetch("/api/client-logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }
}
