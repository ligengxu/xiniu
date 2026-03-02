"use client";

import { useState, useEffect, useRef, useMemo, memo } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Wrench,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileCode2,
  FolderOpen,
  Save,
  Eye,
  EyeOff,
} from "lucide-react";
import { getIconComponent } from "@/components/skills/skill-card";

interface SkillMeta {
  name: string;
  displayName: string;
  icon: string;
}

let cachedSkillsMeta: SkillMeta[] | null = null;

function useSkillsMeta() {
  const [meta, setMeta] = useState<SkillMeta[]>(cachedSkillsMeta || []);

  useEffect(() => {
    if (cachedSkillsMeta) return;
    fetch("/api/skills")
      .then((r) => r.json())
      .then((data) => {
        const skills = Array.isArray(data) ? data : data.skills || [];
        cachedSkillsMeta = skills;
        setMeta(skills);
      })
      .catch(() => {});
  }, []);

  return meta;
}

const FILE_SKILL_NAMES = new Set(["create_txt", "create_folder", "generate_word", "generate_excel", "generate_ppt", "generate_pdf"]);

function getFileExtension(filePath: string): string {
  const dotIdx = filePath.lastIndexOf(".");
  if (dotIdx === -1) return "";
  return filePath.slice(dotIdx + 1).toLowerCase();
}

function getLanguageLabel(ext: string): string {
  const map: Record<string, string> = {
    html: "HTML", htm: "HTML", css: "CSS", js: "JavaScript", jsx: "JSX",
    ts: "TypeScript", tsx: "TSX", json: "JSON", md: "Markdown", py: "Python",
    go: "Go", java: "Java", rs: "Rust", sql: "SQL", xml: "XML", yaml: "YAML",
    yml: "YAML", sh: "Shell", bat: "Batch", ps1: "PowerShell", txt: "Text",
    csv: "CSV", svg: "SVG", toml: "TOML", ini: "INI", cfg: "Config",
  };
  return map[ext] || ext.toUpperCase();
}

function formatParamValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v.map((item, i) => {
      if (typeof item === "object" && item !== null) {
        const o = item as Record<string, unknown>;
        const parts: string[] = [];
        for (const [k2, v2] of Object.entries(o)) {
          parts.push(`${k2}: ${typeof v2 === "string" ? v2 : JSON.stringify(v2)}`);
        }
        return `[${i + 1}] ${parts.join(", ")}`;
      }
      return String(item);
    }).join("\n");
  }
  if (typeof v === "object") {
    try { return JSON.stringify(v, null, 1); } catch { return String(v); }
  }
  return String(v);
}

function getStepPhase(
  state: string,
  hasInput: boolean,
  inputContentLen: number,
  hasResult: boolean,
  success?: boolean
): { label: string; icon: typeof FileCode2; color: string; pct: number } {
  if (state === "output-error") {
    return { label: "执行出错", icon: XCircle, color: "var(--error)", pct: 100 };
  }
  if (hasResult) {
    return success
      ? { label: "已完成", icon: CheckCircle2, color: "var(--success)", pct: 100 }
      : { label: "执行失败", icon: XCircle, color: "var(--error)", pct: 100 };
  }
  if (state === "input-streaming") {
    return { label: `正在生成内容 (${inputContentLen} 字符)`, icon: FileCode2, color: "var(--warning)", pct: 40 };
  }
  if (state === "input-available") {
    if (hasInput && inputContentLen > 0) {
      return { label: "正在写入文件...", icon: Save, color: "var(--accent)", pct: 75 };
    }
    return { label: "准备参数中...", icon: Loader2, color: "var(--warning)", pct: 15 };
  }
  return { label: "等待调用...", icon: Loader2, color: "var(--text-muted)", pct: 5 };
}

