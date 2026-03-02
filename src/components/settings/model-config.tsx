"use client";

import { useState } from "react";
import { useAppStore, type ProviderConfig } from "@/lib/store";

export function ModelConfig() {
  const {
    settings,
    setSettings,
    getProviders,
    addProvider,
    updateProvider,
    deleteProvider,
    deleteModel,
  } = useAppStore();

  const providers = getProviders();
  const currentProvider = providers.find((p) => p.id === settings.providerId);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="space-y-6">
      {/* 提供商列表 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            模型提供商
          </h3>
          <button
            onClick={() => setShowAdd(true)}
            className="text-xs px-3 py-1.5 rounded-lg transition-all hover:brightness-110"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            + 添加
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {providers.map((provider) => {
            const isActive = settings.providerId === provider.id;
            return (
              <button
                key={provider.id}
                onClick={() => {
                  setSettings({
                    providerId: provider.id,
                    modelId: provider.models[0]?.id || "",
                  });
                }}
                className="relative group rounded-xl border px-4 py-3 text-sm transition-all"
                style={{
                  borderColor: isActive
                    ? "color-mix(in srgb, var(--accent) 50%, transparent)"
                    : "var(--border)",
                  background: isActive
                    ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                    : "var(--surface-elevated)",
                  color: isActive ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                {provider.name}
                {provider.apiKey && (
                  <span
                    className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full"
                    style={{ background: "#00c853" }}
                    title="API Key 已配置"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 当前选中提供商的配置 */}
      {currentProvider && (
        <ProviderDetail
          config={currentProvider}
          isEditing={editingId === currentProvider.id}
          onEdit={() => setEditingId(currentProvider.id)}
          onSave={(patch) => {
            updateProvider(currentProvider.id, patch);
            setEditingId(null);
          }}
          onCancel={() => setEditingId(null)}
          onDelete={
            providers.length > 1
              ? () => {
                  deleteProvider(currentProvider.id);
                  setEditingId(null);
                }
              : undefined
          }
        />
      )}

      {/* 模型列表 */}
      <div>
        <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-primary)" }}>
          模型
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {currentProvider?.models.map((model) => {
            const isActive = settings.modelId === model.id;
            const canDelete = (currentProvider?.models.length ?? 0) > 1;
            return (
              <div
                key={model.id}
                className="relative group rounded-xl border text-sm transition-all"
                style={{
                  borderColor: isActive
                    ? "color-mix(in srgb, var(--accent) 50%, transparent)"
                    : "var(--border)",
                  background: isActive
                    ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                    : "var(--surface-elevated)",
                  color: isActive ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                <button
                  onClick={() => setSettings({ modelId: model.id })}
                  className="w-full px-4 py-3 text-left"
                >
                  {model.name}
                </button>
                {canDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteModel(currentProvider!.id, model.id);
                    }}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                    style={{ color: "#ff5252", background: "rgba(255,82,82,0.1)" }}
                    title="删除此模型"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 添加提供商弹窗 */}
      {showAdd && (
        <AddProviderModal
          existingIds={providers.map((p) => p.id)}
          onAdd={(p) => {
            addProvider(p);
            setSettings({ providerId: p.id, modelId: p.models[0]?.id || "" });
            setShowAdd(false);
          }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

/* ─── 提供商详情/编辑面板 ─── */

function ProviderDetail({
  config,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: {
  config: ProviderConfig;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (patch: Partial<Omit<ProviderConfig, "id" | "isBuiltin">>) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [name, setName] = useState(config.name);
  const [modelsText, setModelsText] = useState(
    config.models.map((m) => `${m.id}:${m.name}`).join("\n")
  );
  const [showKey, setShowKey] = useState(false);

  const resetForm = () => {
    setApiKey(config.apiKey);
    setBaseUrl(config.baseUrl);
    setName(config.name);
    setModelsText(config.models.map((m) => `${m.id}:${m.name}`).join("\n"));
    setShowKey(false);
  };

  const handleEdit = () => {
    resetForm();
    onEdit();
  };

  const handleSave = () => {
    const models = modelsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(":");
        if (idx === -1) return { id: line, name: line };
        return { id: line.slice(0, idx), name: line.slice(idx + 1) };
      });
    onSave({ name, apiKey, baseUrl, models });
  };

  const maskedKey = config.apiKey
    ? config.apiKey.slice(0, 6) + "••••" + config.apiKey.slice(-4)
    : "未配置";

  const inputStyle = {
    background: "var(--background)",
    color: "var(--text-primary)",
    borderColor: "var(--border)",
  };

  if (!isEditing) {
    return (
      <div
        className="rounded-xl border p-4 space-y-3"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            {config.name}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleEdit}
              className="text-xs px-3 py-1 rounded-lg border transition-all hover:brightness-110"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              编辑
            </button>
            {onDelete && (
              <button
                onClick={onDelete}
                className="text-xs px-3 py-1 rounded-lg border transition-all hover:brightness-110"
                style={{ borderColor: "rgba(255,82,82,0.3)", color: "#ff5252" }}
              >
                删除
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-[80px_1fr] gap-y-2 text-xs">
          <span style={{ color: "var(--text-muted)" }}>端点</span>
          <span className="font-mono truncate" style={{ color: "var(--text-secondary)" }}>
            {config.baseUrl}
          </span>
          <span style={{ color: "var(--text-muted)" }}>API Key</span>
          <span className="font-mono" style={{ color: config.apiKey ? "var(--accent)" : "var(--text-muted)" }}>
            {maskedKey}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{
        borderColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
        background: "var(--surface)",
      }}
    >
      <div className="space-y-2">
        <label className="block text-xs" style={{ color: "var(--text-muted)" }}>
          名称
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          style={inputStyle}
        />
      </div>
      <div className="space-y-2">
        <label className="block text-xs" style={{ color: "var(--text-muted)" }}>
          端点 (Base URL)
        </label>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
          className="w-full rounded-lg border px-3 py-2 text-sm font-mono outline-none focus:border-[var(--accent)]"
          style={inputStyle}
        />
      </div>
      <div className="space-y-2">
        <label className="block text-xs" style={{ color: "var(--text-muted)" }}>
          API Key
        </label>
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full rounded-lg border px-3 py-2 pr-16 text-sm font-mono outline-none focus:border-[var(--accent)]"
            style={inputStyle}
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-0.5 rounded"
            style={{ color: "var(--text-muted)" }}
          >
            {showKey ? "隐藏" : "显示"}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <label className="block text-xs" style={{ color: "var(--text-muted)" }}>
          模型列表（每行一个，格式：model-id:显示名称）
        </label>
        <textarea
          value={modelsText}
          onChange={(e) => setModelsText(e.target.value)}
          rows={4}
          className="w-full rounded-lg border px-3 py-2 text-xs font-mono outline-none resize-none focus:border-[var(--accent)]"
          style={inputStyle}
          placeholder={"gpt-4o:GPT-4o\ngpt-4o-mini:GPT-4o Mini"}
        />
      </div>
      <div className="flex justify-between pt-1">
        {onDelete ? (
          <button
            onClick={onDelete}
            className="text-xs px-4 py-1.5 rounded-lg border transition-all hover:brightness-110"
            style={{ borderColor: "rgba(255,82,82,0.3)", color: "#ff5252" }}
          >
            删除提供商
          </button>
        ) : (
          <div />
        )}
        <div className="flex gap-2">
          <button
            onClick={() => {
              resetForm();
              onCancel();
            }}
            className="text-xs px-4 py-1.5 rounded-lg border transition-all"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="text-xs px-4 py-1.5 rounded-lg transition-all hover:brightness-110"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── 添加提供商弹窗 ─── */

function AddProviderModal({
  existingIds,
  onAdd,
  onClose,
}: {
  existingIds: string[];
  onAdd: (p: Omit<ProviderConfig, "isBuiltin">) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelsText, setModelsText] = useState("");

  const handleAdd = () => {
    if (!name.trim() || !baseUrl.trim()) return;
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (existingIds.includes(id)) return;

    const models = modelsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(":");
        if (idx === -1) return { id: line, name: line };
        return { id: line.slice(0, idx), name: line.slice(idx + 1) };
      });

    onAdd({ id, name: name.trim(), baseUrl: baseUrl.trim(), apiKey, models });
  };

  const inputStyle = {
    background: "var(--background)",
    color: "var(--text-primary)",
    borderColor: "var(--border)",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="rounded-2xl border p-6 w-full max-w-md space-y-4"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          添加模型提供商
        </h3>
        <div className="space-y-2">
          <label className="block text-xs" style={{ color: "var(--text-muted)" }}>
            名称 *
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Provider"
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            style={inputStyle}
          />
        </div>
        <div className="space-y-2">
          <label className="block text-xs" style={{ color: "var(--text-muted)" }}>
            端点 (Base URL) *
          </label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            className="w-full rounded-lg border px-3 py-2 text-sm font-mono outline-none focus:border-[var(--accent)]"
            style={inputStyle}
          />
        </div>
        <div className="space-y-2">
          <label className="block text-xs" style={{ color: "var(--text-muted)" }}>
            API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full rounded-lg border px-3 py-2 text-sm font-mono outline-none focus:border-[var(--accent)]"
            style={inputStyle}
          />
        </div>
        <div className="space-y-2">
          <label className="block text-xs" style={{ color: "var(--text-muted)" }}>
            模型列表（每行一个，格式：model-id:显示名称）
          </label>
          <textarea
            value={modelsText}
            onChange={(e) => setModelsText(e.target.value)}
            rows={3}
            className="w-full rounded-lg border px-3 py-2 text-xs font-mono outline-none resize-none focus:border-[var(--accent)]"
            style={inputStyle}
            placeholder={"gpt-4o:GPT-4o\ngpt-4o-mini:GPT-4o Mini"}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg border transition-all"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            取消
          </button>
          <button
            onClick={handleAdd}
            disabled={!name.trim() || !baseUrl.trim()}
            className="text-sm px-4 py-2 rounded-lg transition-all hover:brightness-110 disabled:opacity-40"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
