const TEST_URL = "http://localhost:3000/api/skills/test";

const tests = [
  {
    name: "weather_query",
    displayName: "天气查询",
    params: { city: "北京" },
  },
  {
    name: "currency_convert",
    displayName: "汇率换算",
    params: { amount: 100, from: "USD", to: "CNY" },
  },
  {
    name: "ip_lookup",
    displayName: "IP地理位置查询",
    params: { ip: "8.8.8.8" },
  },
  {
    name: "translate_text",
    displayName: "多语言翻译",
    params: { text: "Hello World, this is a test.", to: "zh" },
  },
  {
    name: "dns_lookup",
    displayName: "DNS域名解析",
    params: { domain: "baidu.com", type: "A" },
  },
  {
    name: "cron_parser",
    displayName: "Cron表达式解析",
    params: { expression: "0 9 * * 1-5", count: 5 },
  },
  {
    name: "regex_tester",
    displayName: "正则表达式测试",
    params: { pattern: "(\\d{4})-(\\d{2})-(\\d{2})", text: "今天是2026-03-01，明天是2026-03-02。", flags: "g" },
  },
  {
    name: "rss_reader",
    displayName: "RSS订阅读取",
    params: { url: "https://feeds.bbci.co.uk/news/technology/rss.xml", limit: 3 },
  },
];

async function runTests() {
  console.log("=== 犀牛技能功能测试 ===\n");
  console.log("测试时间: " + new Date().toLocaleString("zh-CN") + "\n");
  
  const results = [];
  
  for (const test of tests) {
    console.log("--- 测试: " + test.displayName + " (" + test.name + ") ---");
    console.log("参数: " + JSON.stringify(test.params));
    
    const start = Date.now();
    try {
      const res = await fetch(TEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillName: test.name,
          params: test.params,
        }),
      });
      const data = await res.json();
      const elapsed = Date.now() - start;
      
      if (data.success) {
        console.log("[PASS] 耗时: " + elapsed + "ms");
        console.log("结果: " + (data.message || "").substring(0, 300));
        results.push({ name: test.name, displayName: test.displayName, status: "PASS", elapsed, message: data.message });
      } else {
        console.log("[FAIL] 耗时: " + elapsed + "ms");
        console.log("错误: " + data.message);
        results.push({ name: test.name, displayName: test.displayName, status: "FAIL", elapsed, message: data.message });
      }
    } catch (e) {
      const elapsed = Date.now() - start;
      console.log("[ERROR] 耗时: " + elapsed + "ms - " + e.message);
      results.push({ name: test.name, displayName: test.displayName, status: "ERROR", elapsed, message: e.message });
    }
    console.log("");
  }
  
  console.log("\n=== 测试报告 ===");
  console.log("总测试数: " + results.length);
  console.log("通过: " + results.filter(r => r.status === "PASS").length);
  console.log("失败: " + results.filter(r => r.status === "FAIL").length);
  console.log("错误: " + results.filter(r => r.status === "ERROR").length);
  console.log("\n详细结果:");
  results.forEach(r => {
    const icon = r.status === "PASS" ? "[OK]" : r.status === "FAIL" ? "[X]" : "[!]";
    console.log("  " + icon + " " + r.displayName + " - " + r.elapsed + "ms");
  });

  // 压力测试 - 并发测试3个轻量级技能
  console.log("\n=== 压力测试（并发） ===");
  const concurrentTests = [
    { skillName: "dns_lookup", params: { domain: "google.com", type: "A" } },
    { skillName: "regex_tester", params: { pattern: "\\w+", text: "hello world test", flags: "g" } },
    { skillName: "cron_parser", params: { expression: "*/5 * * * *", count: 3 } },
    { skillName: "ip_lookup", params: { ip: "1.1.1.1" } },
    { skillName: "translate_text", params: { text: "Good morning", to: "zh" } },
  ];
  
  const concurrentStart = Date.now();
  const concurrentResults = await Promise.all(
    concurrentTests.map(async (t) => {
      const s = Date.now();
      try {
        const res = await fetch(TEST_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(t),
        });
        const data = await res.json();
        return { name: t.skillName, success: data.success, elapsed: Date.now() - s };
      } catch (e) {
        return { name: t.skillName, success: false, elapsed: Date.now() - s, error: e.message };
      }
    })
  );
  const totalConcurrent = Date.now() - concurrentStart;
  
  console.log("并发5个请求总耗时: " + totalConcurrent + "ms");
  concurrentResults.forEach(r => {
    console.log("  " + (r.success ? "[OK]" : "[X]") + " " + r.name + " - " + r.elapsed + "ms");
  });
  
  console.log("\n测试完成！");
}

runTests();
