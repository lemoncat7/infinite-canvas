import { registerAgentsPromptRoutes } from "./agents/prompt-routes.js";
import { registerAssetsExportRoutes } from "./assets/export-routes.js";
import { registerAssetsRoutes } from "./assets/routes.js";
import { registerAssetsShowcaseRoutes } from "./assets/showcase-routes.js";
import { registerAssetsSignedRoutes } from "./assets/signed-routes.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { requireAdmin, requireUser } from "./auth/service.js";
import { registerBillingRoutes } from "./billing/routes.js";
import { registerCanvasLegacyRoutes } from "./canvas/legacy-routes.js";
import { registerCanvasResetRoutes } from "./canvas/reset-routes.js";
import { registerCanvasRoutes } from "./canvas/routes.js";
import { registerCanvasSyncRoutes } from "./canvas/sync-routes.js";
import { registerComicChatRoutes } from "./comic/chat-routes.js";
import { registerComicGenerationRoutes } from "./comic/generation-routes.js";
import { registerComicSessionRoutes } from "./comic/session-routes.js";
import { configureLogger } from "./core/logging.js";
import { recoverApplication } from "./core/recovery.js";
import { modelStore } from "./generation/config.js";
import {
  startFallbackProbe,
  stopFallbackProbe,
} from "./generation/fallback.js";
import { stopGenerationQueue } from "./generation/queue.js";
import { closeNotificationStreams } from "./notifications/service.js";
import { registerGenerationRoutes } from "./generation/routes.js";
import { app } from "./http/app.js";
import { registerAssetDownloadRoutes } from "./assets/download-routes.js";
import { registerHttpDiagnosticRoutes } from "./http/diagnostic-routes.js";
import { registerHttpStatusRoutes } from "./http/status-routes.js";
import { registerMcpRoutes } from "./mcp/routes.js";
import { registerModelRoutes } from "./models/routes.js";
import { registerModelsUserRoutes } from "./models/user-routes.js";
import { registerNotificationsAdminRoutes } from "./notifications/admin-routes.js";
import { registerNotificationsFeedbackRoutes } from "./notifications/feedback-routes.js";
import { registerNotificationsRoutes } from "./notifications/routes.js";
import { registerProjectsRoutes } from "./projects/routes.js";
import { registerSpeechRoutes } from "./speech/routes.js";
import { database, persist } from "./storage/database.js";

configureLogger(app.log);
recoverApplication();
startFallbackProbe();
registerModelRoutes(app, modelStore, {
  user: requireUser,
  admin: requireAdmin,
});
registerHttpStatusRoutes(app);
registerSpeechRoutes(app);
registerAgentsPromptRoutes(app);
registerComicChatRoutes(app);
registerComicGenerationRoutes(app);
registerComicSessionRoutes(app);
registerModelsUserRoutes(app);
registerNotificationsFeedbackRoutes(app);
registerNotificationsRoutes(app);
registerAssetsExportRoutes(app);
registerNotificationsAdminRoutes(app);
registerAssetsSignedRoutes(app);
registerHttpDiagnosticRoutes(app);
registerAuthRoutes(app);
registerBillingRoutes(app);
registerAssetsShowcaseRoutes(app);
registerProjectsRoutes(app);
registerCanvasRoutes(app);
registerCanvasResetRoutes(app);
registerCanvasSyncRoutes(app);
registerAssetsRoutes(app);
registerCanvasLegacyRoutes(app);
registerGenerationRoutes(app);
registerMcpRoutes(app);
registerAssetDownloadRoutes(app);

app.addHook("preClose", async () => {
  closeNotificationStreams();
});
app.addHook("onClose", async () => {
  stopFallbackProbe();
  await stopGenerationQueue();
  persist();
  database.close();
});
export { app };
