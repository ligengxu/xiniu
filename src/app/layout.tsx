import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "犀牛 Agent - AI 智能助手",
  description: "强大的中文 AI 代理，支持文件操作、网页浏览、内容处理等多种技能",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