const StreamingCodePreview = memo(function StreamingCodePreview({
  content,
  filePath,
  isStreaming,
}: {
  content: string;
  filePath: string;
  isStreaming: boolean;
}) {
  const codeRef = useRef<HTMLPreElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (codeRef.current && isStreaming) {
      codeRef.current.scrollTop = codeRef.current.scrollHeight;
    }
  }, [content, isStreaming]);

  const ext = getFileExtension(filePath);
  const langLabel = getLanguageLabel(ext);
  const { lines, lineCount } = useMemo(() => {
    const l = content.split("\n");
    return { lines: l, lineCount: l.length };
  }, [content]);

  return (
    <div
      className="mt-1.5 rounded-lg border overflow-hidden"
      style={{ borderColor: "var(--border)", background: "var(--background)" }}
    >
      <div
        className="flex items-center justify-between px-2.5 py-1.5 border-b"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="flex items-center gap-2">
          <FileCode2 className="h-3 w-3" style={{ color: "var(--accent)" }} />
          <span className="text-[10px] font-mono font-medium" style={{ color: "var(--text-secondary)" }}>
            {filePath.split(/[\\/]/).pop()}
          </span>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-md font-medium"
            style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}
          >
            {langLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            {lineCount} 行 · {content.length} 字符
          </span>
          {isStreaming && (
            <span className="typing-cursor-blink text-[10px] font-bold" style={{ color: "var(--accent)" }}>
              ▋
            </span>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-0.5 rounded transition-colors"
            style={{ color: "var(--text-muted)" }}
            title={collapsed ? "展开代码" : "折叠代码"}
          >
            {collapsed ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <pre
          ref={codeRef}
          className="text-[11px] font-mono leading-relaxed overflow-auto p-2"
          style={{
            color: "var(--text-secondary)",
            maxHeight: "220px",
          }}
        >
          {(() => {
            const MAX_VISIBLE = 50;
            const startIdx = isStreaming && lineCount > MAX_VISIBLE ? lineCount - MAX_VISIBLE : 0;
            const visibleLines = startIdx > 0 ? lines.slice(startIdx) : lines;
            return (
              <>
                {startIdx > 0 && (
                  <div className="text-center text-[10px] py-0.5" style={{ color: "var(--text-muted)" }}>
                    ... 前 {startIdx} 行已折叠 ...
                  </div>
                )}
                {visibleLines.map((line, idx) => {
                  const realIdx = startIdx + idx;
                  return (
                    <div key={realIdx} className="flex">
                      <span
                        className="select-none text-right pr-3 shrink-0"
                        style={{ color: "var(--text-muted)", width: `${String(lineCount).length + 1}ch`, opacity: 0.5 }}
                      >
                        {realIdx + 1}
                      </span>
                      <span className="flex-1 whitespace-pre-wrap break-all">{line}</span>
                    </div>
                  );
                })}
              </>
            );
          })()}
          {isStreaming && (
            <div className="flex">
              <span
                className="select-none text-right pr-3 shrink-0"
                style={{ color: "var(--text-muted)", width: `${String(lineCount).length + 1}ch`, opacity: 0.5 }}
              >
                {lineCount + 1}
              </span>
              <span className="typing-cursor-blink" style={{ color: "var(--accent)" }}>▋</span>
            </div>
          )}
        </pre>
      )}
    </div>
  );
});

interface ToolPartProps {
  toolName: string;
  state: string;
  input?: Record<string, unknown>;
  output?: { success?: boolean; message?: string; data?: Record<string, unknown> };
  errorText?: string;
  stepIndex?: number;
  totalSteps?: number;
}

