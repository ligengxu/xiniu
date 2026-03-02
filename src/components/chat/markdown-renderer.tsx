"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Components } from "react-markdown";
import { CodeBlock } from "./code-block";
import { MermaidBlock } from "./mermaid-block";

interface MarkdownRendererProps {
  content: string;
}

const components: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    const language = match ? match[1] : "";
    const code = String(children).replace(/\n$/, "");
    const isInline = !className && !code.includes("\n");

    if (isInline) {
      return (
        <code className="px-1.5 py-0.5 rounded-md bg-zinc-700/60 text-emerald-300 text-[13px] font-mono break-all" {...props}>
          {children}
        </code>
      );
    }

    if (language === "mermaid") {
      return <MermaidBlock code={code} />;
    }

    return <CodeBlock language={language} code={code} />;
  },

  p({ children }) {
    return <p className="mb-3 last:mb-0 leading-relaxed [overflow-wrap:anywhere]">{children}</p>;
  },

  h1({ children }) {
    return <h1 className="text-xl font-bold text-zinc-100 mt-5 mb-3 pb-2 border-b border-zinc-700/50">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-lg font-bold text-zinc-100 mt-4 mb-2 pb-1.5 border-b border-zinc-700/30">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-base font-semibold text-zinc-200 mt-3 mb-2">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="text-sm font-semibold text-zinc-200 mt-2 mb-1">{children}</h4>;
  },

  ul({ children }) {
    return <ul className="list-disc list-inside space-y-1 mb-3 pl-2">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal list-inside space-y-1 mb-3 pl-2">{children}</ol>;
  },
  li({ children }) {
    return <li className="text-zinc-300 leading-relaxed">{children}</li>;
  },

  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 decoration-emerald-400/30 hover:decoration-emerald-300/50 transition-colors"
      >
        {children}
      </a>
    );
  },

  blockquote({ children }) {
    return (
      <blockquote className="border-l-3 border-emerald-500/50 pl-4 py-1 my-3 text-zinc-400 italic bg-zinc-800/20 rounded-r-lg">
        {children}
      </blockquote>
    );
  },

  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded-lg border border-zinc-700/40">
        <table className="w-full text-sm">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-zinc-800/60 border-b border-zinc-700/40">{children}</thead>;
  },
  th({ children }) {
    return <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-300 uppercase tracking-wider">{children}</th>;
  },
  tr({ children }) {
    return <tr className="border-b border-zinc-800/50 even:bg-zinc-800/20 hover:bg-zinc-800/40 transition-colors">{children}</tr>;
  },
  td({ children }) {
    return <td className="px-3 py-2 text-zinc-300">{children}</td>;
  },

  hr() {
    return <hr className="my-4 border-zinc-700/50" />;
  },

  img({ src, alt }) {
    return (
      <span className="block my-3">
        <img
          src={src}
          alt={alt || ""}
          className="max-w-full rounded-lg border border-zinc-700/40 cursor-pointer hover:opacity-90 transition-opacity"
          loading="lazy"
        />
        {alt && <span className="block text-xs text-zinc-500 mt-1 text-center">{alt}</span>}
      </span>
    );
  },

  strong({ children }) {
    return <strong className="font-semibold text-zinc-100">{children}</strong>;
  },
  em({ children }) {
    return <em className="italic text-zinc-300">{children}</em>;
  },
};

const remarkPluginsStable = [remarkGfm, remarkMath] as const;
const rehypePluginsStable = [rehypeKatex] as const;

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="markdown-body text-sm text-zinc-200 leading-relaxed overflow-hidden [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={remarkPluginsStable as unknown as [typeof remarkGfm, typeof remarkMath]}
        rehypePlugins={rehypePluginsStable as unknown as [typeof rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
