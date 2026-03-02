import { createOpenAI } from "@ai-sdk/openai";
export { DEFAULT_PROVIDERS, MODEL_PROVIDERS } from "./model-providers";
export type { ModelProvider } from "./model-providers";

const PROVIDER_BASE_URLS: Record<string, string> = {
  claudelocal: "http://localhost:8199/v1",
  openaicn: "https://www.openaicn.net/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepsource: "https://deepsource.online/v1",
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
};

const PROVIDER_ENV_KEYS: Record<string, string> = {
  claudelocal: "CLAUDE_LOCAL_API_KEY",
  openaicn: "OPENAICN_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  deepsource: "DEEPSOURCE_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  qwen: "QWEN_API_KEY",
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
  const baseURL =
    clientBaseUrl || PROVIDER_BASE_URLS[providerId];
  const envKey = PROVIDER_ENV_KEYS[providerId];
  const apiKey =
    clientApiKey || (envKey ? process.env[envKey] : undefined);

  if (!baseURL) {
    throw new Error(`未知的模型提供商: ${providerId}，且未提供 baseUrl`);
  }
  if (!apiKey) {
    throw new Error(
      `缺少 API Key: 请在设置页面配置，或在 .env.local 中设置 ${envKey || providerId.toUpperCase() + "_API_KEY"}`
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
