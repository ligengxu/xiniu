import { z } from "zod";
import type { SkillDefinition } from "../types";
import {
  saveCredential,
  getCredential,
  listCredentials,
  deleteCredential,
  touchCredential,
} from "@/lib/credential-store";

const TG_API = "https://api.telegram.org";

async function tgRequest(
  token: string, method: string, params: Record<string, unknown> = {},
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    const hasFile = Object.values(params).some((v) => v instanceof Buffer || (typeof v === "object" && v !== null && "path" in (v as Record<string, unknown>)));

    let resp: Response;
    if (hasFile) {
      const form = new FormData();
      for (const [k, v] of Object.entries(params)) {
        if (v == null) continue;
        if (typeof v === "object" && "path" in (v as Record<string, unknown>)) {
          const fs = await import("fs");
          const filePath = (v as Record<string, string>).path;
          const blob = new Blob([fs.readFileSync(filePath)]);
          form.append(k, blob, filePath.split(/[/\\]/).pop() || "file");
        } else {
          form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
        }
      }
      resp = await fetch(`${TG_API}/bot${token}/${method}`, {
        method: "POST", body: form, signal: AbortSignal.timeout(30000),
      });
    } else {
      resp = await fetch(`${TG_API}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(20000),
      });
    }

    const result = await resp.json() as { ok: boolean; result?: unknown; description?: string };
    if (!result.ok) return { ok: false, error: result.description || `HTTP ${resp.status}` };
    return { ok: true, data: result.result as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function loadToken(inputToken?: string): Promise<{ ok: boolean; token?: string; message?: string }> {
  if (inputToken) {
    await saveCredential({
      type: "telegram",
      label: `Telegram Bot (${inputToken.slice(0, 8)}...)`,
      host: "api.telegram.org",
      port: 443,
      username: "bot",
      password: inputToken,
    });
    return { ok: true, token: inputToken };
  }

  const saved = await getCredential("telegram");
  if (saved) {
    await touchCredential(saved.id);
    return { ok: true, token: saved.password };
  }

  return { ok: false, message: "❌ 未配置 Telegram Bot Token。请提供 token 参数。\n\n💡 获取方法: 在 Telegram 中找 @BotFather → /newbot → 获取 Token" };
}

function formatMessage(msg: Record<string, unknown>): string {
  const from = msg.from as Record<string, unknown> | undefined;
  const chat = msg.chat as Record<string, unknown> | undefined;
  const fromName = from ? `${from.first_name || ""}${from.last_name ? " " + from.last_name : ""}` : "未知";
  const chatTitle = chat?.title || chat?.first_name || "私聊";
  const text = (msg.text || msg.caption || "(非文本消息)") as string;
  const date = msg.date ? new Date((msg.date as number) * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "";

  let type = "💬 文字";
  if (msg.photo) type = "🖼️ 图片";
  else if (msg.document) type = "📎 文件";
  else if (msg.video) type = "🎬 视频";
  else if (msg.audio) type = "🎵 音频";
  else if (msg.voice) type = "🎤 语音";
  else if (msg.sticker) type = "🎨 贴纸";
  else if (msg.location) type = "📍 位置";

  return `${type} [${chatTitle}] ${fromName}: ${text.slice(0, 200)}${text.length > 200 ? "..." : ""} (${date})`;
}

export const telegramBotSkill: SkillDefinition = {
  name: "telegram_bot",
  displayName: "电报机器人",
  description:
    "管理Telegram机器人：发送消息/图片/文件、获取消息更新、管理群组、设置webhook、创建内联键盘。" +
    "用户说'Telegram'、'电报'、'TG机器人'、'发Telegram消息'时使用。",
  icon: "Send",
  category: "life",
  setupGuide: {
    framework: "Telegram Bot API",
    frameworkUrl: "https://core.telegram.org/bots/api",
    configSteps: [
      "在 Telegram 中搜索 @BotFather 并发送 /newbot",
      "按提示设置 Bot 名称和用户名",
      "获取 Bot Token (格式: 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ)",
      "将 Token 作为 botToken 参数传入本技能",
      "首次使用后 Token 会加密保存到本地",
    ],
    requiredCredentials: [
      { key: "bot_token", label: "Bot Token", description: "从 @BotFather 获取的 Bot API Token" },
    ],
    healthCheckAction: "check_status",
    docsUrl: "https://core.telegram.org/bots#how-do-i-create-a-bot",
  },
  parameters: z.object({
    action: z.enum([
      "config", "list_saved", "delete_saved", "bot_info",
      "send_message", "send_photo", "send_document", "send_video",
      "get_updates", "get_chat", "get_members_count",
      "set_webhook", "delete_webhook", "get_webhook_info",
      "pin_message", "unpin_message", "delete_message",
      "edit_message", "forward_message",
      "ban_member", "unban_member", "get_chat_member",
      "set_chat_title", "set_chat_description",
      "create_invite_link",
    ]).describe(
      "操作: config=配置Token, bot_info=机器人信息, " +
      "send_message/send_photo/send_document/send_video=发送消息, " +
      "get_updates=获取新消息, get_chat=群信息, get_members_count=成员数, " +
      "set_webhook/delete_webhook/get_webhook_info=Webhook管理, " +
      "pin_message/unpin_message/delete_message/edit_message/forward_message=消息管理, " +
      "ban_member/unban_member/get_chat_member=成员管理, " +
      "set_chat_title/set_chat_description=群设置, create_invite_link=创建邀请链接"
    ),
    token: z.string().optional().describe("Bot Token (首次配置需要，之后自动使用)"),
    chatId: z.string().optional().describe("聊天/群组ID"),
    text: z.string().optional().describe("消息文本"),
    parseMode: z.enum(["HTML", "Markdown", "MarkdownV2"]).optional().describe("文本解析模式"),
    filePath: z.string().optional().describe("发送文件/图片/视频的本地路径"),
    fileUrl: z.string().optional().describe("发送文件/图片的URL"),
    caption: z.string().optional().describe("图片/文件/视频的说明文字"),
    messageId: z.number().optional().describe("消息ID (edit/delete/pin/forward时使用)"),
    toChatId: z.string().optional().describe("转发目标群ID (forward时使用)"),
    userId: z.number().optional().describe("用户ID (ban/unban/get_chat_member时使用)"),
    title: z.string().optional().describe("群标题 (set_chat_title时使用)"),
    description: z.string().optional().describe("群描述 (set_chat_description时使用)"),
    webhookUrl: z.string().optional().describe("Webhook URL"),
    replyMarkup: z.string().optional().describe("内联键盘JSON，格式: [[{\"text\":\"按钮\",\"callback_data\":\"data\"}]]"),
    limit: z.number().optional().describe("get_updates获取消息数量限制"),
    offset: z.number().optional().describe("get_updates的offset"),
    credentialId: z.string().optional().describe("delete_saved时的凭证ID"),
    disableNotification: z.boolean().optional().describe("静默发送(不通知对方)"),
  }),
  execute: async (params) => {
    const p = params as Record<string, unknown>;

    try {
      if (p.action === "list_saved") {
        const saved = await listCredentials("telegram");
        if (saved.length === 0) return { success: true, message: "📋 暂无保存的Telegram Bot Token" };
        let msg = `📋 已保存的Bot (${saved.length}个)\n━━━━━━━━━━━━━━━━━━━━\n`;
        for (const c of saved) {
          msg += `🤖 ${c.label}\n   ID: ${c.id} | 最后使用: ${c.lastUsedAt}\n\n`;
        }
        return { success: true, message: msg };
      }

      if (p.action === "delete_saved") {
        if (!p.credentialId) return { success: false, message: "❌ 需要 credentialId" };
        const ok = await deleteCredential(p.credentialId as string);
        return { success: ok, message: ok ? "✅ Token已删除" : "❌ 未找到凭证" };
      }

      const loaded = await loadToken(p.token as string | undefined);
      if (!loaded.ok || !loaded.token) return { success: false, message: loaded.message || "❌ Token加载失败" };
      const token = loaded.token;

      switch (p.action as string) {
        case "config":
        case "bot_info": {
          const res = await tgRequest(token, "getMe");
          if (!res.ok) return { success: false, message: `❌ Token无效: ${res.error}` };
          const bot = res.data!;
          let msg = `🤖 Bot 信息\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `名称: ${bot.first_name}\n`;
          msg += `用户名: @${bot.username}\n`;
          msg += `ID: ${bot.id}\n`;
          msg += `支持内联: ${bot.supports_inline_queries ? "是" : "否"}\n`;
          if (p.action === "config") msg += `\n💾 Token已加密保存`;
          return { success: true, message: msg, data: { bot } };
        }

        case "send_message": {
          if (!p.chatId) return { success: false, message: "❌ 请提供 chatId" };
          if (!p.text) return { success: false, message: "❌ 请提供 text" };
          const msgParams: Record<string, unknown> = {
            chat_id: p.chatId, text: p.text,
          };
          if (p.parseMode) msgParams.parse_mode = p.parseMode;
          if (p.disableNotification) msgParams.disable_notification = true;
          if (p.replyMarkup) {
            try { msgParams.reply_markup = { inline_keyboard: JSON.parse(p.replyMarkup as string) }; } catch {}
          }
          const res = await tgRequest(token, "sendMessage", msgParams);
          if (!res.ok) return { success: false, message: `❌ 发送失败: ${res.error}` };
          return { success: true, message: `✅ 消息已发送到 ${p.chatId}\n📝 ${(p.text as string).slice(0, 100)}` };
        }

        case "send_photo": {
          if (!p.chatId) return { success: false, message: "❌ 请提供 chatId" };
          const photoParams: Record<string, unknown> = { chat_id: p.chatId };
          if (p.filePath) photoParams.photo = { path: p.filePath };
          else if (p.fileUrl) photoParams.photo = p.fileUrl;
          else return { success: false, message: "❌ 请提供 filePath 或 fileUrl" };
          if (p.caption) photoParams.caption = p.caption;
          if (p.parseMode) photoParams.parse_mode = p.parseMode;
          const res = await tgRequest(token, "sendPhoto", photoParams);
          if (!res.ok) return { success: false, message: `❌ 发送图片失败: ${res.error}` };
          return { success: true, message: `✅ 图片已发送到 ${p.chatId}` };
        }

        case "send_document": {
          if (!p.chatId) return { success: false, message: "❌ 请提供 chatId" };
          const docParams: Record<string, unknown> = { chat_id: p.chatId };
          if (p.filePath) docParams.document = { path: p.filePath };
          else if (p.fileUrl) docParams.document = p.fileUrl;
          else return { success: false, message: "❌ 请提供 filePath 或 fileUrl" };
          if (p.caption) docParams.caption = p.caption;
          const res = await tgRequest(token, "sendDocument", docParams);
          if (!res.ok) return { success: false, message: `❌ 发送文件失败: ${res.error}` };
          return { success: true, message: `✅ 文件已发送到 ${p.chatId}` };
        }

        case "send_video": {
          if (!p.chatId) return { success: false, message: "❌ 请提供 chatId" };
          const vidParams: Record<string, unknown> = { chat_id: p.chatId };
          if (p.filePath) vidParams.video = { path: p.filePath };
          else if (p.fileUrl) vidParams.video = p.fileUrl;
          else return { success: false, message: "❌ 请提供 filePath 或 fileUrl" };
          if (p.caption) vidParams.caption = p.caption;
          const res = await tgRequest(token, "sendVideo", vidParams);
          if (!res.ok) return { success: false, message: `❌ 发送视频失败: ${res.error}` };
          return { success: true, message: `✅ 视频已发送到 ${p.chatId}` };
        }

        case "get_updates": {
          const updParams: Record<string, unknown> = { limit: (p.limit as number) || 10 };
          if (p.offset) updParams.offset = p.offset;
          const res = await tgRequest(token, "getUpdates", updParams);
          if (!res.ok) return { success: false, message: `❌ 获取消息失败: ${res.error}` };
          const updates = res.data as unknown as Array<Record<string, unknown>>;
          if (!Array.isArray(updates) || updates.length === 0) {
            return { success: true, message: "📭 暂无新消息" };
          }
          let msg = `📬 新消息 (${updates.length}条)\n━━━━━━━━━━━━━━━━━━━━\n\n`;
          for (const u of updates) {
            const m = (u.message || u.edited_message || u.channel_post) as Record<string, unknown> | undefined;
            if (m) msg += `${formatMessage(m)}\n`;
          }
          const lastId = (updates[updates.length - 1] as Record<string, unknown>).update_id as number;
          msg += `\n💡 下次获取请设置 offset: ${lastId + 1}`;
          return { success: true, message: msg, data: { count: updates.length, lastUpdateId: lastId } };
        }

        case "get_chat": {
          if (!p.chatId) return { success: false, message: "❌ 请提供 chatId" };
          const res = await tgRequest(token, "getChat", { chat_id: p.chatId });
          if (!res.ok) return { success: false, message: `❌ 获取群信息失败: ${res.error}` };
          const chat = res.data!;
          let msg = `💬 群信息\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `标题: ${chat.title || chat.first_name || "私聊"}\n`;
          msg += `类型: ${chat.type}\n`;
          msg += `ID: ${chat.id}\n`;
          if (chat.username) msg += `用户名: @${chat.username}\n`;
          if (chat.description) msg += `描述: ${(chat.description as string).slice(0, 200)}\n`;
          if (chat.invite_link) msg += `邀请链接: ${chat.invite_link}\n`;
          return { success: true, message: msg, data: { chat } };
        }

        case "get_members_count": {
          if (!p.chatId) return { success: false, message: "❌ 请提供 chatId" };
          const res = await tgRequest(token, "getChatMemberCount", { chat_id: p.chatId });
          if (!res.ok) return { success: false, message: `❌ 获取成员数失败: ${res.error}` };
          return { success: true, message: `👥 群 ${p.chatId} 共有 ${res.data} 名成员`, data: { count: res.data } };
        }

        case "set_webhook": {
          if (!p.webhookUrl) return { success: false, message: "❌ 请提供 webhookUrl" };
          const res = await tgRequest(token, "setWebhook", { url: p.webhookUrl });
          return { success: res.ok, message: res.ok ? `✅ Webhook已设置: ${p.webhookUrl}` : `❌ 设置失败: ${res.error}` };
        }

        case "delete_webhook": {
          const res = await tgRequest(token, "deleteWebhook");
          return { success: res.ok, message: res.ok ? "✅ Webhook已删除" : `❌ 删除失败: ${res.error}` };
        }

        case "get_webhook_info": {
          const res = await tgRequest(token, "getWebhookInfo");
          if (!res.ok) return { success: false, message: `❌ 获取Webhook信息失败: ${res.error}` };
          const info = res.data!;
          let msg = `🔗 Webhook 信息\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `URL: ${info.url || "(未设置)"}\n`;
          msg += `待处理: ${info.pending_update_count || 0}\n`;
          if (info.last_error_date) msg += `最后错误: ${info.last_error_message}\n`;
          return { success: true, message: msg, data: { webhook: info } };
        }

        case "pin_message": {
          if (!p.chatId || !p.messageId) return { success: false, message: "❌ 需要 chatId 和 messageId" };
          const res = await tgRequest(token, "pinChatMessage", { chat_id: p.chatId, message_id: p.messageId });
          return { success: res.ok, message: res.ok ? "📌 消息已置顶" : `❌ 置顶失败: ${res.error}` };
        }

        case "unpin_message": {
          if (!p.chatId) return { success: false, message: "❌ 需要 chatId" };
          const unpinParams: Record<string, unknown> = { chat_id: p.chatId };
          if (p.messageId) unpinParams.message_id = p.messageId;
          const res = await tgRequest(token, "unpinChatMessage", unpinParams);
          return { success: res.ok, message: res.ok ? "📌 已取消置顶" : `❌ 取消失败: ${res.error}` };
        }

        case "delete_message": {
          if (!p.chatId || !p.messageId) return { success: false, message: "❌ 需要 chatId 和 messageId" };
          const res = await tgRequest(token, "deleteMessage", { chat_id: p.chatId, message_id: p.messageId });
          return { success: res.ok, message: res.ok ? "🗑️ 消息已删除" : `❌ 删除失败: ${res.error}` };
        }

        case "edit_message": {
          if (!p.chatId || !p.messageId || !p.text) return { success: false, message: "❌ 需要 chatId、messageId 和 text" };
          const editParams: Record<string, unknown> = { chat_id: p.chatId, message_id: p.messageId, text: p.text };
          if (p.parseMode) editParams.parse_mode = p.parseMode;
          if (p.replyMarkup) {
            try { editParams.reply_markup = { inline_keyboard: JSON.parse(p.replyMarkup as string) }; } catch {}
          }
          const res = await tgRequest(token, "editMessageText", editParams);
          return { success: res.ok, message: res.ok ? "✏️ 消息已编辑" : `❌ 编辑失败: ${res.error}` };
        }

        case "forward_message": {
          if (!p.chatId || !p.toChatId || !p.messageId) return { success: false, message: "❌ 需要 chatId(来源)、toChatId(目标) 和 messageId" };
          const res = await tgRequest(token, "forwardMessage", { chat_id: p.toChatId, from_chat_id: p.chatId, message_id: p.messageId });
          return { success: res.ok, message: res.ok ? `↗️ 消息已转发到 ${p.toChatId}` : `❌ 转发失败: ${res.error}` };
        }

        case "ban_member": {
          if (!p.chatId || !p.userId) return { success: false, message: "❌ 需要 chatId 和 userId" };
          const res = await tgRequest(token, "banChatMember", { chat_id: p.chatId, user_id: p.userId });
          return { success: res.ok, message: res.ok ? `🚫 用户 ${p.userId} 已被封禁` : `❌ 封禁失败: ${res.error}` };
        }

        case "unban_member": {
          if (!p.chatId || !p.userId) return { success: false, message: "❌ 需要 chatId 和 userId" };
          const res = await tgRequest(token, "unbanChatMember", { chat_id: p.chatId, user_id: p.userId, only_if_banned: true });
          return { success: res.ok, message: res.ok ? `✅ 用户 ${p.userId} 已解封` : `❌ 解封失败: ${res.error}` };
        }

        case "get_chat_member": {
          if (!p.chatId || !p.userId) return { success: false, message: "❌ 需要 chatId 和 userId" };
          const res = await tgRequest(token, "getChatMember", { chat_id: p.chatId, user_id: p.userId });
          if (!res.ok) return { success: false, message: `❌ 获取成员信息失败: ${res.error}` };
          const member = res.data!;
          const user = member.user as Record<string, unknown>;
          let msg = `👤 成员信息\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `名称: ${user.first_name}${user.last_name ? " " + user.last_name : ""}\n`;
          if (user.username) msg += `用户名: @${user.username}\n`;
          msg += `状态: ${member.status}\n`;
          return { success: true, message: msg, data: { member } };
        }

        case "set_chat_title": {
          if (!p.chatId || !p.title) return { success: false, message: "❌ 需要 chatId 和 title" };
          const res = await tgRequest(token, "setChatTitle", { chat_id: p.chatId, title: p.title });
          return { success: res.ok, message: res.ok ? `✅ 群标题已改为: ${p.title}` : `❌ 修改失败: ${res.error}` };
        }

        case "set_chat_description": {
          if (!p.chatId) return { success: false, message: "❌ 需要 chatId" };
          const res = await tgRequest(token, "setChatDescription", { chat_id: p.chatId, description: p.description || "" });
          return { success: res.ok, message: res.ok ? "✅ 群描述已更新" : `❌ 修改失败: ${res.error}` };
        }

        case "create_invite_link": {
          if (!p.chatId) return { success: false, message: "❌ 需要 chatId" };
          const res = await tgRequest(token, "createChatInviteLink", { chat_id: p.chatId });
          if (!res.ok) return { success: false, message: `❌ 创建邀请链接失败: ${res.error}` };
          const link = res.data!;
          return { success: true, message: `🔗 邀请链接: ${link.invite_link}`, data: { link } };
        }

        default:
          return { success: false, message: `❌ 未知操作: ${p.action}` };
      }
    } catch (err) {
      return { success: false, message: `Telegram操作异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
