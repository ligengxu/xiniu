import { z } from "zod";
import type { SkillDefinition } from "../types";
import {
  saveCredential,
  getCredential,
  listCredentials,
  deleteCredential,
  touchCredential,
  maskPassword,
  type Credential,
} from "@/lib/credential-store";

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  name: string;
}

const SMTP_DB: Record<string, SmtpConfig> = {
  "qq.com": { host: "smtp.qq.com", port: 465, secure: true, name: "QQ邮箱" },
  "foxmail.com": { host: "smtp.qq.com", port: 465, secure: true, name: "Foxmail" },
  "163.com": { host: "smtp.163.com", port: 465, secure: true, name: "网易163" },
  "126.com": { host: "smtp.126.com", port: 465, secure: true, name: "网易126" },
  "yeah.net": { host: "smtp.yeah.net", port: 465, secure: true, name: "网易yeah" },
  "gmail.com": { host: "smtp.gmail.com", port: 465, secure: true, name: "Gmail" },
  "outlook.com": { host: "smtp-mail.outlook.com", port: 587, secure: false, name: "Outlook" },
  "hotmail.com": { host: "smtp-mail.outlook.com", port: 587, secure: false, name: "Hotmail" },
  "live.com": { host: "smtp-mail.outlook.com", port: 587, secure: false, name: "Live" },
  "yahoo.com": { host: "smtp.mail.yahoo.com", port: 465, secure: true, name: "Yahoo" },
  "aliyun.com": { host: "smtp.aliyun.com", port: 465, secure: true, name: "阿里云邮箱" },
  "sina.com": { host: "smtp.sina.com", port: 465, secure: true, name: "新浪邮箱" },
  "sohu.com": { host: "smtp.sohu.com", port: 465, secure: true, name: "搜狐邮箱" },
  "139.com": { host: "smtp.139.com", port: 465, secure: true, name: "139邮箱" },
  "189.cn": { host: "smtp.189.cn", port: 465, secure: true, name: "189邮箱" },
  "wo.cn": { host: "smtp.wo.cn", port: 465, secure: true, name: "沃邮箱" },
  "tom.com": { host: "smtp.tom.com", port: 465, secure: true, name: "TOM邮箱" },
  "icloud.com": { host: "smtp.mail.me.com", port: 587, secure: false, name: "iCloud" },
  "me.com": { host: "smtp.mail.me.com", port: 587, secure: false, name: "iCloud" },
};

const WEBMAIL_URLS: Record<string, string> = {
  "qq.com": "https://mail.qq.com",
  "foxmail.com": "https://mail.qq.com",
  "163.com": "https://mail.163.com",
  "126.com": "https://mail.126.com",
  "yeah.net": "https://mail.yeah.net",
  "gmail.com": "https://mail.google.com",
  "outlook.com": "https://outlook.live.com",
  "hotmail.com": "https://outlook.live.com",
  "live.com": "https://outlook.live.com",
  "yahoo.com": "https://mail.yahoo.com",
  "aliyun.com": "https://mail.aliyun.com",
  "sina.com": "https://mail.sina.com.cn",
  "sohu.com": "https://mail.sohu.com",
  "139.com": "https://mail.10086.cn",
  "189.cn": "https://webmail30.189.cn",
  "icloud.com": "https://www.icloud.com/mail",
};

function getEmailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() || "";
}

function lookupSmtp(email: string): SmtpConfig | null {
  const domain = getEmailDomain(email);
  return SMTP_DB[domain] || null;
}

async function trySendSmtp(
  from: string, password: string, smtpConfig: SmtpConfig,
  to: string, subject: string, body: string, isHtml: boolean,
  attachments?: { filename: string; path: string }[],
): Promise<{ ok: boolean; message: string; messageId?: string }> {
  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: { user: from, pass: password },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 15000,
      socketTimeout: 30000,
    });

    await transporter.verify();

    const mailOptions: Record<string, unknown> = {
      from: from,
      to: to,
      subject: subject,
    };

    if (isHtml) {
      mailOptions.html = body;
    } else {
      mailOptions.text = body;
    }

    if (attachments && attachments.length > 0) {
      mailOptions.attachments = attachments;
    }

    const info = await transporter.sendMail(mailOptions);
    return { ok: true, message: `邮件发送成功`, messageId: info.messageId };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function generateWebmailInstructions(email: string, to: string, subject: string, body: string): string {
  const domain = getEmailDomain(email);
  const webUrl = WEBMAIL_URLS[domain] || `https://mail.${domain}`;

  let guide = `📧 SMTP发送失败，建议通过网页邮箱发送\n`;
  guide += `━━━━━━━━━━━━━━━━━━━━\n`;
  guide += `网页邮箱地址: ${webUrl}\n\n`;

  if (domain === "qq.com" || domain === "foxmail.com") {
    guide += `💡 QQ邮箱SMTP密码不是QQ密码，需要开启SMTP服务并获取授权码:\n`;
    guide += `  1. 登录 mail.qq.com → 设置 → 账户\n`;
    guide += `  2. 找到"POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务"\n`;
    guide += `  3. 开启"SMTP服务" → 验证手机 → 获取授权码\n`;
    guide += `  4. 用授权码替代密码重新配置\n`;
  } else if (domain === "163.com" || domain === "126.com" || domain === "yeah.net") {
    guide += `💡 网易邮箱SMTP需要使用授权码:\n`;
    guide += `  1. 登录 mail.${domain} → 设置 → POP3/SMTP/IMAP\n`;
    guide += `  2. 开启SMTP → 设置授权码\n`;
    guide += `  3. 用授权码替代密码\n`;
  } else if (domain === "gmail.com") {
    guide += `💡 Gmail需要使用"应用专用密码":\n`;
    guide += `  1. 前往 myaccount.google.com → 安全性\n`;
    guide += `  2. 启用两步验证 → 应用专用密码\n`;
    guide += `  3. 生成一个"邮件"类型的密码\n`;
  } else if (domain === "outlook.com" || domain === "hotmail.com") {
    guide += `💡 Outlook可能需要:\n`;
    guide += `  1. 启用两步验证并生成应用密码\n`;
    guide += `  2. 或在安全设置中允许第三方应用\n`;
  }

  guide += `\n📝 已准备好的邮件内容:\n`;
  guide += `  收件人: ${to}\n  主题: ${subject}\n  正文: ${body.slice(0, 200)}${body.length > 200 ? "..." : ""}\n`;
  guide += `\n可以使用浏览器自动化工具(browser_open等)帮你登录网页邮箱来发送。`;

  return guide;
}

