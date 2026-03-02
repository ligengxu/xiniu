"use client";

import { useState, useCallback, memo } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check, Play, Pencil, X } from "lucide-react";

interface CodeBlockProps {
  language: string;
  code: string;
}

export const CodeBlock = memo(function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(code);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(editing ? editValue : code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [code, editValue, editing]);

  const handleRun = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setOutput(null);
    try {
      const res = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: editing ? editValue : code, language }),
      });
      const data = await res.json();
      setOutput(data.output || data.message || "执行完毕");
    } catch (err) {
      setOutput(`执行失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }, [code, editValue, language, editing, running]);

  const runnableLanguages = ["python", "javascript", "js", "typescript", "ts", "shell", "bash", "sh", "powershell"];
  const isRunnable = runnableLanguages.includes(language?.toLowerCase() || "");

  const langColorMap: Record<string, string> = {
    python: "#3572A5",
    javascript: "#f1e05a",
    js: "#f1e05a",
    typescript: "#3178c6",
    ts: "#3178c6",
    java: "#b07219",
    go: "#00ADD8",
    rust: "#dea584",
    cpp: "#f34b7d",
    c: "#555555",
    html: "#e34c26",
    css: "#1572B6",
    json: "#292929",
    yaml: "#cb171e",
    sql: "#e38c00",
    shell: "#89e051",
    bash: "#89e051",
    sh: "#89e051",
    powershell: "#012456",
    markdown: "#083fa1",
  };

  const langColor = langColorMap[language?.toLowerCase() || ""] || "#10b981";

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-zinc-700/40 bg-zinc-900 group">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/80 border-b border-zinc-700/30">
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: langColor }}
          />
          <span className="text-[11px] text-zinc-400 font-mono">
            {language || "text"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isRunnable && (
            <button
              onClick={handleRun}
              disabled={running}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-zinc-400 hover:text-emerald-400 hover:bg-zinc-700/50 transition-colors disabled:opacity-50"
              title="运行代码"
            >
              <Play className="h-3 w-3" />
              {running ? "运行中..." : "运行"}
            </button>
          )}
          <button
            onClick={() => {
              if (editing) {
                setEditing(false);
              } else {
                setEditValue(code);
                setEditing(true);
              }
            }}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-zinc-400 hover:text-blue-400 hover:bg-zinc-700/50 transition-colors"
            title={editing ? "取消编辑" : "编辑代码"}
          >
            {editing ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
            {editing ? "取消" : "编辑"}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-zinc-400 hover:text-emerald-400 hover:bg-zinc-700/50 transition-colors"
            title="复制代码"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span className="text-emerald-400">已复制</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                复制
              </>
            )}
          </button>
        </div>
      </div>

      {editing ? (
        <textarea
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="w-full bg-zinc-900 text-zinc-200 text-sm font-mono p-4 outline-none resize-y min-h-[100px] border-none"
          spellCheck={false}
        />
      ) : (
        <SyntaxHighlighter
          language={language || "text"}
          style={oneDark}
          customStyle={{
            margin: 0,
            padding: "1rem",
            background: "transparent",
            fontSize: "13px",
            lineHeight: "1.6",
          }}
          showLineNumbers={code.split("\n").length > 5}
          lineNumberStyle={{ minWidth: "2em", color: "#4a5568", paddingRight: "1em" }}
          wrapLongLines
        >
          {code}
        </SyntaxHighlighter>
      )}

      {output !== null && (
        <div className="border-t border-zinc-700/30 bg-zinc-950 px-4 py-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">输出</span>
          </div>
          <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap break-all leading-relaxed max-h-[200px] overflow-y-auto">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
});
