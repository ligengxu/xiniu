import { createOpenAI } from "@ai-sdk/openai";
import { DEFAULT_PROVIDERS } from "./model-providers";
export { DEFAULT_PROVIDERS, MODEL_PROVIDERS } from "./model-providers";
export type { ModelProvider } from "./model-providers";

function buildProviderBaseUrls(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of DEFAULT_PROVIDERS) {
    map[p.id] = p.baseUrl;
  }
  return map;
}

const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  qwen: "QWEN_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

function createThinkingDisabledFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        body.enable_thinking = false;
        init = { ...init, body: JSON.stringify(body) };
      } catch {
        // not JSON, pass through
      }
    }
    return globalThis.fetch(input, init);
  };
}

export function getModel(
  providerId: string,
  modelId: string,
  clientApiKey?: string,
  clientBaseUrl?: string
) {
  const providerUrls = buildProviderBaseUrls();
  const baseURL = clientBaseUrl || providerUrls[providerId];
  const envKey = PROVIDER_ENV_KEYS[providerId];
  const apiKey =
    clientApiKey || (envKey ? process.env[envKey] : undefined);

  if (!baseURL) {
    throw new Error(`未知的模型提供商: ${providerId}，请在设置页面添加自定义供应商并配置 Base URL`);
  }
  if (!apiKey) {
    throw new Error(
      `缺少 API Key: 请在设置页面配置「${providerId}」的 API Key，或在 .env.local 中设置 ${envKey || providerId.toUpperCase() + "_API_KEY"}`
    );
  }

  const needsThinkingOff =
    providerId === "qwen" && modelId.startsWith("qwen3");

  const provider = createOpenAI({
    baseURL,
    apiKey,
    ...(needsThinkingOff && { fetch: createThinkingDisabledFetch() }),
  });

  return provider.chat(modelId);
}
