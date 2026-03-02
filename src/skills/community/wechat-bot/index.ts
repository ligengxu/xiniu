import { z } from "zod";
import type { SkillDefinition } from "../types";

const DEFAULT_API = "http://127.0.0.1:9999";

interface WxConfig {
  apiBase: string;
}

function getConfig(params: Record<string, unknown>): WxConfig {
  return {
    apiBase: ((params.apiBase as string) || DEFAULT_API).replace(/\/+$/, ""),
  };
}

async function wxApi(
  cfg: WxConfig,
  path: string,
  method: "GET" | "POST" = "POST",
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `${cfg.apiBase}${path}`;
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
  };
  if (body && method === "POST") opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => "")}`);
  return (await resp.json()) as Record<string, unknown>;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "..." : text;
}

function connErrMsg(cfg: WxConfig, detail: string): string {
  return (
    `❌ 无法连接微信机器人\n━━━━━━━━━━━━━━━━━━━━\n` +
    `📡 API: ${cfg.apiBase}\n🔴 ${detail}\n\n` +
    `💡 请按以下步骤操作:\n` +
    `1. 安装 wcfhttp: pip install --upgrade wcfhttp\n` +
    `2. 确保微信 PC 端已登录\n` +
    `3. 启动服务: wcfhttp -cb http://your_host:port/callback\n` +
    `4. 默认监听端口 9999，文档: http://127.0.0.1:9999/docs\n\n` +
    `📦 项目地址: https://github.com/lich0821/WeChatFerry`
  );
}

