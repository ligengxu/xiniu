const TEST_URL = "http://localhost:3000/api/skills/test";

const tests = [
  {
    name: "csv_json_convert",
    displayName: "CSV转JSON",
    params: { input: "name,age,city\nAlice,30,Beijing\nBob,25,Shanghai", direction: "csv2json" },
  },
  {
    name: "csv_json_convert",
    displayName: "JSON转CSV",
    params: { input: '[{"name":"Alice","age":30},{"name":"Bob","age":25}]', direction: "json2csv" },
  },
  {
    name: "todo_manager",
    displayName: "TODO-添加任务",
    params: { action: "add", title: "测试任务-第四轮功能测试", priority: "high", due: "2026-03-15" },
  },
  {
    name: "todo_manager",
    displayName: "TODO-查看列表",
    params: { action: "list" },
  },
  {
    name: "calendar_reminder",
    displayName: "日历-添加事件",
    params: { action: "add", title: "第四轮测试回顾", date: "2026-03-05", time: "14:00", duration: 30 },
  },
  {
    name: "calendar_reminder",
    displayName: "日历-查看事件",
    params: { action: "list" },
  },
  {
    name: "url_shortener",
    displayName: "URL短链生成",
    params: { url: "https://github.com/netease-youdao/LobsterAI" },
  },
  {
    name: "color_convert",
    displayName: "颜色转换-HEX",
    params: { color: "#10b981" },
  },
  {
    name: "color_convert",
    displayName: "颜色转换-RGB",
    params: { color: "rgb(139, 92, 246)" },
  },
  {
    name: "password_checker",
    displayName: "密码检测-弱密码",
    params: { password: "123456" },
  },
  {
    name: "password_checker",
    displayName: "密码检测-强密码",
    params: { password: "Xin!u@2026#Str0ng" },
  },
  {
    name: "timezone_convert",
    displayName: "时区转换",
    params: { time: "now", from_tz: "Asia/Shanghai", to_tz: "America/New_York,Europe/London,Asia/Tokyo" },
  },
  {
    name: "sys_monitor",
    displayName: "系统资源监控",
    params: { detail: true },
  },
];

async function runTests() {
  console.log("=== 第四轮技能功能测试 ===");
  console.log("测试时间: " + new Date().toLocaleString("zh-CN") + "\n");
  
  const results = [];
  
  for (const test of tests) {
    console.log("--- " + test.displayName + " (" + test.name + ") ---");
    const start = Date.now();
    try {
      const res = await fetch(TEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillName: test.name, params: test.params }),
      });
      const data = await res.json();
      const elapsed = Date.now() - start;
      
      if (data.success) {
        console.log("[PASS] " + elapsed + "ms");
        console.log((data.message || "").substring(0, 250));
        results.push({ name: test.name, displayName: test.displayName, status: "PASS", elapsed });
      } else {
        console.log("[FAIL] " + elapsed + "ms - " + data.message);
        results.push({ name: test.name, displayName: test.displayName, status: "FAIL", elapsed, error: data.message });
      }
    } catch (e) {
      const elapsed = Date.now() - start;
      console.log("[ERROR] " + elapsed + "ms - " + e.message);
      results.push({ name: test.name, displayName: test.displayName, status: "ERROR", elapsed, error: e.message });
    }
    console.log("");
  }
  
  console.log("\n=== 测试报告 ===");
  const pass = results.filter(r => r.status === "PASS").length;
  const fail = results.filter(r => r.status !== "PASS").length;
  console.log("通过: " + pass + "/" + results.length + " | 失败: " + fail);
  results.forEach(r => {
    console.log("  " + (r.status === "PASS" ? "[OK]" : "[X]") + " " + r.displayName + " - " + r.elapsed + "ms" + (r.error ? " (" + r.error.substring(0, 60) + ")" : ""));
  });

  // 压力测试
  console.log("\n=== 压力测试（6并发） ===");
  const concurrentTests = [
    { skillName: "color_convert", params: { color: "#FF5733" } },
    { skillName: "password_checker", params: { password: "Test@123!" } },
    { skillName: "timezone_convert", params: { time: "now", from_tz: "Asia/Shanghai", to_tz: "America/New_York" } },
    { skillName: "csv_json_convert", params: { input: "a,b\n1,2\n3,4", direction: "csv2json" } },
    { skillName: "todo_manager", params: { action: "list" } },
    { skillName: "sys_monitor", params: { detail: false } },
  ];
  
  const cStart = Date.now();
  const cResults = await Promise.all(
    concurrentTests.map(async (t) => {
      const s = Date.now();
      try {
        const res = await fetch(TEST_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(t) });
        const data = await res.json();
        return { name: t.skillName, success: data.success, elapsed: Date.now() - s };
      } catch (e) {
        return { name: t.skillName, success: false, elapsed: Date.now() - s, error: e.message };
      }
    })
  );
  console.log("并发6请求总耗时: " + (Date.now() - cStart) + "ms");
  cResults.forEach(r => console.log("  " + (r.success ? "[OK]" : "[X]") + " " + r.name + " - " + r.elapsed + "ms"));

  // 清理测试数据
  console.log("\n清理测试TODO和日历...");
  await fetch(TEST_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skillName: "todo_manager", params: { action: "clear" } }) });
}

runTests();
