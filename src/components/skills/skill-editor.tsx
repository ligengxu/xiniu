"use client";

import { useState, useRef, useCallback } from "react";
import {
  Sparkles, Save, Plus, Trash2, Loader2, Eye, Code, ChevronDown,
  Wand2, GripVertical, AlertCircle, CheckCircle, Zap, Settings2,
  Layers, FileCode, Box, Type, Hash, ToggleLeft,
} from "lucide-react";
import type { SkillConfig } from "@/skills/schema";

interface SkillEditorProps {
  initial?: Partial<SkillConfig>;
  onSave: (config: SkillConfig) => Promise<void>;
}

const EMPTY_SKILL: Partial<SkillConfig> = {
  name: "",
  displayName: "",
  description: "",
  icon: "Wrench",
  category: "life",
  version: "1.0.0",
  parameters: [],
  execution: { type: "prompt", prompt: "" },
};

const ICONS = [
  "Wrench", "Languages", "Globe", "FileText", "Terminal", "Search",
  "BookOpen", "Calculator", "Code", "Sparkles", "Zap", "Brain",
  "MessageSquare", "Mail", "Clock", "Star", "Shield", "Database",
  "Cloud", "Cpu", "HardDrive", "Wifi", "Camera", "Music",
];

const CATEGORIES: { value: string; label: string; color: string }[] = [
  { value: "office", label: "办公", color: "#3b82f6" },
  { value: "dev", label: "开发", color: "#10b981" },
  { value: "life", label: "生活", color: "#f59e0b" },
  { value: "creative", label: "创意", color: "#8b5cf6" },
];

const PARAM_TYPES: { value: string; label: string; icon: typeof Type }[] = [
  { value: "string", label: "文本", icon: Type },
  { value: "number", label: "数字", icon: Hash },
  { value: "boolean", label: "布尔", icon: ToggleLeft },
];

const EXEC_TYPES = [
  { value: "prompt", label: "Prompt 模板", desc: "使用 AI 模型处理", icon: Sparkles },
  { value: "compose", label: "组合技能", desc: "串行调用多个工具", icon: Layers },
  { value: "code", label: "代码执行", desc: "运行 Node.js 代码", icon: FileCode },
];

