const BASE = "http://localhost:3000/api/skills/test";

async function test(name, params) {
  const start = Date.now();
  const res = await fetch(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skillName: name, params }) });
  const data = await res.json();
  const ms = Date.now() - start;
  const icon = data.success ? "PASS" : "FAIL";
  console.log(`${icon} ${name.padEnd(20)} ${String(ms).padStart(6)}ms  ${(data.message || "").substring(0, 100).replace(/\n/g, " ")}`);
  return data.success;
}

async function run() {
  console.log("=== Fix Verification ===\n");
  
  // 1. PDF with Chinese
  const p1 = await test("generate_pdf", { title: "犀牛Agent测试报告", content: "这是一份中文PDF测试文档。\n\n包含犀牛Agent的功能验证结果。\n\n所有50个技能测试通过！", savePath: "C:/Users/Administrator/Desktop/test_cn_pdf.pdf" });

  // 2. Read the generated PDF
  if (p1) {
    await test("read_pdf", { source: "C:/Users/Administrator/Desktop/test_cn_pdf.pdf" });
  }

  // 3. batch_files with correct params
  await test("batch_files", { action: "copy", sourcePaths: ["C:/Users/Administrator/Desktop/test_cn_pdf.pdf"], destDir: "C:/Users/Administrator/Desktop/xiniu_test_dir" });

  // 4. schedule + cancel with correct flow
  const schedRes = await fetch(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skillName: "schedule_task", params: { name: "fix_test", description: "验证取消", schedule: "every 1h", steps: [{ skillName: "system_info", params: { section: "cpu" } }] } }) });
  const schedData = await schedRes.json();
  console.log("SCHEDULE:", schedData.success ? "OK" : "FAIL", schedData.message?.substring(0, 80));
  
  if (schedData.success && schedData.data?.taskId) {
    await test("cancel_schedule", { taskId: schedData.data.taskId, action: "delete" });
  }

  console.log("\nDone!");
}

run().catch(console.error);
