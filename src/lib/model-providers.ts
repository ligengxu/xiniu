export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: { id: string; name: string }[];
}

export const DEFAULT_PROVIDERS: ModelProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
    ],
  },
  {
    id: "qwen",
    name: "通义千问 / Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [
      { id: "qwen-plus", name: "Qwen Plus" },
      { id: "qwen-turbo", name: "Qwen Turbo" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
      { id: "openai/gpt-4o", name: "GPT-4o" },
    ],
  },
];

/** @deprecated 使用 DEFAULT_PROVIDERS 代替 */
export const MODEL_PROVIDERS = DEFAULT_PROVIDERS;