export function SkillEditor({ initial, onSave }: SkillEditorProps) {
  const [config, setConfig] = useState<Partial<SkillConfig>>({ ...EMPTY_SKILL, ...initial });
  const [aiPrompt, setAiPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [viewMode, setViewMode] = useState<"form" | "json">("form");
  const [jsonText, setJsonText] = useState("");
  const [activeSection, setActiveSection] = useState<string>("basic");
  const aiInputRef = useRef<HTMLInputElement>(null);

  const execType = config.execution?.type || "prompt";

  const updateField = useCallback(<K extends keyof SkillConfig>(key: K, value: SkillConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setError("");
    setSuccess("");
  }, []);

  function updateParam(idx: number, field: string, value: unknown) {
    const params = [...(config.parameters || [])];
    params[idx] = { ...params[idx], [field]: value };
    setConfig((prev) => ({ ...prev, parameters: params }));
  }

  function addParam() {
    const params = [...(config.parameters || [])];
    params.push({ name: "", type: "string", description: "", required: true });
    setConfig((prev) => ({ ...prev, parameters: params }));
  }

  function removeParam(idx: number) {
    const params = [...(config.parameters || [])];
    params.splice(idx, 1);
    setConfig((prev) => ({ ...prev, parameters: params }));
  }

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return;
    setGenerating(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: aiPrompt }),
      });
      const data = await res.json();
      if (data.success && data.skill) {
        setConfig(data.skill);
        setJsonText(JSON.stringify(data.skill, null, 2));
        setSuccess("AI 已生成技能配置，请检查并调整后保存");
      } else {
        setError(data.message || "AI 生成失败");
      }
    } catch (err) {
      setError(`生成失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    let toSave = config;
    if (viewMode === "json") {
      try {
        toSave = JSON.parse(jsonText);
        setConfig(toSave);
      } catch {
        setError("JSON 格式错误，请检查语法");
        return;
      }
    }

    if (!toSave.name || !toSave.displayName || !toSave.description) {
      setError("请填写技能标识符、显示名称和描述");
      return;
    }

    if (toSave.execution?.type === "prompt" && !toSave.execution.prompt) {
      setError("请填写 Prompt 模板内容");
      return;
    }

    if (toSave.execution?.type === "code" && !("code" in toSave.execution && toSave.execution.code)) {
      setError("请填写代码内容");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await onSave(toSave as SkillConfig);
      setSuccess("技能保存成功！");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function switchToJsonView() {
    setJsonText(JSON.stringify(config, null, 2));
    setViewMode("json");
  }

  const paramCount = config.parameters?.length || 0;
  const isValid = !!(config.name && config.displayName && config.description);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* AI Generate Hero */}
      <div className="relative overflow-hidden rounded-2xl border" style={{
        borderColor: "color-mix(in srgb, #8b5cf6 25%, var(--border))",
        background: "linear-gradient(135deg, color-mix(in srgb, #8b5cf6 8%, var(--surface)) 0%, color-mix(in srgb, #6366f1 5%, var(--surface)) 100%)",
      }}>
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: "radial-gradient(circle at 20% 50%, #8b5cf6 0%, transparent 50%), radial-gradient(circle at 80% 20%, #6366f1 0%, transparent 50%)",
        }} />
        <div className="relative p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg" style={{ background: "color-mix(in srgb, #8b5cf6 15%, transparent)" }}>
              <Wand2 className="h-4 w-4" style={{ color: "#a78bfa" }} />
            </div>
            <h3 className="text-sm font-bold" style={{ color: "#a78bfa" }}>
              AI 智能生成
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{
              background: "color-mix(in srgb, #8b5cf6 12%, transparent)",
              color: "#c4b5fd",
            }}>
              推荐
            </span>
          </div>
          <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
            描述你想要的技能，AI 将自动生成完整配置
          </p>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                ref={aiInputRef}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="例如：将中文翻译成多国语言、生成随机密码、批量重命名文件..."
                className="w-full px-4 py-2.5 rounded-xl border text-xs outline-none transition-all focus:ring-2"
                style={{
                  borderColor: "color-mix(in srgb, #8b5cf6 20%, var(--border))",
                  background: "color-mix(in srgb, var(--background) 60%, var(--surface))",
                  color: "var(--text-primary)",
                  // @ts-expect-error CSS custom property
                  "--tw-ring-color": "#8b5cf680",
                }}
                onKeyDown={(e) => e.key === "Enter" && handleAiGenerate()}
              />
              {generating && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="h-4 w-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#8b5cf6", borderTopColor: "transparent" }} />
                </div>
              )}
            </div>
            <button
              onClick={handleAiGenerate}
              disabled={generating || !aiPrompt.trim()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-30 disabled:hover:scale-100"
              style={{
                background: "linear-gradient(135deg, #8b5cf6, #6366f1)",
                color: "white",
                boxShadow: "0 4px 12px -2px #8b5cf640",
              }}
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {generating ? "生成中" : "生成"}
            </button>
          </div>
        </div>
      </div>

      {/* Status Messages */}
      {success && (
        <div className="flex items-center gap-2 p-3 rounded-xl text-xs animate-fade-in" style={{
          background: "color-mix(in srgb, #10b981 8%, var(--surface))",
          border: "1px solid color-mix(in srgb, #10b981 20%, var(--border))",
          color: "#34d399",
        }}>
          <CheckCircle className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl text-xs animate-fade-in" style={{
          background: "color-mix(in srgb, var(--error) 8%, var(--surface))",
          border: "1px solid color-mix(in srgb, var(--error) 20%, var(--border))",
          color: "var(--error)",
        }}>
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* View Mode Toggle */}
      <div className="flex items-center gap-1 p-1 rounded-xl w-fit" style={{ background: "var(--surface-elevated)" }}>
        <button
          onClick={() => setViewMode("form")}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all"
          style={{
            background: viewMode === "form" ? "var(--accent)" : "transparent",
            color: viewMode === "form" ? "white" : "var(--text-muted)",
            boxShadow: viewMode === "form" ? "0 2px 8px -2px var(--accent)" : "none",
          }}
        >
          <Eye className="h-3.5 w-3.5" /> 可视化编辑
        </button>
        <button
          onClick={switchToJsonView}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all"
          style={{
            background: viewMode === "json" ? "var(--accent)" : "transparent",
            color: viewMode === "json" ? "white" : "var(--text-muted)",
            boxShadow: viewMode === "json" ? "0 2px 8px -2px var(--accent)" : "none",
          }}
        >
          <Code className="h-3.5 w-3.5" /> JSON 源码
        </button>
      </div>

      {viewMode === "form" ? (
        <div className="space-y-4">
          {/* Section: Basic Info */}
          <SectionCard
            title="基本信息"
            icon={<Box className="h-4 w-4" />}
            isActive={activeSection === "basic"}
            onToggle={() => setActiveSection(activeSection === "basic" ? "" : "basic")}
            badge={isValid ? <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "color-mix(in srgb, #10b981 15%, transparent)", color: "#34d399" }}>完整</span> : undefined}
          >
            <div className="grid grid-cols-2 gap-4">
              <FormField label="技能标识符" hint="小写字母+数字+下划线" required>
                <input
                  value={config.name || ""}
                  onChange={(e) => updateField("name", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  placeholder="my_skill"
                  className="form-input"
                  style={fieldStyle}
                />
              </FormField>
              <FormField label="显示名称" required>
                <input
                  value={config.displayName || ""}
                  onChange={(e) => updateField("displayName", e.target.value)}
                  placeholder="我的技能"
                  className="form-input"
                  style={fieldStyle}
                />
              </FormField>
            </div>

            <FormField label="功能描述" hint="供 AI 理解何时调用此技能" required>
              <textarea
                value={config.description || ""}
                onChange={(e) => updateField("description", e.target.value)}
                placeholder="详细描述技能的功能和使用场景..."
                rows={2}
                className="form-input resize-none"
                style={fieldStyle}
              />
            </FormField>

            <div className="grid grid-cols-3 gap-3">
              <FormField label="图标">
                <div className="relative">
                  <select
                    value={config.icon || "Wrench"}
                    onChange={(e) => updateField("icon", e.target.value)}
                    className="form-input appearance-none pr-8"
                    style={fieldStyle}
                  >
                    {ICONS.map((ic) => (
                      <option key={ic} value={ic}>{ic}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: "var(--text-muted)" }} />
                </div>
              </FormField>
              <FormField label="分类">
                <div className="flex gap-1.5">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat.value}
                      onClick={() => updateField("category", cat.value as SkillConfig["category"])}
                      className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all text-center"
                      style={{
                        background: config.category === cat.value
                          ? `color-mix(in srgb, ${cat.color} 15%, transparent)`
                          : "var(--surface-elevated)",
                        color: config.category === cat.value ? cat.color : "var(--text-muted)",
                        border: `1px solid ${config.category === cat.value ? `color-mix(in srgb, ${cat.color} 30%, transparent)` : "transparent"}`,
                      }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </FormField>
              <FormField label="版本">
                <input
                  value={config.version || "1.0.0"}
                  onChange={(e) => updateField("version", e.target.value)}
                  className="form-input"
                  style={fieldStyle}
                />
              </FormField>
            </div>
          </SectionCard>

          {/* Section: Parameters */}
          <SectionCard
            title="参数定义"
            icon={<Settings2 className="h-4 w-4" />}
            isActive={activeSection === "params"}
            onToggle={() => setActiveSection(activeSection === "params" ? "" : "params")}
            badge={
              <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{
                background: paramCount > 0 ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "var(--surface-elevated)",
                color: paramCount > 0 ? "var(--accent)" : "var(--text-muted)",
              }}>
                {paramCount} 个
              </span>
            }
            action={
              <button
                onClick={(e) => { e.stopPropagation(); addParam(); setActiveSection("params"); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all hover:scale-[1.02]"
                style={{
                  color: "var(--accent)",
                  background: "color-mix(in srgb, var(--accent) 8%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--accent) 15%, transparent)",
                }}
              >
                <Plus className="h-3 w-3" /> 添加
              </button>
            }
          >
            {paramCount === 0 ? (
              <div className="text-center py-6">
                <div className="inline-flex p-3 rounded-2xl mb-3" style={{ background: "var(--surface-elevated)" }}>
                  <Settings2 className="h-6 w-6" style={{ color: "var(--text-muted)" }} />
                </div>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  暂无参数，点击上方"添加"按钮定义输入参数
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {(config.parameters || []).map((param, idx) => (
                  <div
                    key={idx}
                    className="group flex items-start gap-2 p-3 rounded-xl border transition-all hover:border-opacity-60"
                    style={{
                      background: "color-mix(in srgb, var(--surface-elevated) 60%, transparent)",
                      borderColor: "var(--border)",
                    }}
                  >
                    <div className="pt-1.5 cursor-grab opacity-0 group-hover:opacity-40 transition-opacity">
                      <GripVertical className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />
                    </div>
                    <div className="flex-1 grid grid-cols-[1fr_auto_2fr] gap-2 items-center">
                      <input
                        value={param.name}
                        onChange={(e) => updateParam(idx, "name", e.target.value)}
                        placeholder="参数名"
                        className="form-input text-[11px]"
                        style={fieldStyle}
                      />
                      <div className="flex gap-1">
                        {PARAM_TYPES.map((pt) => {
                          const PIcon = pt.icon;
                          return (
                            <button
                              key={pt.value}
                              onClick={() => updateParam(idx, "type", pt.value)}
                              className="p-1.5 rounded-md transition-all"
                              title={pt.label}
                              style={{
                                background: param.type === pt.value
                                  ? "color-mix(in srgb, var(--accent) 15%, transparent)"
                                  : "transparent",
                                color: param.type === pt.value ? "var(--accent)" : "var(--text-muted)",
                              }}
                            >
                              <PIcon className="h-3.5 w-3.5" />
                            </button>
                          );
                        })}
                      </div>
                      <input
                        value={param.description}
                        onChange={(e) => updateParam(idx, "description", e.target.value)}
                        placeholder="参数描述"
                        className="form-input text-[11px]"
                        style={fieldStyle}
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <div
                          className="relative w-7 h-4 rounded-full transition-colors cursor-pointer"
                          style={{
                            background: param.required !== false
                              ? "var(--accent)"
                              : "var(--surface-hover)",
                          }}
                          onClick={() => updateParam(idx, "required", !(param.required !== false))}
                        >
                          <div
                            className="absolute top-0.5 w-3 h-3 rounded-full transition-transform"
                            style={{
                              background: "white",
                              transform: param.required !== false ? "translateX(14px)" : "translateX(2px)",
                            }}
                          />
                        </div>
                        <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>必填</span>
                      </label>
                      <button
                        onClick={() => removeParam(idx)}
                        className="p-1 rounded-md transition-all opacity-0 group-hover:opacity-100 hover:bg-red-500/10"
                        style={{ color: "var(--error)" }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Section: Execution */}
          <SectionCard
            title="执行配置"
            icon={<Zap className="h-4 w-4" />}
            isActive={activeSection === "exec"}
            onToggle={() => setActiveSection(activeSection === "exec" ? "" : "exec")}
            badge={
              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{
                background: "color-mix(in srgb, #f59e0b 12%, transparent)",
                color: "#fbbf24",
              }}>
                {EXEC_TYPES.find(e => e.value === execType)?.label || "Prompt"}
              </span>
            }
          >
            <div className="grid grid-cols-3 gap-2 mb-4">
              {EXEC_TYPES.map((et) => {
                const EIcon = et.icon;
                return (
                  <button
                    key={et.value}
                    onClick={() => {
                      if (et.value === "prompt") {
                        updateField("execution", { type: "prompt", prompt: "" });
                      } else if (et.value === "compose") {
                        updateField("execution", { type: "compose", steps: [] });
                      } else {
                        updateField("execution", {
                          type: "code",
                          code: 'async function execute(params) {\n  // 在这里编写逻辑\n  return { success: true, message: "执行完成" };\n}',
                          runtime: "node",
                          dependencies: [],
                          timeout: 30000,
                        } as SkillConfig["execution"]);
                      }
                    }}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all hover:scale-[1.01]"
                    style={{
                      background: execType === et.value
                        ? "color-mix(in srgb, var(--accent) 8%, var(--surface))"
                        : "var(--surface-elevated)",
                      borderColor: execType === et.value
                        ? "color-mix(in srgb, var(--accent) 30%, var(--border))"
                        : "transparent",
                      color: execType === et.value ? "var(--accent)" : "var(--text-muted)",
                    }}
                  >
                    <EIcon className="h-5 w-5" />
                    <span className="text-[11px] font-semibold">{et.label}</span>
                    <span className="text-[9px] opacity-60">{et.desc}</span>
                  </button>
                );
              })}
            </div>

            {execType === "prompt" && config.execution?.type === "prompt" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-medium" style={{ color: "var(--text-secondary)" }}>
                    Prompt 模板
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded" style={{
                    background: "var(--surface-elevated)",
                    color: "var(--text-muted)",
                  }}>
                    {"使用 {{参数名}} 引用"}
                  </span>
                </div>
                <textarea
                  value={config.execution.prompt}
                  onChange={(e) => updateField("execution", { type: "prompt", prompt: e.target.value })}
                  placeholder={"请将以下文本翻译为{{targetLang}}:\n\n{{text}}"}
                  rows={8}
                  className="w-full form-input resize-none font-mono text-[11px] leading-relaxed"
                  style={{
                    ...fieldStyle,
                    background: "color-mix(in srgb, var(--background) 50%, var(--surface))",
                  }}
                />
              </div>
            )}

            {execType === "code" && config.execution?.type === "code" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-medium" style={{ color: "var(--text-secondary)" }}>
                    Node.js 代码
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded" style={{
                    background: "var(--surface-elevated)",
                    color: "var(--text-muted)",
                  }}>
                    定义 execute(params) 函数
                  </span>
                </div>
                <textarea
                  value={config.execution.code}
                  onChange={(e) => {
                    if (config.execution?.type === "code") {
                      updateField("execution", { ...config.execution, code: e.target.value });
                    }
                  }}
                  placeholder={'async function execute(params) {\n  // 你的逻辑\n  return { success: true, message: "完成" };\n}'}
                  rows={12}
                  className="w-full form-input resize-none font-mono text-[11px] leading-relaxed"
                  style={{
                    ...fieldStyle,
                    background: "color-mix(in srgb, var(--background) 50%, var(--surface))",
                  }}
                  spellCheck={false}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="npm 依赖" hint="逗号分隔">
                    <input
                      value={(config.execution.dependencies || []).join(", ")}
                      onChange={(e) => {
                        if (config.execution?.type === "code") {
                          updateField("execution", {
                            ...config.execution,
                            dependencies: e.target.value.split(",").map(s => s.trim()).filter(Boolean),
                          });
                        }
                      }}
                      placeholder="axios, lodash"
                      className="form-input text-[11px]"
                      style={fieldStyle}
                    />
                  </FormField>
                  <FormField label="超时时间 (ms)">
                    <input
                      type="number"
                      value={config.execution.timeout || 30000}
                      onChange={(e) => {
                        if (config.execution?.type === "code") {
                          updateField("execution", {
                            ...config.execution,
                            timeout: parseInt(e.target.value) || 30000,
                          });
                        }
                      }}
                      className="form-input text-[11px]"
                      style={fieldStyle}
                    />
                  </FormField>
                </div>
              </div>
            )}

            {execType === "compose" && config.execution?.type === "compose" && (
              <div className="space-y-2">
                {config.execution.steps.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      添加执行步骤来串联多个技能
                    </p>
                  </div>
                ) : (
                  config.execution.steps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-3 rounded-xl border" style={{
                      background: "color-mix(in srgb, var(--surface-elevated) 60%, transparent)",
                      borderColor: "var(--border)",
                    }}>
                      <span className="text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full" style={{
                        background: "color-mix(in srgb, var(--accent) 15%, transparent)",
                        color: "var(--accent)",
                      }}>
                        {idx + 1}
                      </span>
                      <input
                        value={step.skill}
                        onChange={(e) => {
                          const steps = [...(config.execution?.type === "compose" ? config.execution.steps : [])];
                          steps[idx] = { ...steps[idx], skill: e.target.value };
                          updateField("execution", { type: "compose", steps });
                        }}
                        placeholder="技能名"
                        className="flex-1 form-input text-[11px]"
                        style={fieldStyle}
                      />
                      <input
                        value={step.outputAs || ""}
                        onChange={(e) => {
                          const steps = [...(config.execution?.type === "compose" ? config.execution.steps : [])];
                          steps[idx] = { ...steps[idx], outputAs: e.target.value || undefined };
                          updateField("execution", { type: "compose", steps });
                        }}
                        placeholder="输出变量名"
                        className="w-28 form-input text-[11px]"
                        style={fieldStyle}
                      />
                      <button
                        onClick={() => {
                          const steps = [...(config.execution?.type === "compose" ? config.execution.steps : [])];
                          steps.splice(idx, 1);
                          updateField("execution", { type: "compose", steps });
                        }}
                        className="p-1 rounded-md hover:bg-red-500/10 transition-colors"
                        style={{ color: "var(--error)" }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
                <button
                  onClick={() => {
                    const steps = [...(config.execution?.type === "compose" ? config.execution.steps : [])];
                    steps.push({ skill: "", params: {}, outputAs: undefined });
                    updateField("execution", { type: "compose", steps });
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all hover:scale-[1.01]"
                  style={{
                    color: "var(--accent)",
                    background: "color-mix(in srgb, var(--accent) 8%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--accent) 15%, transparent)",
                  }}
                >
                  <Plus className="h-3 w-3" /> 添加步骤
                </button>
              </div>
            )}
          </SectionCard>
        </div>
      ) : (
        /* JSON Editor */
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <div className="px-4 py-2 flex items-center gap-2 border-b" style={{
            background: "var(--surface-elevated)",
            borderColor: "var(--border)",
          }}>
            <FileCode className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />
            <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
              skill-config.json
            </span>
          </div>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={24}
            className="w-full form-input resize-none font-mono text-[11px] leading-relaxed rounded-none border-0"
            style={{
              ...fieldStyle,
              background: "color-mix(in srgb, var(--background) 60%, var(--surface))",
              borderColor: "transparent",
            }}
            spellCheck={false}
          />
        </div>
      )}

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saving || !isValid}
        className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all hover:scale-[1.005] active:scale-[0.995] disabled:opacity-30 disabled:hover:scale-100"
        style={{
          background: isValid
            ? "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 80%, #10b981))"
            : "var(--surface-elevated)",
          color: isValid ? "white" : "var(--text-muted)",
          boxShadow: isValid ? "0 4px 16px -4px var(--accent)" : "none",
        }}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {saving ? "保存中..." : initial ? "更新技能" : "保存技能"}
      </button>
    </div>
  );
}

/* --- Sub-components --- */

interface SectionCardProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  isActive: boolean;
  onToggle: () => void;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}

function SectionCard({ title, icon, children, isActive, onToggle, badge, action }: SectionCardProps) {
  return (
    <div
      className="rounded-2xl border transition-all overflow-hidden"
      style={{
        borderColor: isActive ? "color-mix(in srgb, var(--accent) 20%, var(--border))" : "var(--border)",
        background: "var(--surface)",
      }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3 transition-colors hover:bg-white/[0.02]"
      >
        <div className="p-1 rounded-lg" style={{
          background: isActive ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "var(--surface-elevated)",
          color: isActive ? "var(--accent)" : "var(--text-muted)",
        }}>
          {icon}
        </div>
        <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </span>
        {badge}
        <div className="ml-auto flex items-center gap-2">
          {action}
          <ChevronDown
            className="h-4 w-4 transition-transform"
            style={{
              color: "var(--text-muted)",
              transform: isActive ? "rotate(180deg)" : "rotate(0)",
            }}
          />
        </div>
      </button>
      {isActive && (
        <div className="px-4 pb-4 space-y-3 animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
}

interface FormFieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}

function FormField({ label, hint, required, children }: FormFieldProps) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
          {label}
        </label>
        {required && (
          <span className="text-[8px] font-bold" style={{ color: "var(--error)" }}>*</span>
        )}
        {hint && (
          <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  borderColor: "var(--border)",
  background: "var(--surface-elevated)",
  color: "var(--text-primary)",
};
