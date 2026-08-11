export type TopbarMenuKey =
  | "workspace"
  | "task"
  | "user"
  | "notifications"
  | "presence";

export class TopbarMenuCoordinator {
  private readonly closers = new Map<TopbarMenuKey, () => void>();

  register(key: TopbarMenuKey, close: () => void) {
    this.closers.set(key, close);
  }

  closeAll(except?: TopbarMenuKey) {
    for (const [key, close] of this.closers)
      if (key !== except) close();
  }
}
