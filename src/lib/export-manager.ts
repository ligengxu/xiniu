export interface ExportMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

export function exportToMarkdown(
  title: string,
  messages: ExportMessage[]
): string {
  const lines: string[] = [
    `# ${title}`,
    "",
    `> 导出时间: ${new Date().toLocaleString("zh-CN")}`,
    `> 由犀牛 Agent 生成`,
    "",
    "---",
    "",
  ];

  for (const msg of messages) {
    const roleLabel = msg.role === "user" ? "**用户**" : "**犀牛 Agent**";
    const time = msg.timestamp
      ? new Date(msg.timestamp).toLocaleTimeString("zh-CN")
      : "";

    lines.push(`### ${roleLabel} ${time ? `(${time})` : ""}`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

export function exportToHtml(
  title: string,
  messages: ExportMessage[]
): string {
  const msgHtml = messages
    .map((msg) => {
      const isUser = msg.role === "user";
      const bgColor = isUser ? "#10b981" : "#27272a";
      const textColor = isUser ? "#ffffff" : "#e4e4e7";
      const align = isUser ? "flex-end" : "flex-start";
      const label = isUser ? "用户" : "犀牛 Agent";

      return `
        <div style="display:flex;justify-content:${align};margin:8px 0;">
          <div style="max-width:75%;background:${bgColor};color:${textColor};padding:12px 16px;border-radius:16px;">
            <div style="font-size:10px;opacity:0.7;margin-bottom:4px;">${label}</div>
            <div style="font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(msg.content)}</div>
          </div>
        </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)} - 犀牛 Agent</title>
  <style>
    body { font-family: "Inter","PingFang SC","Microsoft YaHei",sans-serif; background:#09090b; color:#fafafa; padding:24px; max-width:800px; margin:0 auto; }
    h1 { color:#10b981; text-align:center; font-size:24px; }
    .meta { text-align:center; color:#71717a; font-size:12px; margin-bottom:24px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">由犀牛 Agent 导出 · ${new Date().toLocaleString("zh-CN")}</div>
  ${msgHtml}
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
