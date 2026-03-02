import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xiniu Agent",
  description: "Full-stack AI Agent platform with 100+ skills",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
