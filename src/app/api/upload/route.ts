import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const UPLOAD_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".xiniu",
  "uploads",
);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "没有上传文件" }, { status: 400 });
    }

    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    const saved: Array<{ name: string; path: string; size: number }> = [];

    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const ts = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9_.\-\u4e00-\u9fff]/g, "_");
      const destName = `${ts}_${safeName}`;
      const destPath = path.join(UPLOAD_DIR, destName);
      await fs.writeFile(destPath, buf);
      saved.push({ name: file.name, path: destPath, size: buf.length });
    }

    return NextResponse.json({ success: true, files: saved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "上传失败" },
      { status: 500 },
    );
  }
}
