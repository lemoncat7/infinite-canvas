import { apiFetch } from "./api";

export class AppUpdateController {
  private readonly initialAssets = assetFingerprint(document);
  private noticeShown = false;

  constructor(
    private readonly deps: {
      authenticated: () => boolean;
      refreshCapabilities: () => Promise<unknown>;
      showNotice: (actions: {
        dismiss: () => void;
        reload: () => void;
      }) => boolean;
      hideNotice: () => void;
    },
  ) {}

  start() {
    window.setTimeout(() => {
      this.runMaintenance();
      window.setInterval(() => this.runMaintenance(), 30_000);
    }, 20_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.check();
    });
  }

  checkNow() {
    return this.check();
  }

  private runMaintenance() {
    if (document.hidden || !this.deps.authenticated()) return;
    void Promise.all([this.check(), this.deps.refreshCapabilities()]);
  }

  private async check() {
    if (
      this.noticeShown ||
      !this.initialAssets ||
      document.visibilityState === "hidden"
    )
      return;
    try {
      const response = await apiFetch(`/?app-version=${Date.now()}`, {
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      });
      if (!response.ok) return;
      const nextDocument = new DOMParser().parseFromString(
        await response.text(),
        "text/html",
      );
      const nextAssets = assetFingerprint(nextDocument);
      if (!nextAssets || nextAssets === this.initialAssets) return;
      this.noticeShown = this.deps.showNotice({
        dismiss: this.deps.hideNotice,
        reload: () => location.reload(),
      });
    } catch {
      // Deployment can briefly reset the connection.
    }
  }
}

function assetFingerprint(root: Document) {
  return [
    ...root.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
      'script[type="module"][src],link[rel="stylesheet"][href]',
    ),
  ]
    .map((element) =>
      element.getAttribute(
        element instanceof HTMLScriptElement ? "src" : "href",
      ) || "",
    )
    .filter(Boolean)
    .sort()
    .join("|");
}
