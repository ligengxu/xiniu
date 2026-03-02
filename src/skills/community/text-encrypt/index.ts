import { z } from "zod";
import crypto from "crypto";
import type { SkillDefinition } from "../types";

function aesEncrypt(text: string, password: string, algorithm: string): string {
  const keyLen = algorithm === "aes-128-cbc" ? 16 : algorithm === "aes-192-cbc" ? 24 : 32;
  const key = crypto.scryptSync(password, "xiniu-salt", keyLen);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  return iv.toString("base64") + ":" + encrypted;
}

function aesDecrypt(data: string, password: string, algorithm: string): string {
  const keyLen = algorithm === "aes-128-cbc" ? 16 : algorithm === "aes-192-cbc" ? 24 : 32;
  const key = crypto.scryptSync(password, "xiniu-salt", keyLen);
  const [ivB64, encrypted] = data.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function generateRsaKeyPair(bits: number): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: bits,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

function rsaEncrypt(text: string, publicKeyPem: string): string {
  const encrypted = crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(text, "utf8"),
  );
  return encrypted.toString("base64");
}

function rsaDecrypt(data: string, privateKeyPem: string): string {
  const decrypted = crypto.privateDecrypt(
    { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(data, "base64"),
  );
  return decrypted.toString("utf8");
}

export const textEncryptSkill: SkillDefinition = {
  name: "text_encrypt",
  displayName: "文本加解密",
  description: "文本加密/解密工具：支持AES(128/192/256)对称加密、RSA非对称加密、生成RSA密钥对。用于敏感信息保护、安全传输。用户说'加密'、'解密'、'encrypt'、'decrypt'时使用。",
  icon: "Hash",
  category: "dev",
  parameters: z.object({
    action: z.enum(["encrypt", "decrypt", "generate_rsa_keys"])
      .describe("操作: encrypt=加密, decrypt=解密, generate_rsa_keys=生成RSA密钥对"),
    text: z.string().optional().describe("要加密/解密的文本"),
    password: z.string().optional().describe("AES加密的密码"),
    algorithm: z.string().optional().describe("加密算法: aes-128-cbc / aes-192-cbc / aes-256-cbc(默认) / rsa"),
    publicKey: z.string().optional().describe("RSA加密的公钥(PEM格式)"),
    privateKey: z.string().optional().describe("RSA解密的私钥(PEM格式)"),
    rsaBits: z.number().optional().describe("generate_rsa_keys的密钥位数: 1024/2048(默认)/4096"),
  }),
  execute: async (params) => {
    const {
      action, text, password,
      algorithm = "aes-256-cbc",
      publicKey, privateKey,
      rsaBits = 2048,
    } = params as {
      action: string; text?: string; password?: string;
      algorithm?: string; publicKey?: string; privateKey?: string;
      rsaBits?: number;
    };

    try {
      if (action === "generate_rsa_keys") {
        const bits = [1024, 2048, 4096].includes(rsaBits) ? rsaBits : 2048;
        const keys = generateRsaKeyPair(bits);

        let msg = `RSA密钥对生成完成 (${bits}位)\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        msg += `公钥 (用于加密):\n${keys.publicKey}\n`;
        msg += `私钥 (用于解密，请妥善保管):\n${keys.privateKey.slice(0, 200)}...\n`;
        msg += `\n私钥长度: ${keys.privateKey.length}字符`;

        return { success: true, message: msg, data: { publicKey: keys.publicKey, privateKey: keys.privateKey, bits } };
      }

      if (!text) return { success: false, message: "需要提供 text 参数" };

      if (algorithm === "rsa") {
        if (action === "encrypt") {
          if (!publicKey) return { success: false, message: "RSA加密需要 publicKey 参数" };
          if (text.length > 190) return { success: false, message: `RSA加密文本长度限制约190字符(当前${text.length})，长文本请用AES` };
          const encrypted = rsaEncrypt(text, publicKey);
          return {
            success: true,
            message: `RSA加密完成\n━━━━━━━━━━━━━━━━━━━━\n原文长度: ${text.length}\n密文: ${encrypted}`,
            data: { encrypted, algorithm: "rsa" },
          };
        }
        if (action === "decrypt") {
          if (!privateKey) return { success: false, message: "RSA解密需要 privateKey 参数" };
          const decrypted = rsaDecrypt(text, privateKey);
          return {
            success: true,
            message: `RSA解密完成\n━━━━━━━━━━━━━━━━━━━━\n明文: ${decrypted}`,
            data: { decrypted, algorithm: "rsa" },
          };
        }
      }

      const aesAlg = ["aes-128-cbc", "aes-192-cbc", "aes-256-cbc"].includes(algorithm) ? algorithm : "aes-256-cbc";

      if (action === "encrypt") {
        if (!password) return { success: false, message: "AES加密需要 password 参数" };
        const encrypted = aesEncrypt(text, password, aesAlg);
        return {
          success: true,
          message: `AES加密完成 (${aesAlg})\n━━━━━━━━━━━━━━━━━━━━\n原文长度: ${text.length}\n密文: ${encrypted}\n\n解密时需要相同的 password 和 algorithm`,
          data: { encrypted, algorithm: aesAlg },
        };
      }

      if (action === "decrypt") {
        if (!password) return { success: false, message: "AES解密需要 password 参数" };
        const decrypted = aesDecrypt(text, password, aesAlg);
        return {
          success: true,
          message: `AES解密完成 (${aesAlg})\n━━━━━━━━━━━━━━━━━━━━\n明文: ${decrypted}`,
          data: { decrypted, algorithm: aesAlg },
        };
      }

      return { success: false, message: `未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `加解密失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
