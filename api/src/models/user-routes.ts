import { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { requireUser } from "../auth/service.js";
import { normalizeHttpUrl } from "../auth/validation.js";
import { database, getAll, persist } from "../storage/database.js";

export function registerModelsUserRoutes(app: FastifyInstance) {
  app.get("/user-api-models", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    return getAll(
      "SELECT id, kind, name, model, base_url AS baseUrl, CASE WHEN proxy_url IS NULL OR proxy_url = ? THEN 0 ELSE 1 END AS hasProxy, created_at AS createdAt, updated_at AS updatedAt FROM user_api_models WHERE user_id = ? ORDER BY created_at ASC",
      ["", String(user.id)],
    ).map((item) => ({
      ...item,
      hasProxy: Boolean(item.hasProxy),
      hasKey: true,
    }));
  });

  app.post("/user-api-models", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = request.body as {
        kind?: string;
        name?: string;
        model?: string;
        baseUrl?: string;
        apiKey?: string;
        proxyUrl?: string;
      },
      kind = String(body.kind ?? ""),
      name = String(body.name ?? "").trim(),
      model = String(body.model ?? "").trim(),
      baseUrl = normalizeHttpUrl(body.baseUrl),
      apiKey = String(body.apiKey ?? "").trim(),
      proxyUrl = String(body.proxyUrl ?? "").trim();
    if (!["image", "video"].includes(kind))
      return reply.code(400).send({ error: "请选择图像或视频类型" });
    if (
      !name ||
      name.length > 60 ||
      !model ||
      model.length > 120 ||
      !baseUrl ||
      !apiKey
    )
      return reply
        .code(400)
        .send({ error: "请完整填写名称、模型、接口地址和密钥" });
    if (proxyUrl && !normalizeHttpUrl(proxyUrl))
      return reply.code(400).send({ error: "代理地址无效" });
    const id = randomUUID(),
      now = new Date().toISOString();
    database.run(
      "INSERT INTO user_api_models (id,user_id,kind,name,model,base_url,api_key,proxy_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        String(user.id),
        kind,
        name,
        model,
        baseUrl,
        apiKey,
        proxyUrl,
        now,
        now,
      ],
    );
    persist();
    return reply.code(201).send({
      id,
      kind,
      name,
      model,
      baseUrl,
      hasKey: true,
      hasProxy: Boolean(proxyUrl),
      createdAt: now,
      updatedAt: now,
    });
  });

  app.delete("/user-api-models/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    database.run("DELETE FROM user_api_models WHERE id = ? AND user_id = ?", [
      id,
      String(user.id),
    ]);
    persist();
    return reply.code(204).send();
  });

  app.post("/user-api-models/test", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = request.body as { baseUrl?: string; apiKey?: string };
    const baseUrl = normalizeHttpUrl(body.baseUrl),
      apiKey = String(body.apiKey ?? "").trim();
    if (!baseUrl || !apiKey)
      return reply.code(400).send({ error: "请填写接口地址和密钥" });
    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok)
        return reply.code(400).send({ error: `接口返回 ${response.status}` });
      return { ok: true };
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "连接失败" });
    }
  });
}
