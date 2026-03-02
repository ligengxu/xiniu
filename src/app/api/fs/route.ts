import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  extension: string;
}

async function listDirectory(dirPath: string): Promise<FileEntry[]> {
  const resolved = path.resolve(dirPath);
  const entries = await fs.readdir(resolved, { withFileTypes: true });

  const results: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    try {
      const fullPath = path.join(resolved, entry.name);
      const stats = await fs.stat(fullPath);
      results.push({
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        size: stats.size,
        modified: stats.mtime.toISOString(),
        extension: entry.isDirectory() ? "" : path.extname(entry.name).slice(1),
      });
    } catch {
      continue;
    }
  }

  results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dirPath = url.searchParams.get("path") || "C:/Users/Administrator/Desktop";
  const action = url.searchParams.get("action") || "list";

  try {
    if (action === "read") {
      const filePath = url.searchParams.get("path");
      if (!filePath) return NextResponse.json({ error: "缺少path参数" }, { status: 400 });
      const content = await fs.readFile(path.resolve(filePath), "utf-8");
      return NextResponse.json({ content, path: filePath });
    }

    const entries = await listDirectory(dirPath);
    return NextResponse.json({ entries, path: dirPath });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "读取目录失败" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const { action, sourcePath, destPath, name } = body;

  try {
    switch (action) {
      case "mkdir": {
        const resolved = path.resolve(sourcePath);
        await fs.mkdir(resolved, { recursive: true });
        return NextResponse.json({ success: true, message: `目录已创建: ${resolved}` });
      }
      case "rename": {
        const src = path.resolve(sourcePath);
        const dest = path.join(path.dirname(src), name);
        await fs.rename(src, dest);
        return NextResponse.json({ success: true, message: `已重命名为: ${name}` });
      }
      case "copy": {
        const src = path.resolve(sourcePath);
        const dest = path.resolve(destPath);
        await fs.cp(src, dest, { recursive: true });
        return NextResponse.json({ success: true, message: `已复制到: ${dest}` });
      }
      case "move": {
        const src = path.resolve(sourcePath);
        const dest = path.resolve(destPath);
        await fs.rename(src, dest);
        return NextResponse.json({ success: true, message: `已移动到: ${dest}` });
      }
      default:
        return NextResponse.json({ error: "未知操作" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "操作失败" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const filePath = url.searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "缺少path参数" }, { status: 400 });
  }

  try {
    const resolved = path.resolve(filePath);
    const stats = await fs.stat(resolved);
    await fs.rm(resolved, { recursive: stats.isDirectory() });
    return NextResponse.json({ success: true, message: `已删除: ${resolved}` });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "删除失败" },
      { status: 500 }
    );
  }
}
