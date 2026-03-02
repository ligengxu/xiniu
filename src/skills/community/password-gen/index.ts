import { z } from "zod";
import crypto from "crypto";
import type { SkillDefinition } from "../types";

function generatePassword(length: number, options: {
  uppercase: boolean; lowercase: boolean; digits: boolean;
  symbols: boolean; excludeAmbiguous: boolean; customChars?: string;
}): string {
  let chars = "";
  const required: string[] = [];

  const ambiguous = "O0lI1|";

  if (options.uppercase) {
    let upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (options.excludeAmbiguous) upper = upper.split("").filter((c) => !ambiguous.includes(c)).join("");
    chars += upper;
    required.push(upper[crypto.randomInt(upper.length)]);
  }
  if (options.lowercase) {
    let lower = "abcdefghijklmnopqrstuvwxyz";
    if (options.excludeAmbiguous) lower = lower.split("").filter((c) => !ambiguous.includes(c)).join("");
    chars += lower;
    required.push(lower[crypto.randomInt(lower.length)]);
  }
  if (options.digits) {
    let digits = "0123456789";
    if (options.excludeAmbiguous) digits = digits.split("").filter((c) => !ambiguous.includes(c)).join("");
    chars += digits;
    required.push(digits[crypto.randomInt(digits.length)]);
  }
  if (options.symbols) {
    const syms = "!@#$%^&*()_+-=[]{}|;:,.<>?";
    chars += syms;
    required.push(syms[crypto.randomInt(syms.length)]);
  }
  if (options.customChars) {
    chars += options.customChars;
  }

  if (chars.length === 0) chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  const remaining = length - required.length;
  const result = [...required];
  for (let i = 0; i < Math.max(0, remaining); i++) {
    result.push(chars[crypto.randomInt(chars.length)]);
  }

  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result.join("");
}

function checkStrength(pwd: string): { score: number; level: string; details: string[] } {
  const details: string[] = [];
  let score = 0;

  if (pwd.length >= 8) { score += 1; details.push("长度>=8"); }
  if (pwd.length >= 12) { score += 1; details.push("长度>=12"); }
  if (pwd.length >= 16) { score += 1; details.push("长度>=16"); }
  if (/[a-z]/.test(pwd)) { score += 1; details.push("含小写"); }
  if (/[A-Z]/.test(pwd)) { score += 1; details.push("含大写"); }
  if (/[0-9]/.test(pwd)) { score += 1; details.push("含数字"); }
  if (/[^a-zA-Z0-9]/.test(pwd)) { score += 1; details.push("含特殊字符"); }

  const repeated = /(.)\1{2,}/.test(pwd);
  if (repeated) { score -= 1; details.push("有连续重复字符(-1)"); }
  const sequential = /(abc|bcd|cde|def|efg|123|234|345|456|567|678|789)/i.test(pwd);
  if (sequential) { score -= 1; details.push("有顺序字符(-1)"); }

  const common = ["password", "123456", "qwerty", "abc123", "admin", "letmein", "welcome"];
  if (common.some((c) => pwd.toLowerCase().includes(c))) { score = Math.max(0, score - 3); details.push("含常见弱密码(-3)"); }

  let level: string;
  if (score <= 2) level = "极弱";
  else if (score <= 3) level = "弱";
  else if (score <= 5) level = "中等";
  else if (score <= 6) level = "强";
  else level = "极强";

  return { score: Math.max(0, Math.min(7, score)), level, details };
}

export const passwordGenSkill: SkillDefinition = {
  name: "password_gen",
  displayName: "密码生成器",
  description: "生成安全随机密码，或检测已有密码强度。支持自定义长度、字符类型、排除易混淆字符。可批量生成多个密码。用户说'生成密码'、'随机密码'、'密码强度'、'password'时使用。",
  icon: "Hash",
  category: "dev",
  parameters: z.object({
    action: z.enum(["generate", "check"]).describe("操作: generate=生成密码, check=检测密码强度"),
    length: z.number().optional().describe("密码长度，默认16"),
    count: z.number().optional().describe("生成密码数量，默认3"),
    uppercase: z.boolean().optional().describe("包含大写字母，默认true"),
    lowercase: z.boolean().optional().describe("包含小写字母，默认true"),
    digits: z.boolean().optional().describe("包含数字，默认true"),
    symbols: z.boolean().optional().describe("包含特殊符号，默认true"),
    excludeAmbiguous: z.boolean().optional().describe("排除易混淆字符(0/O/l/I/1/|)，默认true"),
    customChars: z.string().optional().describe("额外包含的自定义字符"),
    password: z.string().optional().describe("check操作: 要检测的密码"),
  }),
  execute: async (params) => {
    const {
      action,
      length = 16,
      count = 3,
      uppercase = true,
      lowercase = true,
      digits = true,
      symbols = true,
      excludeAmbiguous = true,
      customChars,
      password,
    } = params as {
      action: string; length?: number; count?: number;
      uppercase?: boolean; lowercase?: boolean; digits?: boolean; symbols?: boolean;
      excludeAmbiguous?: boolean; customChars?: string; password?: string;
    };

    try {
      if (action === "check") {
        if (!password) return { success: false, message: "check操作需要 password 参数" };
        const result = checkStrength(password);
        const bar = "█".repeat(result.score) + "░".repeat(7 - result.score);

        let msg = `密码强度检测\n━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `密码: ${password.slice(0, 2)}${"*".repeat(Math.max(0, password.length - 4))}${password.slice(-2)}\n`;
        msg += `长度: ${password.length}\n`;
        msg += `强度: [${bar}] ${result.score}/7 - ${result.level}\n`;
        msg += `分析: ${result.details.join(", ")}`;

        if (result.score <= 3) {
          msg += `\n\n建议: 密码过弱，建议使用 generate 生成强密码`;
        }

        return { success: true, message: msg, data: { score: result.score, level: result.level, details: result.details } };
      }

      if (action === "generate") {
        const actualLen = Math.max(6, Math.min(128, length));
        const actualCount = Math.max(1, Math.min(20, count));
        const passwords: Array<{ password: string; strength: ReturnType<typeof checkStrength> }> = [];

        for (let i = 0; i < actualCount; i++) {
          const pwd = generatePassword(actualLen, { uppercase, lowercase, digits, symbols, excludeAmbiguous, customChars });
          passwords.push({ password: pwd, strength: checkStrength(pwd) });
        }

        let msg = `密码生成完成 (${actualCount}个, ${actualLen}位)\n`;
        msg += `选项: ${[uppercase ? "大写" : "", lowercase ? "小写" : "", digits ? "数字" : "", symbols ? "符号" : ""].filter(Boolean).join("+")}`;
        if (excludeAmbiguous) msg += " | 排除易混淆";
        msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;

        for (let i = 0; i < passwords.length; i++) {
          const p = passwords[i];
          const bar = "█".repeat(p.strength.score) + "░".repeat(7 - p.strength.score);
          msg += `${i + 1}. ${p.password}\n   强度: [${bar}] ${p.strength.level}\n`;
        }

        return {
          success: true, message: msg,
          data: { passwords: passwords.map((p) => ({ password: p.password, strength: p.strength.level })) },
        };
      }

      return { success: false, message: `未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `密码生成异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
