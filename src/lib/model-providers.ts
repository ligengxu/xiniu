export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: { id: string; name: string }[];
}

export const DEFAULT_PROVIDERS: ModelProvider[] = [
  {
    id: "claudelocal",
    name: "Elbnt (Claude)",
    baseUrl: "http://localhost:8199/v1",
    models: [
      { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    ],
  },
  {
    id: "openaicn",
    name: "OpenAICN",
    baseUrl: "https://www.openaicn.net/v1",
    models: [
      { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      { id: "anthropic/claude-opus-4-6", name: "Claude Opus 4.6" },
      { id: "anthropic/claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5" },
    ],
  },
  {
    id: "deepsource",
    name: "DeepSource",
    baseUrl: "https://deepsource.online/v1",
    models: [
      { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
    ],
  },
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
    name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [
      { id: "qwen3.5-plus", name: "Qwen3.5 Plus" },
      { id: "qwen3-235b-a22b", name: "Qwen3 235B" },
      { id: "qwen-plus", name: "Qwen Plus" },
      { id: "qwen-turbo", name: "Qwen Turbo" },
    ],
  },
];

/** @deprecated 使用 DEFAULT_PROVIDERS 代替，保持向后兼容 */
export const MODEL_PROVIDERS = DEFAULT_PROVIDERS;
