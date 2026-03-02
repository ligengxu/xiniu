"use client";

import { useEffect, useRef, useState, memo, useCallback } from "react";
import { Maximize2, Minimize2, Code2 } from "lucide-react";

interface MermaidBlockProps {
  code: string;
}

let mermaidInitialized = false;

async function initMermaid() {
  if (mermaidInitialized) return;
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
      primaryColor: "#10b981",
      primaryTextColor: "#e4e4e7",
      primaryBorderColor: "#3f3f46",
      lineColor: "#6ee7b7",
      secondaryColor: "#27272a",
      tertiaryColor: "#18181b",
      fontFamily: '"Inter", "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    securityLevel: "loose",
    suppressErrorRendering: true,
  });
  mermaidInitialized = true;
}

function sanitizeMermaidCode(raw: string): string {
  const lines = raw.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    let out = line;

    out = out.replace(
      /(\w)\[([^\]]*)\]/g,
      (_m, id, text) => {
        const cleaned = cleanNodeText(text);
        if (needsQuoting(cleaned)) return `${id}["${escapeForMermaid(cleaned)}"]`;
        return `${id}[${cleaned}]`;
      },
    );

    out = out.replace(
      /(\w)\(([^)]*)\)/g,
      (_m, id, text) => {
        if (/^["\s]*$/.test(text)) return _m;
        const cleaned = cleanNodeText(text);
        if (needsQuoting(cleaned)) return `${id}("${escapeForMermaid(cleaned)}")`;
        return `${id}(${cleaned})`;
      },
    );

    out = out.replace(
      /(\w)\{([^}]*)\}/g,
      (_m, id, text) => {
        const cleaned = cleanNodeText(text);
        if (needsQuoting(cleaned)) return `${id}{"${escapeForMermaid(cleaned)}"}`;
        return `${id}{${cleaned}}`;
      },
    );

    out = out.replace(
      /\|([^|]*)\|/g,
      (_m, text) => {
        const cleaned = cleanNodeText(text);
        if (needsQuoting(cleaned)) return `|"${escapeForMermaid(cleaned)}"|`;
        return `|${cleaned}|`;
      },
    );

    result.push(out);
  }

  return result.join("\n");
}

function cleanNodeText(text: string): string {
  if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
  return text.replace(/\\([(){}[\]|"\\])/g, "$1");
}

function needsQuoting(text: string): boolean {
  return /[(){}[\]\\|><#&;`]/.test(text);
}

function escapeForMermaid(text: string): string {
  return text.replace(/"/g, "#quot;");
}

export const MermaidBlock = memo(function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [expanded, setExpanded] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const cleanup = useCallback(() => {
    document.querySelectorAll("[id^='dmermaid-']").forEach((el) => el.remove());
    document.querySelectorAll(".mermaid-error, #d-mermaid").forEach((el) => el.remove());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        await initMermaid();
        const mermaid = (await import("mermaid")).default;
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        let safeCode: string;
        try {
          safeCode = sanitizeMermaidCode(code);
        } catch {
          safeCode = code;
        }

        const isValid = await mermaid.parse(safeCode).then(() => true).catch(() => false);
        if (!isValid) {
          if (!cancelled) {
            cleanup();
            setStatus("error");
          }
          return;
        }

        const { svg } = await mermaid.render(id, safeCode);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setStatus("ok");
        }
      } catch {
        if (!cancelled) {
          cleanup();
          setStatus("error");
        }
      }
    }

    render();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [code, cleanup]);

  if (status === "error" || showCode) {
    return (
      <div className="my-2 rounded-xl border border-zinc-700/40 bg-zinc-900 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/80 border-b border-zinc-700/30">
          <span className="text-[11px] text-zinc-400 font-mono">
            {status === "error" ? "mermaid (源码)" : "mermaid"}
          </span>
          {status === "ok" && (
            <button
              onClick={() => setShowCode(false)}
              className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              图表视图
            </button>
          )}
        </div>
        <pre className="p-3 text-xs text-zinc-300 font-mono whitespace-pre-wrap overflow-auto max-h-[300px] leading-relaxed">
          {code}
        </pre>
      </div>
    );
  }

  return (
    <div className={`my-2 rounded-xl border border-zinc-700/40 bg-zinc-900 overflow-hidden ${expanded ? "fixed inset-4 z-50" : ""}`}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/80 border-b border-zinc-700/30">
        <span className="text-[11px] text-zinc-400 font-mono">mermaid</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowCode(true)}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
            title="查看源码"
          >
            <Code2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
            title={expanded ? "缩小" : "放大"}
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className={`p-4 flex items-center justify-center overflow-auto ${expanded ? "h-[calc(100%-36px)]" : "max-h-[400px]"}`}
      />
      {expanded && (
        <div
          className="fixed inset-0 bg-black/60 -z-10"
          onClick={() => setExpanded(false)}
        />
      )}
    </div>
  );
});