export const wechatBotSkill: SkillDefinition = {
  name: "wechat_bot",
  displayName: "微信机器人",
  description:
    "微信机器人：收发消息、群管理、联系人搜索、消息转发、数据库查询。" +
    "基于WeChatFerry(wcfhttp)，默认端口9999。" +
    "用户说'微信机器人'、'微信消息'、'微信群管理'、'微信自动回复'、'wcferry'、'wcfhttp'时使用。",
  icon: "MessageCircle",
  category: "life",
  setupGuide: {
    framework: "WeChatFerry (wcfhttp)",
    frameworkUrl: "https://github.com/lich0821/WeChatFerry",
    installCommands: [
      { label: "安装 wcfhttp", cmd: "pip install --upgrade wcfhttp", mirror: "pip install --upgrade wcfhttp -i https://pypi.tuna.tsinghua.edu.cn/simple" },
    ],
    configSteps: [
      "安装 Python 3.9+ 环境",
      "运行 pip install wcfhttp 安装服务端",
      "确保微信 PC 端已登录",
      "运行 wcfhttp 启动 HTTP 服务 (默认端口 9999)",
      "访问 http://127.0.0.1:9999/docs 验证服务正常",
    ],
    healthCheckAction: "check_status",
    docsUrl: "https://wechatferry.readthedocs.io/",
  },
  parameters: z.object({
    action: z.enum([
      "check_status",
      "login_info",
      "contacts",
      "search_contact",
      "send_text",
      "send_image",
      "send_file",
      "send_emotion",
      "send_rich_text",
      "send_pat",
      "forward",
      "revoke",
      "chatroom_members",
      "add_member",
      "remove_member",
      "hook_msg",
      "unhook_msg",
      "download_attach",
      "decode_image",
      "db_list",
      "query_db",
    ]).describe("操作类型"),
    wxid: z.string().optional().describe("接收者wxid（发消息/转发时需要）"),
    content: z.string().optional().describe("消息内容 / SQL语句 / 搜索关键词"),
    filePath: z.string().optional().describe("文件/图片路径"),
    chatRoomId: z.string().optional().describe("群ID（群操作时需要）"),
    memberIds: z.array(z.string()).optional().describe("成员wxid列表"),
    msgId: z.string().optional().describe("消息ID（转发/撤回/下载时需要）"),
    dbName: z.string().optional().describe("数据库名（db_list获取后使用）"),
    hookUrl: z.string().optional().describe("消息回调URL"),
    apiBase: z.string().optional().describe("wcfhttp地址，默认http://127.0.0.1:9999"),
    storeDir: z.string().optional().describe("图片解密保存目录"),
    atWxids: z.array(z.string()).optional().describe("@的成员wxid列表（send_text群消息时）"),
    extra: z.string().optional().describe("附加数据（download_attach时用extra字段）"),
  }),
  execute: async (params) => {
    const p = params as Record<string, unknown>;
    const action = p.action as string;
    const cfg = getConfig(p);

    try {
      switch (action) {
        case "check_status": {
          try {
            const info = await wxApi(cfg, "/userinfo", "GET");
            return {
              success: true,
              message: `✅ wcfhttp 已连接\n━━━━━━━━━━━━━━━━━━━━\n📡 ${cfg.apiBase}\n👤 ${JSON.stringify(info, null, 2).slice(0, 500)}`,
              data: info,
            };
          } catch {
            return { success: false, message: connErrMsg(cfg, "服务未响应") };
          }
        }

        case "login_info": {
          const res = await wxApi(cfg, "/userinfo", "GET");
          let msg = `👤 微信登录信息\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `wxid: ${res.wxid || "未知"}\n`;
          msg += `昵称: ${res.name || "未知"}\n`;
          msg += `手机: ${res.mobile || "未知"}\n`;
          msg += `数据目录: ${res.home || "未知"}`;
          return { success: true, message: msg, data: res };
        }

        case "contacts": {
          const res = await wxApi(cfg, "/contacts", "GET");
          const contacts = (res as unknown as Array<Record<string, unknown>>) || [];
          const list = Array.isArray(contacts) ? contacts : (res.data as Array<Record<string, unknown>>) || [];
          let msg = `📒 联系人列表 (共 ${list.length} 个)\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const c of list.slice(0, 30)) {
            msg += `• ${c.name || c.remark || ""} — ${c.wxid || ""}\n`;
          }
          if (list.length > 30) msg += `\n... 还有 ${list.length - 30} 个`;
          return { success: true, message: msg, data: { total: list.length } };
        }

        case "search_contact": {
          if (!p.content) return { success: false, message: "❌ 请提供搜索关键词(content)" };
          const res = await wxApi(cfg, "/contacts", "GET");
          const all = Array.isArray(res) ? res : (res.data as Array<Record<string, unknown>>) || [];
          const kw = (p.content as string).toLowerCase();
          const matched = (all as Array<Record<string, unknown>>).filter((c) => {
            return (
              String(c.name || "").toLowerCase().includes(kw) ||
              String(c.wxid || "").toLowerCase().includes(kw) ||
              String(c.remark || "").toLowerCase().includes(kw)
            );
          });
          if (!matched.length) return { success: true, message: `🔍 未找到匹配 "${p.content}" 的联系人` };
          let msg = `🔍 搜索 "${p.content}" — ${matched.length} 个结果\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const c of matched.slice(0, 30)) msg += `• ${c.name || ""} — ${c.wxid || ""}\n`;
          return { success: true, message: msg };
        }

        case "send_text": {
          if (!p.wxid) return { success: false, message: "❌ 请提供wxid" };
          if (!p.content) return { success: false, message: "❌ 请提供消息内容(content)" };
          const body: Record<string, unknown> = { msg: p.content, receiver: p.wxid };
          if (p.atWxids && (p.atWxids as string[]).length > 0) {
            body.aters = (p.atWxids as string[]).join(",");
          }
          const res = await wxApi(cfg, "/text", "POST", body);
          return {
            success: true,
            message: `✅ 文本已发送\n📤 → ${p.wxid}\n💬 ${truncate(p.content as string, 100)}`,
            data: res,
          };
        }

        case "send_image": {
          if (!p.wxid) return { success: false, message: "❌ 请提供wxid" };
          if (!p.filePath) return { success: false, message: "❌ 请提供图片路径(filePath)" };
          const res = await wxApi(cfg, "/image", "POST", { path: p.filePath, receiver: p.wxid });
          return { success: true, message: `✅ 图片已发送 → ${p.wxid}`, data: res };
        }

        case "send_file": {
          if (!p.wxid) return { success: false, message: "❌ 请提供wxid" };
          if (!p.filePath) return { success: false, message: "❌ 请提供文件路径(filePath)" };
          const res = await wxApi(cfg, "/file", "POST", { path: p.filePath, receiver: p.wxid });
          return { success: true, message: `✅ 文件已发送 → ${p.wxid}\n📎 ${p.filePath}`, data: res };
        }

        case "send_emotion": {
          if (!p.wxid) return { success: false, message: "❌ 请提供wxid" };
          if (!p.filePath) return { success: false, message: "❌ 请提供表情路径(filePath)" };
          const res = await wxApi(cfg, "/emotion", "POST", { path: p.filePath, receiver: p.wxid });
          return { success: true, message: `✅ 表情已发送 → ${p.wxid}`, data: res };
        }

        case "send_rich_text": {
          if (!p.wxid) return { success: false, message: "❌ 请提供wxid" };
          if (!p.content) return { success: false, message: "❌ 请提供富文本XML(content)" };
          const res = await wxApi(cfg, "/rich-text", "POST", { content: p.content, receiver: p.wxid });
          return { success: true, message: `✅ 富文本已发送 → ${p.wxid}`, data: res };
        }

        case "send_pat": {
          if (!p.chatRoomId) return { success: false, message: "❌ 请提供群ID(chatRoomId)" };
          if (!p.wxid) return { success: false, message: "❌ 请提供拍一拍目标wxid" };
          const res = await wxApi(cfg, "/pat", "POST", { roomid: p.chatRoomId, wxid: p.wxid });
          return { success: true, message: `✅ 已拍 ${p.wxid} @ ${p.chatRoomId}`, data: res };
        }

        case "forward": {
          if (!p.wxid) return { success: false, message: "❌ 请提供wxid" };
          if (!p.msgId) return { success: false, message: "❌ 请提供消息ID(msgId)" };
          const res = await wxApi(cfg, "/forward-msg", "POST", { id: Number(p.msgId), receiver: p.wxid });
          return { success: true, message: `✅ 消息已转发 → ${p.wxid}\n📋 msgId: ${p.msgId}`, data: res };
        }

        case "revoke": {
          if (!p.msgId) return { success: false, message: "❌ 请提供消息ID(msgId)" };
          const res = await wxApi(cfg, "/revoke-msg", "POST", { id: Number(p.msgId) });
          return { success: true, message: `✅ 消息已撤回 (ID: ${p.msgId})`, data: res };
        }

        case "chatroom_members": {
          if (!p.chatRoomId) return { success: false, message: "❌ 请提供群ID(chatRoomId)" };
          const res = await wxApi(cfg, "/chatroom-member", "POST", { roomid: p.chatRoomId });
          return {
            success: true,
            message: `👥 群成员\n━━━━━━━━━━━━━━━━━━━━\n群: ${p.chatRoomId}\n${JSON.stringify(res, null, 2).slice(0, 800)}`,
            data: res,
          };
        }

        case "add_member": {
          if (!p.chatRoomId) return { success: false, message: "❌ 请提供群ID" };
          if (!p.memberIds?.length) return { success: false, message: "❌ 请提供成员wxid列表(memberIds)" };
          const res = await wxApi(cfg, "/invite-chatroom-member", "POST", {
            roomid: p.chatRoomId,
            wxids: (p.memberIds as string[]).join(","),
          });
          return { success: true, message: `✅ 已邀请 ${(p.memberIds as string[]).length} 人进群`, data: res };
        }

        case "remove_member": {
          if (!p.chatRoomId) return { success: false, message: "❌ 请提供群ID" };
          if (!p.memberIds?.length) return { success: false, message: "❌ 请提供成员wxid列表(memberIds)" };
          const res = await wxApi(cfg, "/del-chatroom-member", "POST", {
            roomid: p.chatRoomId,
            wxids: (p.memberIds as string[]).join(","),
          });
          return { success: true, message: `✅ 已移除 ${(p.memberIds as string[]).length} 人`, data: res };
        }

        case "hook_msg": {
          if (!p.hookUrl) return { success: false, message: "❌ 请提供回调URL(hookUrl)" };
          const res = await wxApi(cfg, "/msg-cb", "POST", { url: p.hookUrl });
          return { success: true, message: `✅ 消息回调已设置\n📡 → ${p.hookUrl}`, data: res };
        }

        case "unhook_msg": {
          const res = await wxApi(cfg, "/msg-cb", "POST", { url: "" });
          return { success: true, message: `✅ 消息回调已关闭`, data: res };
        }

        case "download_attach": {
          if (!p.msgId) return { success: false, message: "❌ 请提供消息ID(msgId)" };
          const body: Record<string, unknown> = { id: Number(p.msgId) };
          if (p.extra) body.extra = p.extra;
          const res = await wxApi(cfg, "/download-attach", "POST", body);
          return { success: true, message: `✅ 附件下载已触发 (ID: ${p.msgId})`, data: res };
        }

        case "decode_image": {
          if (!p.filePath) return { success: false, message: "❌ 请提供.dat图片路径(filePath)" };
          const dir = (p.storeDir as string) || "C:\\Users\\Administrator\\Desktop\\output-wx-images";
          const res = await wxApi(cfg, "/decode-image", "POST", { src: p.filePath, dir });
          return { success: true, message: `✅ 图片已解密\n📁 保存到: ${dir}`, data: res };
        }

        case "db_list": {
          const res = await wxApi(cfg, "/dbs", "GET");
          return {
            success: true,
            message: `🗄️ 数据库列表\n━━━━━━━━━━━━━━━━━━━━\n${JSON.stringify(res, null, 2).slice(0, 800)}`,
            data: res,
          };
        }

        case "query_db": {
          if (!p.dbName) return { success: false, message: "❌ 请提供数据库名(dbName，从db_list获取)" };
          if (!p.content) return { success: false, message: "❌ 请提供SQL语句(content)" };
          const res = await wxApi(cfg, "/sql", "POST", { db: p.dbName, sql: p.content });
          return {
            success: true,
            message: `📊 查询结果\n━━━━━━━━━━━━━━━━━━━━\n库: ${p.dbName}\nSQL: ${truncate(p.content as string, 80)}\n\n${JSON.stringify(res, null, 2).slice(0, 1000)}`,
            data: res,
          };
        }

        default:
          return { success: false, message: `❌ 未知操作: ${action}` };
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("ECONNREFUSED") || errMsg.includes("fetch failed") || errMsg.includes("abort")) {
        return { success: false, message: connErrMsg(cfg, errMsg) };
      }
      return { success: false, message: `❌ 操作失败: ${errMsg}` };
    }
  },
};