export const ToolInvocationCard = memo(function ToolInvocationCard({ toolName, state, input, output, errorText, stepIndex, totalSteps }: ToolPartProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const skillsMeta = useSkillsMeta();

  const skillMeta = skillsMeta.find((s) => s.name === toolName);
  const IconComponent = skillMeta ? getIconComponent(skillMeta.icon) : Wrench;
  const displayName = skillMeta?.displayName || toolName;

  const isFileSkill = FILE_SKILL_NAMES.has(toolName);
  const isLoading = state === "input-streaming" || state === "input-available";
  const isStreaming = state === "input-streaming";
  const hasResult = state === "output-available" || state === "output-error" || state === "output-denied";
  const isError = state === "output-error";

  const hasLongOutput = output?.message && output.message.length > 200;
  const hasDataDetails = output?.data && Object.keys(output.data).length > 0;
  const showExpandButton = hasResult && (hasLongOutput || hasDataDetails);

  const globalProgressPercent = stepIndex && totalSteps ? Math.round((stepIndex / totalSteps) * 100) : 0;

  const inputContent = input ? String(input.content || input.code || input.text || "") : "";
  const inputFilePath = input ? String(input.filePath || input.file_path || input.path || "") : "";
  const phase = isFileSkill
    ? getStepPhase(state, !!input, inputContent.length, hasResult, output?.success)
    : null;

  const inputEntries = useMemo(() => {
    if (!input) return [];
    return Object.entries(input).filter(([k]) => {
      if (isFileSkill && (k === "content" || k === "code" || k === "text")) return false;
      return true;
    });
  }, [input, isFileSkill]);

  return (
    <div
      className="my-2 rounded-xl border overflow-hidden"
      style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--surface) 60%, transparent)" }}
    >
      {/* header */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b"
        style={{ background: "var(--surface-elevated)", borderColor: "color-mix(in srgb, var(--border) 50%, transparent)" }}
      >
        {stepIndex !== undefined && totalSteps !== undefined && (
          <span
            className="flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold shrink-0"
            style={{
              background: hasResult
                ? (output?.success ? "color-mix(in srgb, var(--success) 25%, transparent)" : "color-mix(in srgb, var(--error) 25%, transparent)")
                : "color-mix(in srgb, var(--accent) 25%, transparent)",
              color: hasResult
                ? (output?.success ? "var(--success)" : "var(--error)")
                : "var(--accent)",
              border: `1.5px solid ${hasResult ? (output?.success ? "var(--success)" : "var(--error)") : "var(--accent)"}`,
            }}
          >
            {hasResult ? (output?.success ? "✓" : "✗") : stepIndex}
          </span>
        )}
        <IconComponent className="h-4 w-4" style={{ color: "var(--accent)" }} />
        <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
          {displayName}
        </span>
        {stepIndex !== undefined && totalSteps !== undefined && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{
            color: "var(--text-muted)",
            background: "color-mix(in srgb, var(--surface) 80%, transparent)",
          }}>
            步骤 {stepIndex}/{totalSteps}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {isLoading && !hasResult && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--warning)" }} />
          )}
          {hasResult && !isError && output?.success === true && (
            <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--success)" }} />
          )}
          {(isError || (hasResult && output?.success === false)) && (
            <XCircle className="h-3.5 w-3.5" style={{ color: "var(--error)" }} />
          )}
        </span>
      </div>

      {/* file-skill phase progress bar */}
      {isFileSkill && phase && (
        <div className="px-3 py-1.5 flex items-center gap-2">
          <div className="flex-1 h-[3px] rounded-full" style={{ background: "color-mix(in srgb, var(--border) 40%, transparent)" }}>
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${phase.pct}%`, background: phase.color }}
            />
          </div>
          <span className="text-[10px] font-medium shrink-0 flex items-center gap-1" style={{ color: phase.color }}>
            {isStreaming && <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: phase.color }} />}
            {phase.label}
          </span>
        </div>
      )}

      {/* non-file-skill global progress bar */}
      {!isFileSkill && stepIndex !== undefined && totalSteps !== undefined && totalSteps > 1 && (
        <div className="h-[3px] w-full" style={{ background: "color-mix(in srgb, var(--border) 30%, transparent)" }}>
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{
              width: `${hasResult ? globalProgressPercent : Math.max(globalProgressPercent - 10, 5)}%`,
              background: hasResult
                ? (output?.success ? "var(--success)" : "var(--error)")
                : "var(--accent)",
            }}
          />
        </div>
      )}

      {/* body */}
      <div className="px-3 py-2 space-y-1.5">
        {/* file path highlight for file skills */}
        {isFileSkill && inputFilePath && (
          <div className="flex items-center gap-1.5 text-xs">
            <FolderOpen className="h-3 w-3 shrink-0" style={{ color: "var(--accent)" }} />
            <span className="font-mono break-all" style={{ color: "var(--text-primary)" }}>
              {inputFilePath}
            </span>
          </div>
        )}

        {/* non-content input params */}
        {inputEntries.length > 0 && (
          <div className="text-xs max-h-[120px] overflow-y-auto" style={{ color: "var(--text-muted)" }}>
            {inputEntries.map(([k, v]) => {
              const val = formatParamValue(v);
              const isLong = val.length > 200;
              const isMultiline = val.includes("\n");
              return (
                <div key={k} className={isMultiline ? "mb-1" : "flex gap-1 mb-0.5"}>
                  <span className="shrink-0 font-medium" style={{ color: "var(--text-secondary)" }}>{k}:</span>
                  {isMultiline ? (
                    <pre className="mt-0.5 whitespace-pre-wrap break-all font-mono text-[11px] pl-2 border-l-2" style={{ color: "var(--text-primary)", borderColor: "var(--border)" }}>
                      {isLong ? val.slice(0, 500) + `\n... (${val.length}字符)` : val}
                    </pre>
                  ) : isLong ? (
                    <span className="break-all" style={{ color: "var(--text-primary)" }}>
                      {val.slice(0, 200)}
                      <span style={{ color: "var(--text-muted)" }}>... ({val.length}字符)</span>
                    </span>
                  ) : (
                    <span className="break-all" style={{ color: "var(--text-primary)" }}>{val}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* streaming code preview for file skills */}
        {isFileSkill && inputContent.length > 0 && (
          <StreamingCodePreview
            content={inputContent}
            filePath={inputFilePath || "file.txt"}
            isStreaming={isStreaming}
          />
        )}

        {/* non-file skill standard input display */}
        {!isFileSkill && input && Object.keys(input).length > 0 && inputEntries.length === 0 && (
          <div className="text-xs max-h-[180px] overflow-y-auto" style={{ color: "var(--text-muted)" }}>
            {Object.entries(input).map(([k, v]) => {
              const val = formatParamValue(v);
              const isLong = val.length > 200;
              const isMultiline = val.includes("\n");
              return (
                <div key={k} className={isMultiline ? "mb-1" : "flex gap-1 mb-0.5"}>
                  <span className="shrink-0 font-medium" style={{ color: "var(--text-secondary)" }}>{k}:</span>
                  {isMultiline ? (
                    <pre className="mt-0.5 whitespace-pre-wrap break-all font-mono text-[11px] pl-2 border-l-2" style={{ color: "var(--text-primary)", borderColor: "var(--border)" }}>
                      {isLong ? val.slice(0, 500) + `\n... (${val.length}字符)` : val}
                    </pre>
                  ) : isLong ? (
                    <span className="break-all" style={{ color: "var(--text-primary)" }}>
                      {val.slice(0, 200)}
                      <span style={{ color: "var(--text-muted)" }}>... ({val.length}字符)</span>
                    </span>
                  ) : (
                    <span className="break-all" style={{ color: "var(--text-primary)" }}>{val}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {hasResult && (output || errorText) && (
          <div
            className="text-xs mt-1 leading-relaxed max-h-[250px] overflow-y-auto whitespace-pre-wrap break-all [overflow-wrap:anywhere]"
            style={{ color: (isError || (output && !output.success)) ? "var(--error)" : "var(--success)" }}
          >
            {isError && !output?.message && errorText
              ? errorText
              : hasLongOutput && !detailsOpen
                ? output!.message!.slice(0, 300) + "..."
                : output?.message}
          </div>
        )}

        {hasResult && output?.data && String(output.data.action) === "open_in_browser" && output.data.url ? (
          <a
            href={String(output.data.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs mt-1 hover:opacity-80 transition-opacity"
            style={{ color: "var(--accent)" }}
          >
            <ExternalLink className="h-3 w-3" />
            在新标签页打开
          </a>
        ) : null}

        {hasResult && output?.data?.output != null && toolName === "run_code" && (
          <div className="mt-1.5">
            <pre
              className="text-xs font-mono p-2 rounded-lg max-h-[200px] overflow-auto leading-relaxed whitespace-pre-wrap break-all"
              style={{ background: "var(--background)", color: "var(--text-secondary)" }}
            >
              {String(output.data.output)}
            </pre>
          </div>
        )}

        {showExpandButton && (
          <button
            onClick={() => setDetailsOpen(!detailsOpen)}
            className="flex items-center gap-1 text-[11px] mt-1 transition-colors hover:opacity-80"
            style={{ color: "var(--accent)" }}
          >
            {detailsOpen ? (
              <><ChevronUp className="h-3 w-3" /> 收起详情</>
            ) : (
              <><ChevronDown className="h-3 w-3" /> 展开详情</>
            )}
          </button>
        )}

        {detailsOpen && hasDataDetails && (
          <div
            className="mt-1.5 p-2 rounded-lg text-xs font-mono max-h-[300px] overflow-auto"
            style={{ background: "var(--background)", color: "var(--text-muted)" }}
          >
            <pre className="whitespace-pre-wrap break-all leading-relaxed">
              {JSON.stringify(output!.data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
});
