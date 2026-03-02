import { NextResponse } from "next/server";
import {
  loadLongTermMemory,
  addMemoryFact,
  removeMemoryFact,
  updateMemoryFact,
  getMemoryStats,
} from "@/lib/memory-manager";

export async function GET() {
  try {
    const [facts, stats] = await Promise.all([
      loadLongTermMemory(),
      getMemoryStats(),
    ]);
    return NextResponse.json({ facts, stats });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "读取失败" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const { action, fact, factId, updates } = body;

  try {
    switch (action) {
      case "add": {
        const newFact = await addMemoryFact(fact);
        return NextResponse.json({ success: true, fact: newFact });
      }
      case "remove": {
        await removeMemoryFact(factId);
        return NextResponse.json({ success: true, message: "记忆已删除" });
      }
      case "update": {
        await updateMemoryFact(factId, updates);
        return NextResponse.json({ success: true, message: "记忆已更新" });
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
