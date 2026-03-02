import { z } from "zod";
import type { SkillDefinition } from "../types";
import {
  saveCredential,
  getCredential,
  listCredentials,
  deleteCredential,
  touchCredential,
} from "@/lib/credential-store";

const FEISHU_API = "https://open.feishu.cn/open-apis";

interface FeishuConfig {
  appId: string;
  appSecret: string;
  tenantToken?: string;
  tokenExpires?: number;
}

const tokenCache: { appId: string; token: string; expiresAt: number } = { appId: "", token: "", expiresAt: 0 };

async function getTenantToken(appId: string, appSecret: string): Promise<{ ok: boolean; token?: string; error?: string }> {
  if (tokenCache.appId === appId && tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return { ok: true, token: tokenCache.token };
  }
  try {
    const resp = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await resp.json() as { code: number; msg: string; tenant_access_token?: string; expire?: number };
    if (data.code !== 0) return { ok: false, error: data.msg };
    tokenCache.appId = appId;
    tokenCache.token = data.tenant_access_token || "";
    tokenCache.expiresAt = Date.now() + ((data.expire || 7200) - 300) * 1000;
    return { ok: true, token: data.tenant_access_token };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function feishuRequest(
  token: string, method: string, path: string, body?: Record<string, unknown>,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    const opts: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(20000),
    };
    if (body && method !== "GET") opts.body = JSON.stringify(body);

    const resp = await fetch(`${FEISHU_API}${path}`, opts);
    const result = await resp.json() as { code: number; msg: string; data?: Record<string, unknown> };

    if (result.code !== 0) return { ok: false, error: `[${result.code}] ${result.msg}` };
    return { ok: true, data: result.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function loadConfig(
  appId?: string, appSecret?: string,
): Promise<{ ok: boolean; config?: FeishuConfig; token?: string; message?: string }> {
  let id = appId || "";
  let secret = appSecret || "";

  if (!id || !secret) {
    const saved = await getCredential("feishu");
    if (saved) {
      await touchCredential(saved.id);
      id = saved.username;
      secret = saved.password;
    } else {
      return {
        ok: false,
        message: "❌ 未配置飞书应用凭证。请提供 appId 和 appSecret 参数。\n\n💡 获取方法:\n1. 前往 open.feishu.cn → 创建应用\n2. 在应用凭证页获取 App ID 和 App Secret",
      };
    }
  }

  const tokenRes = await getTenantToken(id, secret);
  if (!tokenRes.ok) return { ok: false, message: `❌ 获取Token失败: ${tokenRes.error}` };

  await saveCredential({
    type: "feishu",
    label: `飞书应用 (${id.slice(0, 6)}...)`,
    host: "open.feishu.cn",
    port: 443,
    username: id,
    password: secret,
  });

  return {
    ok: true,
    config: { appId: id, appSecret: secret, tenantToken: tokenRes.token },
    token: tokenRes.token,
  };
}

async function sendWebhookMessage(webhookUrl: string, msgType: string, content: Record<string, unknown>): Promise<string> {
  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msg_type: msgType, content }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await resp.json() as { code?: number; StatusCode?: number; msg?: string };
    if ((data.code ?? data.StatusCode) === 0) return "✅ Webhook消息已发送";
    return `❌ 发送失败: ${data.msg || JSON.stringify(data)}`;
  } catch (err) {
    return `❌ 发送失败: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export const feishuBotSkill: SkillDefinition = {
  name: "feishu_bot",
  displayName: "飞书机器人",
  description:
    "飞书开放平台机器人：发送消息（文本/富文本/卡片）、Webhook推送、群管理、用户查询、审批操作、日历管理、多维表格操作。" +
    "用户说'飞书'、'lark'、'飞书机器人'、'飞书消息'、'飞书审批'、'飞书表格'时使用。",
  icon: "MessageCircle",
  category: "office",
  setupGuide: {
    framework: "飞书开放平台",
    frameworkUrl: "https://open.feishu.cn/",
    configSteps: [
      "前往 open.feishu.cn 创建企业自建应用",
      "在应用凭证页获取 App ID 和 App Secret",
      "在权限管理中开通所需权限 (消息/通讯录/审批等)",
      "将应用发布上线并安装到目标企业/群组",
      "使用 config 操作保存 appId 和 appSecret",
    ],
    requiredCredentials: [
      { key: "app_id", label: "App ID", description: "飞书开放平台应用 App ID" },
      { key: "app_secret", label: "App Secret", description: "飞书开放平台应用 App Secret" },
    ],
    healthCheckAction: "config",
    docsUrl: "https://open.feishu.cn/document/server-docs/getting-started/getting-started",
  },
  parameters: z.object({
    action: z.enum([
      "config", "list_saved", "delete_saved",
      "send_text", "send_rich", "send_card", "webhook",
      "list_chats", "get_chat", "create_chat",
      "add_members", "remove_members", "list_members",
      "get_user", "search_user",
      "list_approvals", "get_approval", "approve", "reject",
      "list_calendars", "create_event", "list_events",
      "list_tables", "list_records", "add_record", "update_record",
    ]).describe(
      "操作: config=配置凭证, send_text/send_rich/send_card=发消息, webhook=Webhook推送, " +
      "list_chats/get_chat/create_chat=群管理, add_members/remove_members/list_members=群成员, " +
      "get_user/search_user=用户查询, " +
      "list_approvals/get_approval/approve/reject=审批, " +
      "list_calendars/create_event/list_events=日历, " +
      "list_tables/list_records/add_record/update_record=多维表格"
    ),
    appId: z.string().optional().describe("飞书App ID (首次配置需要)"),
    appSecret: z.string().optional().describe("飞书App Secret (首次配置需要)"),
    chatId: z.string().optional().describe("群聊ID"),
    userId: z.string().optional().describe("用户ID (open_id/user_id/union_id)"),
    userIdType: z.enum(["open_id", "user_id", "union_id"]).optional().describe("用户ID类型，默认open_id"),
    receiveIdType: z.enum(["open_id", "user_id", "union_id", "email", "chat_id"]).optional().describe("接收者ID类型"),
    receiveId: z.string().optional().describe("接收者ID"),
    text: z.string().optional().describe("消息文本"),
    title: z.string().optional().describe("富文本标题 / 群名称 / 日历事件标题"),
    content: z.string().optional().describe("富文本JSON内容 / 卡片JSON"),
    webhookUrl: z.string().optional().describe("Webhook地址"),
    userIds: z.array(z.string()).optional().describe("用户ID列表 (add/remove members)"),
    keyword: z.string().optional().describe("搜索关键词"),
    approvalCode: z.string().optional().describe("审批定义code"),
    instanceId: z.string().optional().describe("审批实例ID"),
    comment: z.string().optional().describe("审批意见"),
    calendarId: z.string().optional().describe("日历ID"),
    startTime: z.string().optional().describe("事件开始时间 (ISO 8601)"),
    endTime: z.string().optional().describe("事件结束时间 (ISO 8601)"),
    description: z.string().optional().describe("事件/群描述"),
    appToken: z.string().optional().describe("多维表格app_token"),
    tableId: z.string().optional().describe("多维表格table_id"),
    fields: z.record(z.unknown()).optional().describe("多维表格记录字段"),
    recordId: z.string().optional().describe("多维表格记录ID"),
    credentialId: z.string().optional().describe("凭证ID (delete_saved)"),
  }),
  execute: async (params) => {
    const p = params as Record<string, unknown>;

    try {
      if (p.action === "list_saved") {
        const saved = await listCredentials("feishu");
        if (saved.length === 0) return { success: true, message: "📋 暂无保存的飞书凭证" };
        let msg = `📋 已保存的飞书应用 (${saved.length}个)\n━━━━━━━━━━━━━━━━━━━━\n`;
        for (const c of saved) msg += `🔑 ${c.label}\n   ID: ${c.id} | 最后使用: ${c.lastUsedAt}\n\n`;
        return { success: true, message: msg };
      }

      if (p.action === "delete_saved") {
        if (!p.credentialId) return { success: false, message: "❌ 需要 credentialId" };
        const ok = await deleteCredential(p.credentialId as string);
        return { success: ok, message: ok ? "✅ 飞书凭证已删除" : "❌ 未找到凭证" };
      }

      if (p.action === "webhook") {
        if (!p.webhookUrl) return { success: false, message: "❌ 请提供 webhookUrl" };
        if (!p.text) return { success: false, message: "❌ 请提供 text" };
        const msg = await sendWebhookMessage(p.webhookUrl as string, "text", { text: p.text });
        return { success: msg.startsWith("✅"), message: msg };
      }

      const loaded = await loadConfig(p.appId as string | undefined, p.appSecret as string | undefined);
      if (!loaded.ok || !loaded.token) return { success: false, message: loaded.message || "❌ 配置加载失败" };
      const token = loaded.token;

      switch (p.action as string) {
        case "config": {
          return {
            success: true,
            message: `✅ 飞书应用配置成功\n━━━━━━━━━━━━━━━━━━━━\n🔑 App ID: ${loaded.config!.appId.slice(0, 6)}...\n💾 凭证已加密保存\n✅ Token获取成功`,
          };
        }

        case "send_text": {
          const receiveIdType = (p.receiveIdType || "chat_id") as string;
          const receiveId = (p.receiveId || p.chatId) as string;
          if (!receiveId) return { success: false, message: "❌ 请提供 receiveId 或 chatId" };
          if (!p.text) return { success: false, message: "❌ 请提供 text" };
          const res = await feishuRequest(token, "POST", `/im/v1/messages?receive_id_type=${receiveIdType}`, {
            receive_id: receiveId,
            msg_type: "text",
            content: JSON.stringify({ text: p.text }),
          });
          return { success: res.ok, message: res.ok ? `✅ 文本消息已发送到 ${receiveId}` : `❌ 发送失败: ${res.error}` };
        }

        case "send_rich": {
          const receiveIdType = (p.receiveIdType || "chat_id") as string;
          const receiveId = (p.receiveId || p.chatId) as string;
          if (!receiveId || !p.content) return { success: false, message: "❌ 请提供 receiveId/chatId 和 content (富文本JSON)" };
          const postContent = typeof p.content === "string" ? p.content : JSON.stringify(p.content);
          const res = await feishuRequest(token, "POST", `/im/v1/messages?receive_id_type=${receiveIdType}`, {
            receive_id: receiveId,
            msg_type: "post",
            content: postContent,
          });
          return { success: res.ok, message: res.ok ? `✅ 富文本消息已发送` : `❌ 发送失败: ${res.error}` };
        }

        case "send_card": {
          const receiveIdType = (p.receiveIdType || "chat_id") as string;
          const receiveId = (p.receiveId || p.chatId) as string;
          if (!receiveId || !p.content) return { success: false, message: "❌ 请提供 receiveId/chatId 和 content (卡片JSON)" };
          const res = await feishuRequest(token, "POST", `/im/v1/messages?receive_id_type=${receiveIdType}`, {
            receive_id: receiveId,
            msg_type: "interactive",
            content: typeof p.content === "string" ? p.content : JSON.stringify(p.content),
          });
          return { success: res.ok, message: res.ok ? `✅ 卡片消息已发送` : `❌ 发送失败: ${res.error}` };
        }

        case "list_chats": {
          const res = await feishuRequest(token, "GET", "/im/v1/chats?page_size=50");
          if (!res.ok) return { success: false, message: `❌ 获取群列表失败: ${res.error}` };
          const items = (res.data?.items as Array<Record<string, unknown>>) || [];
          if (items.length === 0) return { success: true, message: "📋 机器人未加入任何群聊" };
          let msg = `📋 群聊列表 (${items.length}个)\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const chat of items) {
            msg += `💬 ${chat.name} (${chat.chat_id})\n   类型: ${chat.chat_type} | 成员: ${chat.member_count || "?"}人\n\n`;
          }
          return { success: true, message: msg, data: { chats: items } };
        }

        case "get_chat": {
          if (!p.chatId) return { success: false, message: "❌ 请提供 chatId" };
          const res = await feishuRequest(token, "GET", `/im/v1/chats/${p.chatId}`);
          if (!res.ok) return { success: false, message: `❌ 获取群信息失败: ${res.error}` };
          let msg = `💬 群聊详情\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `名称: ${res.data?.name}\n`;
          msg += `ID: ${p.chatId}\n`;
          msg += `描述: ${res.data?.description || "(无)"}\n`;
          msg += `成员数: ${res.data?.member_count || "?"}\n`;
          msg += `群主: ${res.data?.owner_id || "未知"}\n`;
          return { success: true, message: msg, data: { chat: res.data } };
        }

        case "create_chat": {
          if (!p.title) return { success: false, message: "❌ 请提供群名称 (title 参数)" };
          const res = await feishuRequest(token, "POST", "/im/v1/chats", {
            name: p.title,
            description: (p.description as string) || "",
          });
          if (!res.ok) return { success: false, message: `❌ 创建群失败: ${res.error}` };
          return { success: true, message: `✅ 群聊已创建: ${p.title}\nID: ${res.data?.chat_id}`, data: { chatId: res.data?.chat_id } };
        }

        case "add_members": {
          if (!p.chatId || !p.userIds) return { success: false, message: "❌ 需要 chatId 和 userIds" };
          const idType = (p.userIdType || "open_id") as string;
          const res = await feishuRequest(token, "POST", `/im/v1/chats/${p.chatId}/members?member_id_type=${idType}`, {
            id_list: p.userIds,
          });
          return { success: res.ok, message: res.ok ? `✅ 已添加 ${(p.userIds as string[]).length} 位成员` : `❌ 添加失败: ${res.error}` };
        }

        case "remove_members": {
          if (!p.chatId || !p.userIds) return { success: false, message: "❌ 需要 chatId 和 userIds" };
          const idType = (p.userIdType || "open_id") as string;
          const res = await feishuRequest(token, "DELETE", `/im/v1/chats/${p.chatId}/members?member_id_type=${idType}`, {
            id_list: p.userIds,
          });
          return { success: res.ok, message: res.ok ? `✅ 已移除成员` : `❌ 移除失败: ${res.error}` };
        }

        case "list_members": {
          if (!p.chatId) return { success: false, message: "❌ 请提供 chatId" };
          const res = await feishuRequest(token, "GET", `/im/v1/chats/${p.chatId}/members?page_size=50`);
          if (!res.ok) return { success: false, message: `❌ 获取成员失败: ${res.error}` };
          const items = (res.data?.items as Array<Record<string, unknown>>) || [];
          let msg = `👥 群成员 (${items.length}人)\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const m of items) msg += `  • ${m.name} (${m.member_id}) [${m.member_id_type}]\n`;
          return { success: true, message: msg };
        }

        case "get_user": {
          if (!p.userId) return { success: false, message: "❌ 请提供 userId" };
          const idType = (p.userIdType || "open_id") as string;
          const res = await feishuRequest(token, "GET", `/contact/v3/users/${p.userId}?user_id_type=${idType}`);
          if (!res.ok) return { success: false, message: `❌ 获取用户信息失败: ${res.error}` };
          const user = res.data?.user as Record<string, unknown>;
          let msg = `👤 用户信息\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `姓名: ${user?.name}\n`;
          msg += `邮箱: ${user?.email || "(未公开)"}\n`;
          msg += `部门: ${(user?.department_ids as string[])?.join(", ") || "未知"}\n`;
          return { success: true, message: msg, data: { user } };
        }

        case "search_user": {
          if (!p.keyword) return { success: false, message: "❌ 请提供 keyword (邮箱或手机号)" };
          const isEmail = (p.keyword as string).includes("@");
          const body = isEmail ? { emails: [p.keyword] } : { mobiles: [p.keyword] };
          const idType = (p.userIdType || "open_id") as string;
          const res = await feishuRequest(token, "POST", `/contact/v3/users/batch_get_id?user_id_type=${idType}`, body);
          if (!res.ok) return { success: false, message: `❌ 查询失败: ${res.error}` };
          const users = (res.data?.user_list as Array<Record<string, unknown>>) || [];
          if (users.length === 0) return { success: true, message: `🔍 未找到匹配 "${p.keyword}" 的用户` };
          let msg = `🔍 查询 "${p.keyword}" (${users.length}条)\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const u of users) msg += `  • ${u.user_id || ""} (${isEmail ? u.email || "" : u.mobile || ""})\n`;
          return { success: true, message: msg };
        }

        case "list_approvals": {
          if (!p.approvalCode) return { success: false, message: "❌ 请提供审批定义code (approvalCode 参数)" };
          const res = await feishuRequest(token, "GET", `/approval/v4/instances?approval_code=${p.approvalCode}&page_size=20`);
          if (!res.ok) return { success: false, message: `❌ 获取审批列表失败: ${res.error}` };
          const items = (res.data?.instance_list as Array<Record<string, unknown>>) || [];
          if (items.length === 0) return { success: true, message: "📋 无审批实例" };
          let msg = `📋 审批列表 (${items.length}条)\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const inst of items) {
            msg += `  ${inst.status === "APPROVED" ? "✅" : inst.status === "REJECTED" ? "❌" : "⏳"} ${inst.instance_code} [${inst.status}]\n`;
          }
          return { success: true, message: msg };
        }

        case "get_approval": {
          if (!p.instanceId) return { success: false, message: "❌ 请提供 instanceId" };
          const res = await feishuRequest(token, "GET", `/approval/v4/instances/${p.instanceId}`);
          if (!res.ok) return { success: false, message: `❌ 获取审批详情失败: ${res.error}` };
          return { success: true, message: `📋 审批详情\n━━━━━━━━━━━━━━━━━━━━\n${JSON.stringify(res.data, null, 2).slice(0, 3000)}` };
        }

        case "approve":
        case "reject": {
          if (!p.approvalCode) return { success: false, message: "❌ 请提供 approvalCode" };
          if (!p.instanceId) return { success: false, message: "❌ 请提供 instanceId" };
          if (!p.userId) return { success: false, message: "❌ 请提供审批人 userId" };
          const taskRes = await feishuRequest(token, "GET", `/approval/v4/instances/${p.instanceId}`);
          let taskId = "";
          if (taskRes.ok && taskRes.data?.task_list) {
            const tasks = taskRes.data.task_list as Array<Record<string, unknown>>;
            const pending = tasks.find((t) => t.status === "PENDING" && t.user_id === p.userId);
            taskId = (pending?.id as string) || (tasks[0]?.id as string) || "";
          }
          if (!taskId) return { success: false, message: "❌ 未找到待处理的审批任务（需PENDING状态）" };
          const endpoint = p.action === "approve" ? "/approval/v4/tasks/approve" : "/approval/v4/tasks/reject";
          const res = await feishuRequest(token, "POST", endpoint, {
            approval_code: p.approvalCode,
            instance_code: p.instanceId,
            user_id: p.userId,
            task_id: taskId,
            comment: (p.comment as string) || "",
          });
          const label = p.action === "approve" ? "通过" : "拒绝";
          return { success: res.ok, message: res.ok ? `✅ 审批已${label}` : `❌ ${label}失败: ${res.error}` };
        }

        case "list_calendars": {
          const res = await feishuRequest(token, "GET", "/calendar/v4/calendars?page_size=50");
          if (!res.ok) return { success: false, message: `❌ 获取日历失败: ${res.error}` };
          const items = (res.data?.calendar_list as Array<Record<string, unknown>>) || [];
          let msg = `📅 日历列表 (${items.length}个)\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const cal of items) msg += `  📅 ${cal.summary} (${cal.calendar_id})\n`;
          return { success: true, message: msg };
        }

        case "create_event": {
          if (!p.calendarId || !p.title) return { success: false, message: "❌ 需要 calendarId 和 title" };
          const res = await feishuRequest(token, "POST", `/calendar/v4/calendars/${p.calendarId}/events`, {
            summary: p.title,
            description: (p.description as string) || "",
            start_time: { timestamp: p.startTime ? String(Math.floor(new Date(p.startTime as string).getTime() / 1000)) : "" },
            end_time: { timestamp: p.endTime ? String(Math.floor(new Date(p.endTime as string).getTime() / 1000)) : "" },
          });
          return { success: res.ok, message: res.ok ? `✅ 日历事件已创建: ${p.title}` : `❌ 创建失败: ${res.error}` };
        }

        case "list_events": {
          if (!p.calendarId) return { success: false, message: "❌ 请提供 calendarId" };
          const res = await feishuRequest(token, "GET", `/calendar/v4/calendars/${p.calendarId}/events?page_size=20`);
          if (!res.ok) return { success: false, message: `❌ 获取事件失败: ${res.error}` };
          const items = (res.data?.items as Array<Record<string, unknown>>) || [];
          if (items.length === 0) return { success: true, message: "📅 无日历事件" };
          let msg = `📅 日历事件 (${items.length}条)\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const ev of items) msg += `  📌 ${ev.summary} (${ev.event_id})\n`;
          return { success: true, message: msg };
        }

        case "list_tables": {
          if (!p.appToken) return { success: false, message: "❌ 请提供多维表格 appToken" };
          const res = await feishuRequest(token, "GET", `/bitable/v1/apps/${p.appToken}/tables?page_size=100`);
          if (!res.ok) return { success: false, message: `❌ 获取数据表失败: ${res.error}` };
          const items = (res.data?.items as Array<Record<string, unknown>>) || [];
          let msg = `📊 数据表列表 (${items.length}个)\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const t of items) msg += `  📋 ${t.name} (${t.table_id})\n`;
          return { success: true, message: msg };
        }

        case "list_records": {
          if (!p.appToken || !p.tableId) return { success: false, message: "❌ 需要 appToken 和 tableId" };
          const res = await feishuRequest(token, "GET", `/bitable/v1/apps/${p.appToken}/tables/${p.tableId}/records?page_size=20`);
          if (!res.ok) return { success: false, message: `❌ 获取记录失败: ${res.error}` };
          const items = (res.data?.items as Array<Record<string, unknown>>) || [];
          let msg = `📊 记录列表 (${items.length}条)\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const r of items) {
            const fields = r.fields as Record<string, unknown>;
            const preview = Object.entries(fields || {}).slice(0, 3).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(" | ");
            msg += `  ${r.record_id}: ${preview}\n`;
          }
          return { success: true, message: msg, data: { records: items } };
        }

        case "add_record": {
          if (!p.appToken || !p.tableId || !p.fields) return { success: false, message: "❌ 需要 appToken、tableId 和 fields" };
          const res = await feishuRequest(token, "POST", `/bitable/v1/apps/${p.appToken}/tables/${p.tableId}/records`, {
            fields: p.fields,
          });
          return { success: res.ok, message: res.ok ? `✅ 记录已添加 (ID: ${(res.data?.record as Record<string, unknown>)?.record_id})` : `❌ 添加失败: ${res.error}` };
        }

        case "update_record": {
          if (!p.appToken || !p.tableId || !p.recordId || !p.fields) {
            return { success: false, message: "❌ 需要 appToken、tableId、recordId 和 fields" };
          }
          const res = await feishuRequest(token, "PUT", `/bitable/v1/apps/${p.appToken}/tables/${p.tableId}/records/${p.recordId}`, {
            fields: p.fields,
          });
          return { success: res.ok, message: res.ok ? `✅ 记录已更新` : `❌ 更新失败: ${res.error}` };
        }

        default:
          return { success: false, message: `❌ 未知操作: ${p.action}` };
      }
    } catch (err) {
      return { success: false, message: `飞书操作异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
