import { NextResponse } from "next/server";
import { loadAuditLog } from "@/lib/audit-logger";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const riskLevel = url.searchParams.get("riskLevel") || undefined;
  const skillName = url.searchParams.get("skillName") || undefined;

  try {
    const result = await loadAuditLog({ limit, offset, riskLevel, skillName });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询失败" },
      { status: 500 }
    );
  }
}
