import { app } from "./application.js";
import { pumpGenerationQueue } from "./generation/queue.js";

await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
pumpGenerationQueue();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
