import { type FastifyInstance } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import {
  hashRechargeCode,
  normalizeRechargeCode,
  secureTextEqual,
} from "../auth/crypto.js";
import { currentUser, requireUser } from "../auth/service.js";
import { database, getOne, persist } from "../storage/database.js";

export function registerBillingRoutes(app: FastifyInstance) {
  app.post("/users/me/credits/redeem", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const code = normalizeRechargeCode(
        (request.body as { code?: string }).code,
      ),
      codeHash = hashRechargeCode(code);
    if (!code) return reply.code(400).send({ error: "请输入充值码" });
    const voucher = getOne(
      "SELECT id,credits,redeemed_by AS redeemedBy FROM recharge_codes WHERE code_hash = ?",
      [codeHash],
    );
    if (!voucher) return reply.code(404).send({ error: "充值码无效" });
    if (voucher.redeemedBy)
      return reply.code(409).send({ error: "该充值码已经使用" });
    const now = new Date().toISOString(),
      amount = Number(voucher.credits);
    database.run("BEGIN");
    try {
      database.run(
        "UPDATE recharge_codes SET redeemed_by = ?, redeemed_at = ? WHERE id = ? AND redeemed_by IS NULL",
        [String(user.id), now, String(voucher.id)],
      );
      database.run("UPDATE users SET credits = credits + ? WHERE id = ?", [
        amount,
        String(user.id),
      ]);
      database.run(
        "INSERT INTO credit_transactions (id,user_id,amount,type,reference_id,created_at) VALUES (?,?,?,?,?,?)",
        [
          randomUUID(),
          String(user.id),
          amount,
          "recharge",
          String(voucher.id),
          now,
        ],
      );
      database.run("COMMIT");
    } catch (error) {
      database.run("ROLLBACK");
      throw error;
    }
    persist();
    const updated = getOne(
      "SELECT credits,reserved_credits AS reservedCredits FROM users WHERE id = ?",
      [String(user.id)],
    );
    return {
      ok: true,
      added: amount,
      credits: Number(updated?.credits ?? 0),
      reservedCredits: Number(updated?.reservedCredits ?? 0),
    };
  });

  app.post("/admin/recharge-codes", async (request, reply) => {
    const user = currentUser(request),
      expected = String(process.env.CREDIT_ADMIN_KEY || ""),
      actual = String(request.headers["x-admin-key"] || ""),
      authorized =
        Boolean(user?.isAdmin) ||
        (Boolean(expected && actual) && secureTextEqual(actual, expected));
    if (!authorized)
      return reply.code(403).send({ error: "仅管理员可以生成充值码" });
    const body = request.body as { credits?: number; count?: number },
      credits = Math.floor(Number(body.credits)),
      count = Math.min(100, Math.max(1, Math.floor(Number(body.count || 1))));
    if (!Number.isFinite(credits) || credits < 1 || credits > 100000)
      return reply.code(400).send({ error: "点数需要在 1 到 100000 之间" });
    const now = new Date().toISOString(),
      codes: string[] = [];
    for (let index = 0; index < count; index++) {
      const code = `VIO-${credits}-${randomBytes(5).toString("hex").toUpperCase()}`;
      database.run(
        "INSERT INTO recharge_codes (id,code_hash,credits,created_at) VALUES (?,?,?,?)",
        [randomUUID(), hashRechargeCode(code), credits, now],
      );
      codes.push(code);
    }
    persist();
    return { credits, count, codes };
  });
}
