import { z } from "zod";
import type { SkillDefinition } from "../types";

interface WebhookEntry {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  query: string;
}

const receivedHooks: WebhookEntry[] = [];
let receiverProcess: { pid: number; port: number } | null = null;
const MAX_ENTRIES = 200;

function generateReceiverScript(port: number, logFile: string): string {
  return `
const http = require("http");
const fs = require("fs");
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.url,
      headers: req.headers,
      body: body,
      query: new URL(req.url, "http://localhost").search
    };
    fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(entry) + "\\n");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({received: true, id: entry.id}));
  });
});
server.listen(${port}, () => console.log("Webhook receiver on port ${port}"));
`;
}

export const webhookReceiverSkill: SkillDefinition = {
  name: "webhook_receiver",
  displayName: "回调接收器",
  description:
    "启动HTTP回调接收服务，接收并记录所有发来的Webhook请求，用于调试和测试。" +
    "用户说'webhook'、'回调接收'、'接收回调'、'webhook receiver'、'回调测试'时使用。",
  icon: "Webhook",
  category: "dev",
  parameters: z.object({
    action: z.enum(["start", "stop", "list", "clear", "detail"]).describe("操作: start启动/stop停止/list查看记录/clear清空/detail查看详情"),
    port: z.number().optional().describe("监听端口，默认9876"),
    id: z.string().optional().describe("查看详情时的请求ID"),
    limit: z.number().optional().describe("列表显示数量，默认20"),
  }),
  execute: async (params) => {
    const p = params as Record<string, unknown>;
    const action = p.action as string;

    try {
      switch (action) {
        case "start": {
          if (receiverProcess) return { success: false, message: `❌ 已在运行 (PID: ${receiverProcess.pid}, 端口: ${receiverProcess.port})` };
          const port = (p.port as number) || 9876;
          const os = await import("os");
          const path = await import("path");
          const fs = await import("fs");
          const logFile = path.join(os.tmpdir(), `webhook-log-${port}.jsonl`);
          fs.writeFileSync(logFile, "");
          const script = generateReceiverScript(port, logFile);
          const scriptPath = path.join(os.tmpdir(), `webhook-receiver-${port}.js`);
          fs.writeFileSync(scriptPath, script);
          const { spawn } = await import("child_process");
          const child = spawn("node", [scriptPath], { detached: true, stdio: "ignore", windowsHide: true });
          child.unref();
          receiverProcess = { pid: child.pid!, port };
          return {
            success: true,
            message: `🟢 回调接收器已启动\n━━━━━━━━━━━━━━━━━━━━\n📡 地址: http://127.0.0.1:${port}\n🔢 PID: ${child.pid}\n📁 日志: ${logFile}\n\n💡 将此URL配置为Webhook回调地址，所有请求将被记录`,
            data: { pid: child.pid, port, logFile },
          };
        }

        case "stop": {
          if (!receiverProcess) return { success: true, message: "ℹ️ 无运行中的接收器" };
          try { process.kill(receiverProcess.pid); } catch { /* already exited */ }
          const info = `🔴 接收器已停止 (PID: ${receiverProcess.pid})`;
          receiverProcess = null;
          return { success: true, message: info };
        }

        case "list": {
          if (!receiverProcess) {
            const os = await import("os");
            const path = await import("path");
            const fs = await import("fs");
            const port = (p.port as number) || 9876;
            const logFile = path.join(os.tmpdir(), `webhook-log-${port}.jsonl`);
            if (fs.existsSync(logFile)) {
              const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean);
              for (const line of lines.slice(-MAX_ENTRIES)) {
                try { receivedHooks.push(JSON.parse(line)); } catch { /* skip */ }
              }
            }
          }

          const limit = Math.min((p.limit as number) || 20, 50);
          const recent = receivedHooks.slice(-limit).reverse();

          if (recent.length === 0) return { success: true, message: "📋 暂无收到的Webhook请求" };

          let msg = `📋 Webhook记录\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `📊 总计: ${receivedHooks.length} 条 | 显示最近 ${recent.length} 条\n\n`;
          for (const entry of recent) {
            msg += `🔹 [${entry.id}] ${entry.method} ${entry.path} — ${entry.timestamp.replace("T", " ").slice(0, 19)}\n`;
          }
          return { success: true, message: msg, data: { total: receivedHooks.length } };
        }

        case "detail": {
          if (!p.id) return { success: false, message: "❌ 请提供请求ID(id)" };
          const entry = receivedHooks.find((e) => e.id === p.id);
          if (!entry) return { success: false, message: `❌ 未找到ID: ${p.id}` };
          let msg = `📋 Webhook详情\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `🆔 ID: ${entry.id}\n⏰ 时间: ${entry.timestamp}\n`;
          msg += `📍 ${entry.method} ${entry.path}${entry.query}\n\n`;
          msg += `📨 Headers:\n${JSON.stringify(entry.headers, null, 2).slice(0, 500)}\n\n`;
          msg += `📦 Body:\n${entry.body.slice(0, 1000) || "(empty)"}`;
          return { success: true, message: msg, data: entry as unknown as Record<string, unknown> };
        }

        case "clear": {
          receivedHooks.length = 0;
          return { success: true, message: "🗑️ 所有Webhook记录已清空" };
        }

        default:
          return { success: false, message: `❌ 未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `❌ 操作失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
