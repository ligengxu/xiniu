const BASE = "http://localhost:3000/api/skills/test";

async function test(name, params) {
  const start = Date.now();
  const res = await fetch(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skillName: name, params }) });
  const data = await res.json();
  const ms = Date.now() - start;
  const icon = data.success ? "PASS" : "FAIL";
  console.log(`${icon} ${name.padEnd(22)} ${String(ms).padStart(6)}ms  ${(data.message || "").replace(/\n/g, " ").substring(0, 80)}`);
  return data.success;
}

async function run() {
  console.log("=== Round 2 Skill Tests ===\n");

  await test("hash_calc", { input: "Hello 犀牛", algorithm: "sha256" });
  await test("hash_calc", { input: "Hello 犀牛", algorithm: "md5" });
  await test("base64_tool", { action: "encode", text: "犀牛Agent is awesome!" });
  await test("base64_tool", { action: "decode", text: "54qA54mbQWdlbnQgaXMgYXdlc29tZSE=" });
  await test("json_validator", { json: '{"name":"犀牛","version":"2.0","skills":60}', action: "validate" });
  await test("json_validator", { json: '{"a":{"b":{"c":1},"d":[1,2]}}', action: "paths" });
  await test("json_validator", { json: '{"compact":true,"data":[1,2,3]}', action: "minify" });
  await test("port_scan", { host: "baidu.com", ports: "80,443" });
  await test("text_stats", { text: "犀牛Agent是一个强大的AI助手。它拥有60个技能，能够帮助用户完成各种任务。Hello World!" });
  await test("random_gen", { type: "uuid", count: 3 });
  await test("random_gen", { type: "password", count: 2, length: 20 });
  await test("random_gen", { type: "number", count: 5, min: 1, max: 100 });
  await test("qrcode_gen", { content: "https://github.com/xiniu-agent", savePath: "C:/Users/Administrator/Desktop/test_qr.png" });
  await test("unit_convert", { value: 100, from: "km", to: "mi" });
  await test("unit_convert", { value: 36.5, from: "celsius", to: "fahrenheit" });
  await test("unit_convert", { value: 1024, from: "MB", to: "GB" });
  await test("unit_convert", { value: 10, from: "lb", to: "kg" });
  await test("markdown_to_html", { markdown: "# 犀牛Agent\n\n**60个技能**的AI助手。\n\n## 特性\n\n- 系统工具\n- 浏览器控制\n- 文档生成" });
  await test("markdown_to_html", { markdown: "# Test", savePath: "C:/Users/Administrator/Desktop/test_md.html" });

  console.log("\n=== Stress Test (5 concurrent x 3 rounds) ===\n");
  const stressTests = [
    { name: "hash_calc", params: { input: "stress test data", algorithm: "sha256" } },
    { name: "base64_tool", params: { action: "encode", text: "stress" } },
    { name: "json_validator", params: { json: '{"x":1}', action: "validate" } },
    { name: "text_stats", params: { text: "测试文本统计功能" } },
    { name: "random_gen", params: { type: "uuid", count: 1 } },
    { name: "unit_convert", params: { value: 100, from: "km", to: "mi" } },
  ];

  for (const { name, params } of stressTests) {
    const times = [];
    let passed = 0;
    for (let r = 0; r < 3; r++) {
      const batch = Array(5).fill(null).map(async () => {
        const s = Date.now();
        const res = await fetch(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skillName: name, params }) });
        const d = await res.json();
        times.push(Date.now() - s);
        if (d.success) passed++;
      });
      await Promise.all(batch);
    }
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    console.log(`${name.padEnd(22)} ${passed}/15 passed, avg ${avg}ms`);
  }
}

run().catch(console.error);
