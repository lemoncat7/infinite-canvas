export class WorkspaceRouteController {
  private readonly bootStatus: HTMLElement;
  private bootStatusVersion = 0;

  constructor(private readonly options: {
    homePage: HTMLElement;
    authenticated: () => boolean;
    authReady: () => boolean;
    showcaseLoaded: () => boolean;
    loadShowcase: () => Promise<unknown>;
    enterWorkspace: () => void;
    openAuth: (mode: "login" | "register") => void;
    resize: () => void;
  }) {
    this.bootStatus = document.createElement("div");
    this.bootStatus.className = "workspace-boot-status";
    this.bootStatus.innerHTML = "<i></i><span>正在检测登录状态</span>";
    document.body.append(this.bootStatus);
  }

  bind() {
    document.querySelector("#home-login")!.addEventListener("click", () => {
      if (!this.options.authenticated()) this.options.openAuth("login");
    });
    ["#home-enter", "#home-start"].forEach((selector) =>
      document.querySelector(selector)!.addEventListener("click", this.requestWorkspace),
    );
    window.addEventListener("hashchange", this.apply);
  }

  status = (message: string, visible = true) => {
    const version = ++this.bootStatusVersion;
    this.bootStatus.querySelector("span")!.textContent = message;
    this.bootStatus.classList.toggle(
      "visible",
      visible && (location.hash === "#/canvas" ||
        document.body.classList.contains("workspace-preparing")),
    );
    return version;
  };

  hideStatus = (version: number, delay: number) => {
    window.setTimeout(() => {
      if (this.bootStatusVersion === version) this.status("", false);
    }, delay);
  };

  apply = () => {
    const home = location.hash !== "#/canvas" || !this.options.authenticated();
    const wasHome = document.body.classList.contains("home-mode");
    document.body.classList.toggle("home-mode", home);
    if (home && !this.options.showcaseLoaded()) void this.options.loadShowcase();
    if (!home) requestAnimationFrame(this.options.resize);
    if (this.options.authReady() && location.hash === "#/canvas" &&
        !this.options.authenticated()) this.options.openAuth("login");
  };

  private requestWorkspace = () => {
    if (this.options.authenticated()) this.options.enterWorkspace();
    else this.options.openAuth("register");
  };

}
