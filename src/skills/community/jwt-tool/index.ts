import { z } from "zod";
import type { SkillDefinition } from "../types";
import * as crypto from "crypto";

function base64UrlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const final = pad ? padded + "=".repeat(4 - pad) : padded;
  return Buffer.from(final, "base64").toString("utf-8");
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(header: string, payload: string, secret: string, algorithm: string): string {
  const input = `${header}.${payload}`;
  const algoMap: Record<string, string> = {
    HS256: "sha256", HS384: "sha384", HS512: "sha512",
  };
  const hashAlgo = algoMap[algorithm];
  if (!hashAlgo) throw new Error(`不支持的算法: ${algorithm}，仅支持 HS256/HS384/HS512`);
  const signature = crypto.createHmac(hashAlgo, secret).update(input).digest("base64url");
  return signature;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

function analyzeExpiration(payload: Record<string, unknown>): string[] {
  const notes: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  if (typeof payload.exp === "number") {
    const diff = payload.exp - now;
    if (diff < 0) {
      notes.push(`⚠️ Token 已过期（${formatTimestamp(payload.exp)}，${Math.abs(diff)}秒前）`);
    } else {
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      notes.push(`✅ Token 有效（${formatTimestamp(payload.exp)}到期，剩余 ${h}h${m}m）`);
    }
  }
  if (typeof payload.iat === "number") {
    notes.push(`📅 签发时间: ${formatTimestamp(payload.iat)}`);
  }
  if (typeof payload.nbf === "number") {
    if (payload.nbf > now) {
      notes.push(`⏳ Token 尚未生效（${formatTimestamp(payload.nbf)}生效）`);
    }
  }
  return notes;
}

export const jwtToolSkill: SkillDefinition = {
  name: "jwt_tool",
  displayName: "令牌解析生成",
  description: "JWT (JSON Web Token) 解析、生成与验证。支持解码 JWT 查看 Header/Payload、生成新 JWT、验证签名。用户说'JWT'、'jwt解析'、'jwt生成'、'token解析'、'jwt decode'、'jwt encode'、'jwt验证'时使用。",
  icon: "Key",
  category: "dev",
  parameters: z.object({
    action: z.enum(["decode", "encode", "verify"]).describe("操作：decode=解析JWT, encode=生成JWT, verify=验证JWT签名"),
    token: z.string().optional().describe("JWT Token 字符串（decode/verify 时使用）"),
    payload: z.record(z.unknown()).optional().describe("Payload 数据（encode 时使用）"),
    secret: z.string().optional().describe("密钥（encode/verify 时使用）"),
    algorithm: z.string().optional().describe("签名算法，默认 HS256，支持 HS256/HS384/HS512"),
    expiresIn: z.number().optional().describe("过期时间（秒，encode 时使用），如 3600=1小时"),
  }),
  execute: async (params) => {
    const { action, token, payload, secret, algorithm, expiresIn } = params as {
      action: string; token?: string; payload?: Record<string, unknown>;
      secret?: string; algorithm?: string; expiresIn?: number;
    };

    try {
      if (action === "decode") {
        if (!token) return { success: false, message: "❌ 请提供 JWT Token" };

        const parts = token.split(".");
        if (parts.length !== 3) return { success: false, message: "❌ 无效的 JWT 格式（应为 header.payload.signature 三段）" };

        let header: Record<string, unknown>;
        let payloadData: Record<string, unknown>;
        try {
          header = JSON.parse(base64UrlDecode(parts[0]));
          payloadData = JSON.parse(base64UrlDecode(parts[1]));
        } catch {
          return { success: false, message: "❌ JWT 解码失败，Header 或 Payload 不是有效的 JSON" };
        }

        const lines = [
          `🔑 JWT 解析结果`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `📋 Header:`,
          JSON.stringify(header, null, 2).split("\n").map(l => `  ${l}`).join("\n"),
          ``,
          `📦 Payload:`,
          JSON.stringify(payloadData, null, 2).split("\n").map(l => `  ${l}`).join("\n"),
          ``,
          `🔏 Signature: ${parts[2].slice(0, 20)}...`,
        ];

        const expNotes = analyzeExpiration(payloadData);
        if (expNotes.length > 0) {
          lines.push(``, `📊 状态分析:`);
          lines.push(...expNotes.map(n => `  ${n}`));
        }

        const claimLabels: Record<string, string> = {
          iss: "签发者", sub: "主题/用户", aud: "接收方", jti: "唯一标识",
        };
        const claimNotes: string[] = [];
        for (const [k, label] of Object.entries(claimLabels)) {
          if (payloadData[k]) claimNotes.push(`  📎 ${label} (${k}): ${String(payloadData[k])}`);
        }
        if (claimNotes.length > 0) {
          lines.push(``, `📌 标准声明:`);
          lines.push(...claimNotes);
        }

        return {
          success: true,
          message: lines.join("\n"),
          data: { header, payload: payloadData, signature: parts[2] },
        };
      }

      if (action === "encode") {
        if (!payload) return { success: false, message: "❌ 生成 JWT 需要 payload 参数" };
        if (!secret) return { success: false, message: "❌ 生成 JWT 需要 secret 密钥" };

        const algo = algorithm || "HS256";
        const now = Math.floor(Date.now() / 1000);
        const fullPayload = { ...payload, iat: now };
        if (expiresIn) (fullPayload as Record<string, unknown>).exp = now + expiresIn;

        const headerObj = { alg: algo, typ: "JWT" };
        const headerB64 = base64UrlEncode(JSON.stringify(headerObj));
        const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
        const signature = sign(headerB64, payloadB64, secret, algo);
        const jwt = `${headerB64}.${payloadB64}.${signature}`;

        const lines = [
          `🔑 JWT 生成成功`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `🔏 算法: ${algo}`,
          `📅 签发时间: ${formatTimestamp(now)}`,
        ];
        if (expiresIn) {
          lines.push(`⏰ 过期时间: ${formatTimestamp(now + expiresIn)}（${expiresIn}秒后）`);
        }
        lines.push(``, `🎫 Token:`, jwt);

        return { success: true, message: lines.join("\n"), data: { token: jwt, header: headerObj, payload: fullPayload } };
      }

      if (action === "verify") {
        if (!token) return { success: false, message: "❌ 请提供 JWT Token" };
        if (!secret) return { success: false, message: "❌ 验证签名需要 secret 密钥" };

        const parts = token.split(".");
        if (parts.length !== 3) return { success: false, message: "❌ 无效的 JWT 格式" };

        let header: Record<string, unknown>;
        let payloadData: Record<string, unknown>;
        try {
          header = JSON.parse(base64UrlDecode(parts[0]));
          payloadData = JSON.parse(base64UrlDecode(parts[1]));
        } catch {
          return { success: false, message: "❌ JWT 解码失败" };
        }

        const algo = (header.alg as string) || algorithm || "HS256";
        const expectedSig = sign(parts[0], parts[1], secret, algo);
        const isValid = expectedSig === parts[2];

        const lines = [
          `🔑 JWT 验证结果`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `🔏 算法: ${algo}`,
          `${isValid ? "✅ 签名验证通过" : "❌ 签名验证失败（密钥不匹配）"}`,
        ];

        const expNotes = analyzeExpiration(payloadData);
        if (expNotes.length > 0) lines.push(...expNotes);

        return {
          success: true,
          message: lines.join("\n"),
          data: { valid: isValid, algorithm: algo, header, payload: payloadData },
        };
      }

      return { success: false, message: `❌ 未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `❌ JWT 操作异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
