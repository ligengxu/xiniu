const BASE = "http://localhost:3000/api/skills/test";

async function test(name, params) {
  const start = Date.now();
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillName: name, params }),
    });
    const data = await res.json();
    const ms = Date.now() - start;
    return { name, ok: data.success, ms, msg: (data.message || "").substring(0, 120) };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - start, msg: err.message };
  }
}

async function run() {
  console.log("=== System Tools Direct Test ===\n");
  
  const cases = [
    test("system_info", { section: "cpu" }),
    test("system_info", { section: "memory" }),
    test("system_info", { section: "os" }),
    test("system_info", { section: "network" }),
    test("clipboard", { action: "write", text: "Xiniu Test 123" }),
  ];

  let results = [];
  for (const c of cases) results.push(await c);

  const cases2 = [
    test("clipboard", { action: "read" }),
    test("process_manager", { action: "list", filter: "node" }),
    test("network_diag", { action: "public_ip" }),
    test("file_search", { directory: "C:/Users/Administrator/Desktop/xiniu", pattern: "*.json", maxDepth: 1 }),
    test("http_request", { url: "https://httpbin.org/get", method: "GET", timeout: 10000 }),
    test("data_processor", { rawData: '[{"name":"Alice","age":30},{"name":"Bob","age":25},{"name":"Charlie","age":35}]', action: "stats" }),
    test("data_processor", { rawData: 'name,score\nAlice,95\nBob,87\nCharlie,92', action: "head", limit: 10, outputFormat: "markdown" }),
    test("env_manager", { action: "get", name: "COMPUTERNAME" }),
    test("env_manager", { action: "set", name: "XINIU_TEST", value: "round1" }),
    test("env_manager", { action: "get", name: "XINIU_TEST" }),
    test("text_diff", { textA: "line1\nline2\nline3", textB: "line1\nmodified\nline3\nline4" }),
  ];
  for (const c of cases2) results.push(await c);

  console.log("No  Tool                  Status  Time    Preview");
  console.log("-".repeat(100));
  results.forEach((r, i) => {
    const icon = r.ok ? "PASS" : "FAIL";
    const preview = r.msg.replace(/\n/g, " ").substring(0, 60);
    console.log(`${String(i+1).padStart(2)}  ${r.name.padEnd(22)} ${icon.padEnd(6)}  ${String(r.ms).padStart(5)}ms  ${preview}`);
  });

  const passed = results.filter(r => r.ok).length;
  console.log(`\n=== ${passed}/${results.length} PASSED ===`);
  
  if (passed < results.length) {
    console.log("\nFailed:");
    results.filter(r => !r.ok).forEach(r => console.log(`  ${r.name}: ${r.msg}`));
  }
}

run();