export const smartEmailSkill: SkillDefinition = {
  name: "smart_email",
  displayName: "智能邮件",
  description:
    "智能发送邮件：自动识别邮箱服务商并配置SMTP，首次只需邮箱+密码(授权码)即可。凭证加密保存到长期记忆，下次自动使用(会先确认)。SMTP失败时给出对应邮箱的开启方法或回退网页发送指引。支持HTML邮件和附件。用户说'发邮件'、'发送邮件'、'配置邮箱'时使用。",
  icon: "Mail",
  category: "life",
  parameters: z.object({
    action: z.enum(["send", "config", "test", "list_saved", "delete_saved"])
      .describe("操作: send=发送邮件, config=配置/测试邮箱, test=测试SMTP连接, list_saved=列出已保存的邮箱, delete_saved=删除保存的邮箱"),
    email: z.string().optional().describe("发件人邮箱地址"),
    password: z.string().optional().describe("邮箱密码或授权码(首次需要，之后自动读取)"),
    to: z.string().optional().describe("收件人邮箱(多个用逗号分隔)"),
    subject: z.string().optional().describe("邮件主题"),
    body: z.string().optional().describe("邮件正文"),
    isHtml: z.boolean().optional().describe("正文是否为HTML格式，默认false"),
    attachments: z.array(z.object({
      filename: z.string().describe("附件文件名"),
      path: z.string().describe("本地文件路径"),
    })).optional().describe("附件列表"),
    smtpHost: z.string().optional().describe("自定义SMTP服务器(自动检测不到时使用)"),
    smtpPort: z.number().optional().describe("自定义SMTP端口"),
    smtpSecure: z.boolean().optional().describe("是否使用SSL"),
    credentialId: z.string().optional().describe("delete_saved时指定凭证ID"),
  }),
  execute: async (params) => {
    const {
      action,
      email: inputEmail,
      password: inputPwd,
      to, subject, body,
      isHtml = false,
      attachments,
      smtpHost, smtpPort, smtpSecure,
      credentialId,
    } = params as {
      action: string;
      email?: string; password?: string;
      to?: string; subject?: string; body?: string;
      isHtml?: boolean;
      attachments?: { filename: string; path: string }[];
      smtpHost?: string; smtpPort?: number; smtpSecure?: boolean;
      credentialId?: string;
    };

    try {
      if (action === "list_saved") {
        const saved = await listCredentials("email");
        if (saved.length === 0) {
          return { success: true, message: "📋 暂无保存的邮箱配置。使用 config 操作配置邮箱。" };
        }
        let msg = `📋 已保存的邮箱 (${saved.length}个):\n━━━━━━━━━━━━━━━━━━━━\n`;
        for (const c of saved) {
          const smtpLabel = c.extra?.smtpName || c.host;
          msg += `📧 ${c.username}\n   ID: ${c.id}\n   SMTP: ${c.host}:${c.port}\n   服务商: ${smtpLabel}\n   最后使用: ${c.lastUsedAt}\n\n`;
        }
        return { success: true, message: msg, data: { credentials: saved } };
      }

      if (action === "delete_saved") {
        if (!credentialId) return { success: false, message: "❌ 需要提供 credentialId" };
        const ok = await deleteCredential(credentialId);
        return { success: ok, message: ok ? `✅ 邮箱凭证已删除` : `❌ 未找到凭证` };
      }

      let email = inputEmail || "";
      let password = inputPwd || "";
      let smtp: SmtpConfig | null = null;

      if (!email || !password) {
        const saved = await getCredential("email", undefined, email || undefined);
        if (saved) {
          email = email || saved.username;
          password = password || saved.password;
          smtp = {
            host: saved.host,
            port: saved.port || 465,
            secure: saved.extra?.secure === "true",
            name: saved.extra?.smtpName || saved.host,
          };
          await touchCredential(saved.id);

          if (!inputEmail) {
            return {
              success: true,
              message: `🔑 找到已保存的邮箱配置:\n   📧 ${saved.username}\n   SMTP: ${saved.host}:${saved.port}\n   服务商: ${saved.extra?.smtpName || "自定义"}\n\n请确认是否使用此邮箱发送。如需使用其他邮箱，请提供 email 参数。`,
              data: { savedEmail: saved.username, smtpHost: saved.host },
            };
          }
        } else if (!email || !password) {
          return {
            success: false,
            message: `❌ 首次使用需要提供 email 和 password(授权码) 参数。\n\n📌 注意:\n- QQ邮箱/163邮箱等需要使用"授权码"而非登录密码\n- Gmail需要使用"应用专用密码"\n- 凭证会加密保存到本地，下次自动使用`,
          };
        }
      }

      if (!smtp) {
        if (smtpHost) {
          smtp = { host: smtpHost, port: smtpPort || 465, secure: smtpSecure !== false, name: "自定义" };
        } else {
          smtp = lookupSmtp(email);
          if (!smtp) {
            const domain = getEmailDomain(email);
            const guesses = [
              { host: `smtp.${domain}`, port: 465, secure: true, name: domain },
              { host: `mail.${domain}`, port: 465, secure: true, name: domain },
              { host: `smtp.${domain}`, port: 587, secure: false, name: domain },
            ];

            for (const guess of guesses) {
              const testResult = await trySendSmtp(email, password, guess, email, "SMTP Test", "test", false);
              if (testResult.ok || !testResult.message.includes("ECONNREFUSED")) {
                smtp = guess;
                break;
              }
            }

            if (!smtp) {
              return {
                success: false,
                message: `❌ 无法自动识别 ${domain} 的SMTP配置\n\n请手动提供:\n  smtpHost: "smtp.${domain}"\n  smtpPort: 465\n  smtpSecure: true\n\n或查看你的邮箱服务商文档获取SMTP服务器信息。`,
              };
            }
          }
        }
      }

      if (action === "config" || action === "test") {
        const testResult = await trySendSmtp(email, password, smtp, email, "犀牛Agent SMTP测试", "这是一封来自犀牛Agent的SMTP配置测试邮件。如果你收到此邮件，说明SMTP配置成功！", false);

        if (testResult.ok) {
          await saveCredential({
            type: "email",
            label: `${email} (${smtp.name})`,
            host: smtp.host,
            port: smtp.port,
            username: email,
            password,
            extra: { smtpName: smtp.name, secure: String(smtp.secure) },
          });

          return {
            success: true,
            message: `✅ 邮箱配置成功!\n━━━━━━━━━━━━━━━━━━━━\n📧 邮箱: ${email}\n🔧 SMTP: ${smtp.host}:${smtp.port} (${smtp.name})\n🔒 SSL: ${smtp.secure ? "是" : "否"}\n💾 凭证已加密保存到长期记忆\n\n已发送一封测试邮件到你的邮箱，请检查收件箱。`,
            data: { email, smtpHost: smtp.host, smtpPort: smtp.port, smtpName: smtp.name },
          };
        }

        const guide = generateWebmailInstructions(email, email, "测试", "SMTP配置测试");
        return {
          success: false,
          message: `❌ SMTP连接失败: ${testResult.message}\n\n${guide}`,
          data: { email, smtpHost: smtp.host, error: testResult.message },
        };
      }

      if (action === "send") {
        if (!to || !subject || !body) {
          return { success: false, message: "❌ 发送邮件需要 to(收件人)、subject(主题)、body(正文) 参数" };
        }

        const sendResult = await trySendSmtp(email, password, smtp, to, subject, body, isHtml, attachments);

        if (sendResult.ok) {
          await saveCredential({
            type: "email",
            label: `${email} (${smtp.name})`,
            host: smtp.host,
            port: smtp.port,
            username: email,
            password,
            extra: { smtpName: smtp.name, secure: String(smtp.secure) },
          });

          let msg = `✅ 邮件发送成功!\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `📤 发件人: ${email}\n📥 收件人: ${to}\n📋 主题: ${subject}\n`;
          msg += `📝 正文: ${body.slice(0, 100)}${body.length > 100 ? "..." : ""}\n`;
          if (attachments && attachments.length > 0) {
            msg += `📎 附件: ${attachments.map((a) => a.filename).join(", ")}\n`;
          }
          msg += `🆔 MessageID: ${sendResult.messageId}`;

          return { success: true, message: msg, data: { messageId: sendResult.messageId, to, subject } };
        }

        const guide = generateWebmailInstructions(email, to, subject, body);
        return {
          success: false,
          message: `❌ SMTP发送失败: ${sendResult.message}\n\n${guide}`,
          data: { email, to, subject, error: sendResult.message, fallbackUrl: WEBMAIL_URLS[getEmailDomain(email)] },
        };
      }

      return { success: false, message: `未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `邮件操作异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
