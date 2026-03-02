const TEST_URL = "http://localhost:3000/api/skills/test";

const tests = [
  {
    name: "translate_text",
    displayName: "多语言翻译(修复后)",
    params: { text: "Hello World, this is a test.", to: "zh", from: "en" },
  },
  {
    name: "cron_parser",
    displayName: "Cron表达式解析(修复后)",
    params: { expression: "0 9 * * 1-5", count: 5 },
  },
  {
    name: "translate_text",
    displayName: "翻译-自动检测中文",
    params: { text: "你好世界", to: "en" },
  },
];

async function runTests() {
  console.log("=== 修复后重新测试 ===\n");
  for (const test of tests) {
    console.log("--- " + test.displayName + " ---");
    const start = Date.now();
    try {
      const res = await fetch(TEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillName: test.name, params: test.params }),
      });
      const data = await res.json();
      const elapsed = Date.now() - start;
      console.log(data.success ? "[PASS]" : "[FAIL]", elapsed + "ms");
      console.log("结果:", (data.message || "").substring(0, 300));
    } catch (e) {
      console.log("[ERROR]", Date.now() - start + "ms", e.message);
    }
    console.log("");
  }
}

runTests();
