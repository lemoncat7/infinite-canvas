import { AccountToolsFeature } from "../ui/account-tools-feature";
import { NotificationFeature } from "../ui/notification-feature";
import { AuthWorkspaceFeature } from "./auth-workspace-feature";

type AuthOptions = ConstructorParameters<typeof AuthWorkspaceFeature>[0];
type NotificationOptions = ConstructorParameters<typeof NotificationFeature>[0];
type AccountOptions = ConstructorParameters<typeof AccountToolsFeature>[0];

export class AccountSessionFeature {
  readonly auth: AuthWorkspaceFeature;
  readonly notifications: NotificationFeature;
  readonly account: AccountToolsFeature;

  constructor(options: {
    auth: Omit<AuthOptions, "loadModels" | "onUserRendered">;
    notifications: Omit<NotificationOptions, "getUserId">;
    account: Omit<
      AccountOptions,
      "getUser" | "setUser" | "closeUserMenu" | "onCreditsChanged"
    >;
  }) {
    this.auth = new AuthWorkspaceFeature({
      ...options.auth,
      loadModels: () => this.account.loadModels(),
      onUserRendered: (user) => {
        if (user) {
          void this.notifications.load();
          this.notifications.connect();
        } else this.notifications.disconnect();
      },
    });
    this.notifications = new NotificationFeature({
      ...options.notifications,
      getUserId: () => this.auth.user?.id,
    });
    this.account = new AccountToolsFeature({
      ...options.account,
      getUser: () => this.auth.user,
      setUser: (user) => this.auth.setUser(user),
      closeUserMenu: () => this.auth.userMenu.close(),
      onCreditsChanged: () => {
        this.auth.renderUser();
        options.account.refreshNodeModels();
      },
    });
  }
}
