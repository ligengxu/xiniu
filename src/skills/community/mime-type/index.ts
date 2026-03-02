import { z } from "zod";
import type { SkillDefinition } from "../types";

const MIME_DB: Record<string, { mime: string; category: string; desc: string }> = {
  ".html": { mime: "text/html", category: "网页", desc: "HTML文档" },
  ".htm": { mime: "text/html", category: "网页", desc: "HTML文档" },
  ".css": { mime: "text/css", category: "样式", desc: "CSS样式表" },
  ".js": { mime: "application/javascript", category: "脚本", desc: "JavaScript" },
  ".mjs": { mime: "application/javascript", category: "脚本", desc: "ES Module" },
  ".ts": { mime: "text/typescript", category: "脚本", desc: "TypeScript" },
  ".json": { mime: "application/json", category: "数据", desc: "JSON数据" },
  ".xml": { mime: "application/xml", category: "数据", desc: "XML文档" },
  ".csv": { mime: "text/csv", category: "数据", desc: "CSV表格" },
  ".yaml": { mime: "text/yaml", category: "数据", desc: "YAML配置" },
  ".yml": { mime: "text/yaml", category: "数据", desc: "YAML配置" },
  ".toml": { mime: "application/toml", category: "数据", desc: "TOML配置" },
  ".txt": { mime: "text/plain", category: "文本", desc: "纯文本" },
  ".md": { mime: "text/markdown", category: "文本", desc: "Markdown" },
  ".pdf": { mime: "application/pdf", category: "文档", desc: "PDF文档" },
  ".doc": { mime: "application/msword", category: "文档", desc: "Word文档" },
  ".docx": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", category: "文档", desc: "Word文档(新)" },
  ".xls": { mime: "application/vnd.ms-excel", category: "文档", desc: "Excel表格" },
  ".xlsx": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", category: "文档", desc: "Excel表格(新)" },
  ".ppt": { mime: "application/vnd.ms-powerpoint", category: "文档", desc: "PPT演示" },
  ".pptx": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", category: "文档", desc: "PPT演示(新)" },
  ".jpg": { mime: "image/jpeg", category: "图片", desc: "JPEG图片" },
  ".jpeg": { mime: "image/jpeg", category: "图片", desc: "JPEG图片" },
  ".png": { mime: "image/png", category: "图片", desc: "PNG图片" },
  ".gif": { mime: "image/gif", category: "图片", desc: "GIF动图" },
  ".svg": { mime: "image/svg+xml", category: "图片", desc: "SVG矢量图" },
  ".webp": { mime: "image/webp", category: "图片", desc: "WebP图片" },
  ".avif": { mime: "image/avif", category: "图片", desc: "AVIF图片" },
  ".ico": { mime: "image/x-icon", category: "图片", desc: "图标" },
  ".bmp": { mime: "image/bmp", category: "图片", desc: "BMP图片" },
  ".tiff": { mime: "image/tiff", category: "图片", desc: "TIFF图片" },
  ".mp3": { mime: "audio/mpeg", category: "音频", desc: "MP3音频" },
  ".wav": { mime: "audio/wav", category: "音频", desc: "WAV音频" },
  ".ogg": { mime: "audio/ogg", category: "音频", desc: "OGG音频" },
  ".flac": { mime: "audio/flac", category: "音频", desc: "FLAC无损" },
  ".aac": { mime: "audio/aac", category: "音频", desc: "AAC音频" },
  ".mp4": { mime: "video/mp4", category: "视频", desc: "MP4视频" },
  ".webm": { mime: "video/webm", category: "视频", desc: "WebM视频" },
  ".avi": { mime: "video/x-msvideo", category: "视频", desc: "AVI视频" },
  ".mkv": { mime: "video/x-matroska", category: "视频", desc: "MKV视频" },
  ".mov": { mime: "video/quicktime", category: "视频", desc: "MOV视频" },
  ".zip": { mime: "application/zip", category: "压缩", desc: "ZIP压缩包" },
  ".rar": { mime: "application/vnd.rar", category: "压缩", desc: "RAR压缩包" },
  ".7z": { mime: "application/x-7z-compressed", category: "压缩", desc: "7z压缩包" },
  ".tar": { mime: "application/x-tar", category: "压缩", desc: "TAR归档" },
  ".gz": { mime: "application/gzip", category: "压缩", desc: "Gzip压缩" },
  ".exe": { mime: "application/x-msdownload", category: "程序", desc: "Windows程序" },
  ".apk": { mime: "application/vnd.android.package-archive", category: "程序", desc: "Android安装包" },
  ".dmg": { mime: "application/x-apple-diskimage", category: "程序", desc: "macOS磁盘映像" },
  ".woff": { mime: "font/woff", category: "字体", desc: "WOFF字体" },
  ".woff2": { mime: "font/woff2", category: "字体", desc: "WOFF2字体" },
  ".ttf": { mime: "font/ttf", category: "字体", desc: "TTF字体" },
  ".otf": { mime: "font/otf", category: "字体", desc: "OTF字体" },
  ".wasm": { mime: "application/wasm", category: "程序", desc: "WebAssembly" },
  ".sql": { mime: "application/sql", category: "数据", desc: "SQL脚本" },
  ".py": { mime: "text/x-python", category: "脚本", desc: "Python" },
  ".go": { mime: "text/x-go", category: "脚本", desc: "Go" },
  ".rs": { mime: "text/x-rust", category: "脚本", desc: "Rust" },
  ".java": { mime: "text/x-java", category: "脚本", desc: "Java" },
  ".c": { mime: "text/x-c", category: "脚本", desc: "C" },
  ".cpp": { mime: "text/x-c++", category: "脚本", desc: "C++" },
  ".sh": { mime: "application/x-sh", category: "脚本", desc: "Shell脚本" },
};

