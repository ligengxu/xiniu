const BASE = "http://localhost:3000/api/skills/test";

async function call(name, params) {
  const start = Date.now();
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillName: name, params }),
    });
    const data = await res.json();
    return { ok: data.success, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, err: err.message };
  }
}

async function stressTest(name, params, concurrency, rounds) {
  const results = [];
  for (let r = 0; r < rounds; r++) {
    const batch = Array(concurrency).fill(null).map(() => call(name, params));
    const batchResults = await Promise.all(batch);
    results.push(...batchResults);
  }
  const passed = results.filter(r => r.ok).length;
  const times = results.map(r => r.ms);
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const max = Math.max(...times);
  const min = Math.min(...times);
  return { name, total: results.length, passed, avg, min, max };
}

async function run() {
  console.log("=== Stress Test (5 concurrent x 3 rounds = 15 calls each) ===\n");
  
  const tests = [
    stressTest("system_info", { section: "cpu" }, 5, 3),
    stressTest("clipboard", { action: "read" }, 5, 3),
    stressTest("process_manager", { action: "list", filter: "node" }, 5, 3),
    stressTest("network_diag", { action: "public_ip" }, 3, 2),
    stressTest("file_search", { directory: "C:/Users/Administrator/Desktop/xiniu/src", pattern: "*.ts", maxDepth: 2 }, 5, 3),
    stressTest("http_request", { url: "https://httpbin.org/get", method: "GET", timeout: 10000 }, 3, 2),
    stressTest("data_processor", { rawData: '[{"a":1},{"a":2},{"a":3}]', action: "stats" }, 5, 3),
    stressTest("env_manager", { action: "get", name: "PATH" }, 5, 3),
    stressTest("text_diff", { textA: "a\nb\nc", textB: "a\nx\nc" }, 5, 3),
  ];

  const results = await Promise.all(tests);

  console.log("Tool                  Total  Pass  Avg(ms)  Min(ms)  Max(ms)");
  console.log("-".repeat(70));
  results.forEach(r => {
    const status = r.passed === r.total ? "ALL" : `${r.passed}/${r.total}`;
    console.log(`${r.name.padEnd(22)} ${String(r.total).padStart(4)}   ${status.padStart(4)}   ${String(r.avg).padStart(6)}   ${String(r.min).padStart(6)}   ${String(r.max).padStart(6)}`);
  });

  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalCalls = results.reduce((s, r) => s + r.total, 0);
  console.log(`\n=== Total: ${totalPassed}/${totalCalls} passed ===`);
}

run();
