import { randomBytes } from "node:crypto";
import { compatibleLegacyProvider } from "../models/runtime.js";
import { ModelStore } from "../models/store.js";
import { dataDirectory } from "../storage/database.js";

export const generationProvider = compatibleLegacyProvider();

export const modelStore = new ModelStore(dataDirectory);

export const generationInputSigningSecret =
  process.env.GENERATION_INPUT_SIGNING_SECRET ||
  randomBytes(32).toString("hex");

export const generationPublicBaseUrl = String(
  process.env.GENERATION_PUBLIC_BASE_URL || "",
).replace(/\/$/, "");