const REVERSE_DB: Record<string, string[]> = {};
for (const [ext, info] of Object.entries(MIME_DB)) {
  if (!REVERSE_DB[info.mime]) REVERSE_DB[info.mime] = [];
  REVERSE_DB[info.mime].push(ext);
}

export const mimeTypeSkill: SkillDefinition = {
  name: "mime_type",
  displayName: "文件类型查询",
  description:
    "查询文件扩展名对应的MIME类型，或反向查询MIME类型对应的扩展名。" +
    "用户说'MIME'、'文件类型'、'Content-Type'、'mime type'时使用。",
  icon: "FileType",
  category: "dev",
  parameters: z.object({
    query: z.string().describe("查询内容: 扩展名(如.jpg)、文件名(如image.png)或MIME类型(如image/jpeg)"),
  }),
  execute: async (params) => {
    const { query } = params as { query: string };
    if (!query?.trim()) return { success: false, message: "❌ 请提供查询内容" };

    const q = query.trim().toLowerCase();

    if (q.includes("/")) {
      const exts = REVERSE_DB[q];
      if (exts) {
        return { success: true, message: `🔍 MIME → 扩展名\n━━━━━━━━━━━━━━━━━━━━\n📋 ${q}\n📁 扩展名: ${exts.join(", ")}` };
      }
      return { success: true, message: `🔍 未找到 MIME 类型 "${q}" 对应的扩展名` };
    }

    const ext = q.startsWith(".") ? q : `.${q.split(".").pop()}`;
    const info = MIME_DB[ext];
    if (info) {
      return {
        success: true,
        message: `🔍 文件类型查询\n━━━━━━━━━━━━━━━━━━━━\n📁 扩展名: ${ext}\n📋 MIME: ${info.mime}\n📂 分类: ${info.category}\n📝 说明: ${info.desc}`,
        data: { ext, mime: info.mime, category: info.category },
      };
    }

    return { success: true, message: `🔍 未找到扩展名 "${ext}" 的MIME类型\n\n💡 常用: .jpg → image/jpeg, .pdf → application/pdf, .json → application/json` };
  },
};
