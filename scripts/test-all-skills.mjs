const BASE = "http://localhost:3000";

async function testSkill(name, params) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}/api/skills/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillName: name, params }),
    });
    const data = await res.json();
    const ms = Date.now() - start;
    return { name, ok: data.success, ms, msg: (data.message || "").substring(0, 80), status: res.status };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - start, msg: err.message, status: 0 };
  }
}

async function run() {
  console.log("=== Full Skill Test Suite ===\n");
  const results = [];

  // Group 1: File operations (correct param names)
  results.push(await testSkill("create_folder", { folderPath: "C:/Users/Administrator/Desktop/xiniu_test_dir" }));
  results.push(await testSkill("create_txt", { filePath: "C:/Users/Administrator/Desktop/xiniu_test.txt", content: "犀牛测试内容" }));

  // Group 2: Web
  results.push(await testSkill("open_webpage", { url: "https://www.baidu.com" }));
  results.push(await testSkill("browse_webpage", { url: "https://httpbin.org/html" }));
  results.push(await testSkill("summarize_webpage", { url: "https://httpbin.org/html" }));

  // Group 3: Download
  results.push(await testSkill("download_file", { url: "https://httpbin.org/robots.txt", savePath: "C:/Users/Administrator/Desktop/test_dl.txt" }));
  results.push(await testSkill("download_images", { url: "https://httpbin.org/html", savePath: "C:/Users/Administrator/Desktop/xiniu_test_dir" }));

  // Group 4: Document generation (correct params)
  results.push(await testSkill("generate_word", { title: "测试报告", content: "犀牛Agent技能测试报告\\n\\n功能验证通过。", savePath: "C:/Users/Administrator/Desktop/test_report.docx" }));
  results.push(await testSkill("generate_excel", { sheetName: "成绩", headers: ["姓名", "分数"], rows: [["Alice", "95"], ["Bob", "87"]], savePath: "C:/Users/Administrator/Desktop/test_scores.xlsx" }));
  results.push(await testSkill("generate_ppt", { title: "犀牛Agent", subtitle: "技能测试", slides: [{ title: "功能概览", content: "50+技能" }, { title: "架构", content: "Next.js + AI SDK" }], savePath: "C:/Users/Administrator/Desktop/test_ppt.pptx" }));
  results.push(await testSkill("generate_pdf", { title: "犀牛测试", content: "这是一份测试PDF文档。\n\n犀牛Agent v2.0", savePath: "C:/Users/Administrator/Desktop/test_pdf.pdf" }));

  // Group 5: Search
  results.push(await testSkill("web_search", { query: "2026年AI新闻" }));
  results.push(await testSkill("search_plan", { query: "人工智能突破", count: 3 }));

  // Group 6: Code execution
  results.push(await testSkill("run_code", { code: "console.log('Hello!'); console.log(Math.PI);", language: "javascript" }));

  // Group 7: File analysis (correct params)
  results.push(await testSkill("analyze_file", { filePath: "C:/Users/Administrator/Desktop/xiniu_test.txt" }));
  results.push(await testSkill("read_pdf", { source: "C:/Users/Administrator/Desktop/test_pdf.pdf" }));

  // Group 8: Batch files
  results.push(await testSkill("batch_files", { action: "list", directory: "C:/Users/Administrator/Desktop/xiniu/src/skills", pattern: "*.ts" }));

  // Group 9: Browser automation
  results.push(await testSkill("browser_open", { url: "https://httpbin.org/html", sessionId: "auto_test", headless: true }));
  results.push(await testSkill("browser_read_dom", { sessionId: "auto_test", mode: "text" }));
  results.push(await testSkill("browser_screenshot", { sessionId: "auto_test", fullPage: false }));
  results.push(await testSkill("browser_scroll", { sessionId: "auto_test", direction: "down", pixels: 200 }));
  results.push(await testSkill("browser_script", { sessionId: "auto_test", script: "document.title" }));
  results.push(await testSkill("browser_wait", { sessionId: "auto_test", ms: 300 }));
  results.push(await testSkill("browser_close", { sessionId: "auto_test" }));

  // Group 10: Scheduler
  results.push(await testSkill("schedule_task", { name: "test_task", description: "测试", schedule: "every 1h", steps: [{ skillName: "system_info", params: { section: "cpu" } }] }));
  results.push(await testSkill("list_schedules", {}));
  results.push(await testSkill("cancel_schedule", { taskId: "test_task" }));

  // Group 11: System tools
  results.push(await testSkill("system_info", { section: "all" }));
  results.push(await testSkill("clipboard", { action: "write", text: "全量测试" }));
  results.push(await testSkill("clipboard", { action: "read" }));
  results.push(await testSkill("process_manager", { action: "list", filter: "node" }));
  results.push(await testSkill("network_diag", { action: "public_ip" }));
  results.push(await testSkill("network_diag", { action: "port", host: "baidu.com", port: 443 }));
  results.push(await testSkill("file_search", { directory: "C:/Users/Administrator/Desktop/xiniu/src", pattern: "*.ts", maxDepth: 1 }));
  results.push(await testSkill("zip_files", { action: "compress", source: "C:/Users/Administrator/Desktop/xiniu/README.md", destination: "C:/Users/Administrator/Desktop/test_zip.zip" }));
  results.push(await testSkill("zip_files", { action: "extract", source: "C:/Users/Administrator/Desktop/test_zip.zip", destination: "C:/Users/Administrator/Desktop/xiniu_test_dir/unzipped" }));
  results.push(await testSkill("http_request", { url: "https://httpbin.org/get", method: "GET", timeout: 10000 }));
  results.push(await testSkill("http_request", { url: "https://httpbin.org/post", method: "POST", body: '{"agent":"xiniu"}', timeout: 10000 }));
  results.push(await testSkill("data_processor", { rawData: '[{"city":"北京","pop":2171},{"city":"上海","pop":2489}]', action: "stats" }));
  results.push(await testSkill("data_processor", { rawData: 'name,score\nAlice,95\nBob,87', action: "head", limit: 5, outputFormat: "markdown" }));
  results.push(await testSkill("env_manager", { action: "get", name: "COMPUTERNAME" }));
  results.push(await testSkill("env_manager", { action: "list", filter: "NODE" }));
  results.push(await testSkill("text_diff", { textA: "v1\nline2\nline3", textB: "v2\nline2\nline3\nline4" }));

  // Group 12: User skills existence check
  for (const sk of ["text_translator", "sentiment_analysis", "code_reviewer", "email_drafter", "keyword_extractor",
                     "content_classifier", "data_converter", "meeting_minutes", "regex_helper", "api_tester"]) {
    const res = await fetch(`${BASE}/api/skills/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skillName: sk, params: {} }) });
    results.push({ name: sk, ok: res.status !== 404, ms: 0, msg: res.status === 404 ? "NOT FOUND" : "found", status: res.status });
  }

  // Print results
  console.log("No  Skill                      Status  Time    Preview");
  console.log("-".repeat(110));
  let passed = 0, failed = 0, skipped = 0;
  results.forEach((r, i) => {
    const icon = r.ok ? "PASS" : "FAIL";
    if (r.ok) passed++; else failed++;
    const preview = (r.msg || "").replace(/\n/g, " ").substring(0, 50);
    console.log(`${String(i+1).padStart(2)}  ${r.name.padEnd(28)} ${icon.padEnd(6)}  ${String(r.ms).padStart(5)}ms  ${preview}`);
  });

  console.log(`\n=== ${passed}/${results.length} PASSED, ${failed} FAILED ===`);

  if (failed > 0) {
    console.log("\nFailed:");
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.name}: ${r.msg}`));
  }
}

run().catch(console.error);
