import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";
import { getSessionPage, getSessionStatus, getOrRecoverPage } from "@/lib/puppeteer-render";

function jsBeautify(code: string): string {
  let result = "";
  let indent = 0;
  let inString: string | null = null;
  let escaped = false;
  const tab = "  ";

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1] || "";

    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === "\\") { result += ch; escaped = true; continue; }

    if (inString) {
      result += ch;
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") { result += ch; inString = ch; continue; }

    if (ch === "{" || ch === "[") {
      result += ch;
      indent++;
      if (next !== "}" && next !== "]") result += "\n" + tab.repeat(indent);
      continue;
    }
    if (ch === "}" || ch === "]") {
      indent = Math.max(0, indent - 1);
      const prev = result.trimEnd();
      if (!prev.endsWith("\n")) result += "\n" + tab.repeat(indent);
      result += ch;
      if (next === "," || next === ";" || next === ")") { /* no newline */ }
      else if (next && next !== "}" && next !== "]" && next !== "\n") result += "\n" + tab.repeat(indent);
      continue;
    }
    if (ch === ";" && next !== "\n") {
      result += ";\n" + tab.repeat(indent);
      continue;
    }
    if (ch === "," && next !== "\n" && next !== " ") {
      result += ",\n" + tab.repeat(indent);
      continue;
    }
    result += ch;
  }

  return result
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*\n/gm, "")
    .trim();
}

function analyzeObfuscation(code: string): {
  score: number;
  indicators: string[];
  encryptionPatterns: string[];
  suspiciousFunctions: string[];
} {
  const indicators: string[] = [];
  const encryptionPatterns: string[] = [];
  const suspiciousFunctions: string[] = [];
  let score = 0;

  if (/\b(eval|Function)\s*\(/.test(code)) { indicators.push("使用eval/Function动态执行代码"); score += 30; }
  if (/\\x[0-9a-f]{2}/i.test(code)) { indicators.push("包含十六进制转义字符串"); score += 15; }
  if (/\\u[0-9a-f]{4}/i.test(code)) { indicators.push("包含Unicode转义字符串"); score += 10; }
  if (/atob\s*\(/.test(code)) { indicators.push("使用Base64解码(atob)"); score += 10; }
  if (/String\.fromCharCode/.test(code)) { indicators.push("使用String.fromCharCode动态构造字符串"); score += 20; }
  if (/\bcharCodeAt\b/.test(code)) { indicators.push("使用charCodeAt可能做字符级加密"); score += 5; }
  if (/\b_0x[a-f0-9]+\b/.test(code)) { indicators.push("包含_0x前缀变量名(典型obfuscator.io特征)"); score += 40; }
  if (/\bvar\s+_\w{1,2}\s*=/.test(code) && (code.match(/\bvar\s+_\w{1,2}\s*=/g) || []).length > 10) {
    indicators.push("大量单字符/双字符变量名(混淆器特征)"); score += 25;
  }
  if (/\bdebugger\b/.test(code)) { indicators.push("包含debugger语句(可能是反调试)"); score += 15; }

  const cryptoRegex = /\b(MD5|SHA1|SHA256|SHA512|AES|DES|RSA|HMAC|CryptoJS|JSEncrypt|forge|sjcl|pbkdf2|bcrypt)\b/gi;
  const matches = code.match(cryptoRegex) || [];
  const unique = [...new Set(matches.map((m) => m.toLowerCase()))];
  unique.forEach((m) => encryptionPatterns.push(m));
  score += unique.length * 5;

  const signRegex = /\b(sign|signature|token|secret|key|encrypt|decrypt|hash|digest|hmac|cipher|nonce|timestamp|appkey|appsecret)\s*[=:(]/gi;
  const signMatches = code.match(signRegex) || [];
  const uniqueSign = [...new Set(signMatches.map((m) => m.replace(/[=:(]/g, "").trim().toLowerCase()))];
  uniqueSign.forEach((m) => suspiciousFunctions.push(m));

  return { score: Math.min(score, 100), indicators, encryptionPatterns, suspiciousFunctions };
}

// ==================== Webpack 解析核心 ====================

interface WpModule {
  id: string | number;
  code: string;
  deps: (string | number)[];
  isEntry: boolean;
  hasExports: boolean;
  size: number;
}

interface WpAnalysis {
  format: "webpack4" | "webpack5" | "jsonp_push" | "unknown";
  loaderVar: string;
  entryModules: (string | number)[];
  modules: Map<string | number, WpModule>;
  chunkIds: string[];
}

function analyzeWebpack(code: string): WpAnalysis {
  const result: WpAnalysis = {
    format: "unknown", loaderVar: "", entryModules: [],
    modules: new Map(), chunkIds: [],
  };

  // Webpack 4/5 loader 检测
  const wp5 = code.match(/(?:var|let|const)\s+(__webpack_modules__|__webpack_require__)\b/);
  const wpJsonp = code.match(/(?:self|window|globalThis)\s*\.\s*(\w*(?:webpackChunk|LOADABLE_LOADED_CHUNKS|__LOADABLE_LOADED_CHUNKS__)\w*)/);
  const wp4Boot = code.match(/function\s*\(\s*modules\s*\)\s*\{\s*(?:\/\/.*\n\s*)*(?:var|let|const)?\s*installedModules\s*=/);

  if (wp5) {
    result.format = "webpack5";
    result.loaderVar = wp5[1];
  } else if (wpJsonp) {
    result.format = "jsonp_push";
    result.loaderVar = wpJsonp[1];
  } else if (wp4Boot) {
    result.format = "webpack4";
    result.loaderVar = "__webpack_require__";
  }

  // chunk ID 提取
  const chunkIdRe = /(?:webpackChunk|LOADED_CHUNKS)\w*\.push\s*\(\s*\[\s*\[([^\]]+)\]/g;
  let cm;
  while ((cm = chunkIdRe.exec(code)) !== null) {
    result.chunkIds.push(cm[1].trim());
  }

  // 模块提取: 匹配 moduleId: function(module, exports, __webpack_require__) { ... }
  // 或 moduleId: (module, __webpack_exports__, __webpack_require__) => { ... }
  const lines = code.split("\n");
  const moduleStartRe = /^[\s,]*(?:["']?(\d+|[\w/.-]+)["']?|(\d+))\s*:\s*(?:function\s*\(\s*([\w,\s]*)\)|(?:\(\s*([\w,\s]*)\)\s*=>))\s*\{/;

  let braceDepth = 0;
  let currentModId: string | number | null = null;
  let currentModStart = -1;
  let currentModCode = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (currentModId === null) {
      const mm = moduleStartRe.exec(line);
      if (mm) {
        currentModId = mm[1] || mm[2];
        if (/^\d+$/.test(String(currentModId))) currentModId = Number(currentModId);
        currentModStart = i;
        currentModCode = line + "\n";
        braceDepth = 0;
        for (const ch of line) {
          if (ch === "{") braceDepth++;
          if (ch === "}") braceDepth--;
        }
        if (braceDepth <= 0 && line.includes("{")) {
          finishModule();
        }
        continue;
      }
    }

    if (currentModId !== null) {
      currentModCode += line + "\n";
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }
      if (braceDepth <= 0) {
        finishModule();
      }
    }
  }

  function finishModule() {
    if (currentModId === null) return;
    const deps: (string | number)[] = [];
    const reqRe = /__webpack_require__\(\s*(?:["']([^"']+)["']|(\d+))\s*\)/g;
    let dm;
    while ((dm = reqRe.exec(currentModCode)) !== null) {
      const dep = dm[1] || Number(dm[2]);
      if (!deps.includes(dep)) deps.push(dep);
    }

    result.modules.set(currentModId, {
      id: currentModId,
      code: currentModCode,
      deps,
      isEntry: /module\.exports\s*=|exports\.__esModule|__webpack_exports__/.test(currentModCode),
      hasExports: /exports\.|module\.exports|__webpack_exports__/.test(currentModCode),
      size: currentModCode.length,
    });

    currentModId = null;
    currentModCode = "";
    currentModStart = -1;
    braceDepth = 0;
  }

  // 入口检测
  const entryRe = /__webpack_require__\.s\s*=\s*(?:["']([^"']+)["']|(\d+))|__webpack_require__\((?:["']([^"']+)["']|(\d+))\)\s*;?\s*(?:$|\n|\/\/)/gm;
  let em;
  while ((em = entryRe.exec(code)) !== null) {
    const eid = em[1] || em[2] || em[3] || em[4];
    if (eid && !result.entryModules.includes(isNaN(Number(eid)) ? eid : Number(eid))) {
      result.entryModules.push(isNaN(Number(eid)) ? eid : Number(eid));
    }
  }

  return result;
}

function extractModuleWithDeps(wp: WpAnalysis, targetId: string | number, maxDepth = 10): { modules: WpModule[]; missing: (string | number)[] } {
  const collected = new Map<string | number, WpModule>();
  const missing: (string | number)[] = [];
  const visited = new Set<string | number>();

  function walk(id: string | number, depth: number) {
    if (depth > maxDepth || visited.has(id)) return;
    visited.add(id);
    const mod = wp.modules.get(id) || wp.modules.get(String(id)) || wp.modules.get(Number(id));
    if (!mod) { if (!missing.includes(id)) missing.push(id); return; }
    collected.set(id, mod);
    for (const dep of mod.deps) walk(dep, depth + 1);
  }

  walk(targetId, 0);
  return { modules: Array.from(collected.values()), missing };
}

function generateStandaloneJs(wp: WpAnalysis, modules: WpModule[], entryId: string | number): string {
  let out = "// ===== 补环境 =====\n";
  out += generateEnvCode();
  out += "\n\n// ===== Webpack Loader =====\n";
  out += "var __webpack_modules__ = {\n";

  for (const mod of modules) {
    const cleanCode = mod.code.replace(/^[\s,]*(?:["']?\w+["']?)\s*:\s*/, "");
    out += `  ${JSON.stringify(String(mod.id))}: ${cleanCode},\n`;
  }

  out += "};\n\n";
  out += `var __webpack_module_cache__ = {};\n`;
  out += `function __webpack_require__(moduleId) {\n`;
  out += `  var cachedModule = __webpack_module_cache__[moduleId];\n`;
  out += `  if (cachedModule !== undefined) return cachedModule.exports;\n`;
  out += `  var module = __webpack_module_cache__[moduleId] = { id: moduleId, loaded: false, exports: {} };\n`;
  out += `  __webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);\n`;
  out += `  module.loaded = true;\n`;
  out += `  return module.exports;\n`;
  out += `}\n\n`;
  out += `// ===== __webpack_require__ 辅助方法 =====\n`;
  out += `__webpack_require__.n = function(module) {\n`;
  out += `  var getter = module && module.__esModule ? function() { return module["default"]; } : function() { return module; };\n`;
  out += `  __webpack_require__.d(getter, { a: getter });\n`;
  out += `  return getter;\n`;
  out += `};\n`;
  out += `__webpack_require__.d = function(exports, definition) {\n`;
  out += `  for (var key in definition) {\n`;
  out += `    if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {\n`;
  out += `      Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });\n`;
  out += `    }\n`;
  out += `  }\n`;
  out += `};\n`;
  out += `__webpack_require__.o = function(obj, prop) { return Object.prototype.hasOwnProperty.call(obj, prop); };\n`;
  out += `__webpack_require__.r = function(exports) {\n`;
  out += `  if (typeof Symbol !== "undefined" && Symbol.toStringTag) Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n`;
  out += `  Object.defineProperty(exports, "__esModule", { value: true });\n`;
  out += `};\n`;
  out += `__webpack_require__.e = function() { return Promise.resolve(); };\n`;
  out += `__webpack_require__.t = function(value, mode) { if (mode & 1) value = __webpack_require__(value); return value; };\n\n`;

  out += `// ===== 入口执行 =====\n`;
  out += `try {\n`;
  out += `  var result = __webpack_require__(${JSON.stringify(String(entryId))});\n`;
  out += `  console.log("[+] 模块加载成功:", typeof result);\n`;
  out += `  if (typeof result === "object" && result !== null) {\n`;
  out += `    console.log("[+] 导出的 keys:", Object.keys(result).slice(0, 20));\n`;
  out += `    // 自动检测 PDD anti_content 相关导出\n`;
  out += `    for (var k of Object.keys(result)) {\n`;
  out += `      var v = result[k];\n`;
  out += `      if (typeof v === "function") {\n`;
  out += `        console.log("[+] 函数导出:", k, "->", String(v).slice(0, 100));\n`;
  out += `        // 尝试调用 messagePack/getAntiContent\n`;
  out += `        if (k.toLowerCase().includes("messagepack") || k.toLowerCase().includes("anticontent") || k.toLowerCase().includes("anti_content")) {\n`;
  out += `          try { var r = v({serverTime: Date.now()}); console.log("[+] 调用 " + k + " 结果:", typeof r === "string" ? r.slice(0, 200) : r); } catch(e) { console.log("[!] 调用 " + k + " 失败:", e.message); }\n`;
  out += `        }\n`;
  out += `      }\n`;
  out += `    }\n`;
  out += `    if (result.default) console.log("[+] default 导出:", typeof result.default, typeof result.default === "function" ? String(result.default).slice(0, 100) : "");\n`;
  out += `    // 如果是类（构造函数），尝试实例化\n`;
  out += `    if (typeof result === "function" || typeof result.default === "function") {\n`;
  out += `      var Cls = typeof result === "function" ? result : result.default;\n`;
  out += `      try {\n`;
  out += `        var inst = new Cls({serverTime: Date.now()});\n`;
  out += `        console.log("[+] 实例化成功, methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(inst)).filter(function(n){return n!=="constructor"}));\n`;
  out += `        if (typeof inst.messagePack === "function") {\n`;
  out += `          var packed = inst.messagePack();\n`;
  out += `          console.log("[+] messagePack() 结果:", typeof packed === "string" ? packed.slice(0, 300) : packed);\n`;
  out += `        }\n`;
  out += `        if (typeof inst.messagePackSync === "function") {\n`;
  out += `          var packed2 = inst.messagePackSync();\n`;
  out += `          console.log("[+] messagePackSync() 结果:", typeof packed2 === "string" ? packed2.slice(0, 300) : packed2);\n`;
  out += `        }\n`;
  out += `      } catch(e) { console.log("[!] 实例化失败:", e.message); }\n`;
  out += `    }\n`;
  out += `  } else if (typeof result === "function") {\n`;
  out += `    console.log("[+] 导出的是函数:", String(result).slice(0, 150));\n`;
  out += `    try { var r2 = result(); console.log("[+] 调用结果:", r2); } catch(e) { console.log("[!] 直接调用失败:", e.message); }\n`;
  out += `  }\n`;
  out += `} catch(e) {\n`;
  out += `  console.log("[!] 模块加载失败:", e.message);\n`;
  out += `  console.log("[!] 错误位置:", e.stack?.split("\\n").slice(0,5).join("\\n"));\n`;
  out += `  console.log("[*] 可能缺少补环境项，请根据报错信息补充对应的全局对象或属性");\n`;
  out += `}\n`;

  return out;
}

function generateEnvCode(): string {
  return `// ===== 浏览器环境模拟 =====
var window = global || globalThis;
var self = window;
var globalThis = window;

var location = {
  href: "https://example.com/", protocol: "https:", host: "example.com",
  hostname: "example.com", port: "", pathname: "/", search: "", hash: "",
  origin: "https://example.com", ancestorOrigins: {},
  assign: function(url) { this.href = url; },
  replace: function(url) { this.href = url; },
  reload: function() {},
  toString: function() { return this.href; },
};

var navigator = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  platform: "Win32", language: "zh-CN", languages: ["zh-CN","zh","en"],
  appName: "Netscape", appVersion: "5.0", vendor: "Google Inc.",
  onLine: true, cookieEnabled: true, doNotTrack: null,
  hardwareConcurrency: 8, maxTouchPoints: 0,
  plugins: { length: 0 }, mimeTypes: { length: 0 },
  getBattery: function() { return Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1 }); },
  sendBeacon: function() { return true; },
  clipboard: { writeText: function() { return Promise.resolve(); } },
  mediaDevices: { enumerateDevices: function() { return Promise.resolve([]); } },
};

var document = {
  cookie: "", title: "", referrer: "", domain: "example.com",
  URL: location.href, documentURI: location.href,
  characterSet: "UTF-8", contentType: "text/html",
  readyState: "complete", hidden: false, visibilityState: "visible",
  head: { appendChild: function() {}, removeChild: function() {} },
  body: { appendChild: function() {}, removeChild: function() {}, clientWidth: 1920, clientHeight: 1080, style: {} },
  documentElement: { clientWidth: 1920, clientHeight: 1080, style: {} },
  createElement: function(tag) {
    var el = { tagName: tag.toUpperCase(), style: {}, children: [], childNodes: [],
      setAttribute: function(k,v) { this[k] = v; },
      getAttribute: function(k) { return this[k]; },
      appendChild: function(c) { this.children.push(c); return c; },
      removeChild: function() {}, addEventListener: function() {},
      removeEventListener: function() {},
      getElementsByTagName: function() { return []; },
      classList: { add: function(){}, remove: function(){}, contains: function(){ return false; } },
      innerHTML: "", innerText: "", textContent: "", src: "", href: "", id: "",
      offsetWidth: 100, offsetHeight: 100, clientWidth: 100, clientHeight: 100,
    };
    if (tag === "canvas") {
      el.getContext = function() {
        return { fillRect:function(){}, clearRect:function(){}, getImageData:function(x,y,w,h){return{data:new Uint8Array(w*h*4)}},
          putImageData:function(){}, createImageData:function(){return{data:[]}},
          setTransform:function(){}, drawImage:function(){}, save:function(){}, fillText:function(){},
          restore:function(){}, beginPath:function(){}, moveTo:function(){}, lineTo:function(){},
          closePath:function(){}, stroke:function(){}, translate:function(){}, scale:function(){},
          rotate:function(){}, arc:function(){}, fill:function(){}, measureText:function(t){return{width:t.length*6}},
          transform:function(){}, rect:function(){}, clip:function(){}, font:"10px sans-serif",
          fillStyle:"#000", strokeStyle:"#000", globalAlpha:1, globalCompositeOperation:"source-over",
          canvas: el, toDataURL: function(){ return "data:image/png;base64,"; },
        };
      };
      el.toDataURL = function() { return "data:image/png;base64,iVBORw0KGgo="; };
      el.width = 300; el.height = 150;
    }
    return el;
  },
  getElementById: function() { return null; },
  getElementsByClassName: function() { return []; },
  getElementsByTagName: function(t) { if(t==="script") return []; return []; },
  querySelector: function() { return null; },
  querySelectorAll: function() { return []; },
  addEventListener: function() {},
  removeEventListener: function() {},
  createEvent: function() { return { initEvent: function(){} }; },
  createTextNode: function(t) { return { textContent: t }; },
};

var screen = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24, orientation: { type: "landscape-primary", angle: 0 } };

var history = { length: 1, state: null, pushState: function(){}, replaceState: function(){}, go: function(){}, back: function(){}, forward: function(){} };

var localStorage = (function() { var s = {}; return { getItem: function(k){return s[k]||null;}, setItem: function(k,v){s[k]=String(v);}, removeItem: function(k){delete s[k];}, clear: function(){s={};}, get length(){return Object.keys(s).length;}, key: function(i){return Object.keys(s)[i]||null;} }; })();
var sessionStorage = (function() { var s = {}; return { getItem: function(k){return s[k]||null;}, setItem: function(k,v){s[k]=String(v);}, removeItem: function(k){delete s[k];}, clear: function(){s={};}, get length(){return Object.keys(s).length;}, key: function(i){return Object.keys(s)[i]||null;} }; })();

var XMLHttpRequest = function() { this.readyState = 0; this.status = 0; this.responseText = ""; };
XMLHttpRequest.prototype = { open: function(){}, send: function(){}, setRequestHeader: function(){}, getResponseHeader: function(){return null;}, getAllResponseHeaders: function(){return "";}, addEventListener: function(){}, abort: function(){} };

var Image = function() { this.src = ""; this.onload = null; this.onerror = null; this.width = 0; this.height = 0; this.naturalWidth = 0; this.naturalHeight = 0; };
var Audio = function() { this.src = ""; };
var Event = function(type) { this.type = type; this.target = null; this.defaultPrevented = false; this.preventDefault = function(){}; this.stopPropagation = function(){}; };

var setTimeout = global.setTimeout || function(fn,ms) { if(typeof fn==="function") fn(); };
var setInterval = global.setInterval || function() { return 0; };
var clearTimeout = global.clearTimeout || function() {};
var clearInterval = global.clearInterval || function() {};
var requestAnimationFrame = function(cb) { return setTimeout(cb, 16); };
var cancelAnimationFrame = function(id) { clearTimeout(id); };

var atob = global.atob || function(s) { return Buffer.from(s, "base64").toString("binary"); };
var btoa = global.btoa || function(s) { return Buffer.from(s, "binary").toString("base64"); };

var crypto = global.crypto || { getRandomValues: function(a) { for(var i=0;i<a.length;i++) a[i]=Math.floor(Math.random()*256); return a; }, subtle: {} };

var performance = global.performance || { now: function(){ return Date.now(); }, timing: { navigationStart: Date.now() } };

var fetch = global.fetch || function() { return Promise.resolve({ ok: true, status: 200, json: function(){return Promise.resolve({});}, text: function(){return Promise.resolve("");} }); };

var MutationObserver = function() { this.observe = function(){}; this.disconnect = function(){}; };
var IntersectionObserver = function() { this.observe = function(){}; this.disconnect = function(){}; };
var ResizeObserver = function() { this.observe = function(){}; this.disconnect = function(){}; };

var TextEncoder = global.TextEncoder || function() { this.encode = function(s) { var a=[]; for(var i=0;i<s.length;i++) a.push(s.charCodeAt(i)&0xff); return new Uint8Array(a); }; };
var TextDecoder = global.TextDecoder || function() { this.decode = function(a) { return String.fromCharCode.apply(null, new Uint8Array(a)); }; };

// ===== PDD/电商反爬专用环境 =====
window.ontouchstart = null;
window.ontouchmove = null;
window.ontouchend = null;
window.ontouchcancel = null;
window.onmousemove = null;
window.onmousedown = null;
window.onmouseup = null;
window.onscroll = null;
window.onwheel = null;
window.onkeydown = null;
window.onkeyup = null;
window.onresize = null;
window.onfocus = null;
window.onblur = null;
window.onpageshow = null;
window.onpagehide = null;
window.onbeforeunload = null;
window.onhashchange = null;
window.onpopstate = null;
window.onerror = null;

document.ontouchstart = null;
document.ontouchmove = null;
document.ontouchend = null;
document.onvisibilitychange = null;
document.hasFocus = function() { return true; };
document.hidden = false;
document.visibilityState = "visible";
document.fullscreenElement = null;
document.fullscreenEnabled = true;

var Touch = function(t) { this.identifier = t?.identifier||0; this.target = t?.target||document.body; this.clientX = t?.clientX||0; this.clientY = t?.clientY||0; this.pageX = t?.pageX||0; this.pageY = t?.pageY||0; this.screenX = t?.screenX||0; this.screenY = t?.screenY||0; this.radiusX = 0; this.radiusY = 0; this.rotationAngle = 0; this.force = 1; };
var TouchEvent = function(type, opts) { Event.call(this, type); this.touches = opts?.touches||[]; this.targetTouches = opts?.targetTouches||[]; this.changedTouches = opts?.changedTouches||[]; this.altKey = false; this.metaKey = false; this.ctrlKey = false; this.shiftKey = false; };
var TouchList = function() { var list = []; list.item = function(i) { return list[i]||null; }; return list; };

var PointerEvent = function(type, opts) { Event.call(this, type); this.pointerId = opts?.pointerId||0; this.width = 1; this.height = 1; this.pressure = 0; this.tangentialPressure = 0; this.tiltX = 0; this.tiltY = 0; this.twist = 0; this.pointerType = "mouse"; this.isPrimary = true; };
var MouseEvent = function(type, opts) { Event.call(this, type); this.clientX = opts?.clientX||0; this.clientY = opts?.clientY||0; this.pageX = opts?.pageX||0; this.pageY = opts?.pageY||0; this.screenX = opts?.screenX||0; this.screenY = opts?.screenY||0; this.button = 0; this.buttons = 0; this.movementX = 0; this.movementY = 0; };
var KeyboardEvent = function(type, opts) { Event.call(this, type); this.key = opts?.key||""; this.code = opts?.code||""; this.keyCode = opts?.keyCode||0; this.which = opts?.which||0; this.charCode = 0; this.ctrlKey = false; this.shiftKey = false; this.altKey = false; this.metaKey = false; this.repeat = false; };
var WheelEvent = function(type, opts) { MouseEvent.call(this, type, opts); this.deltaX = opts?.deltaX||0; this.deltaY = opts?.deltaY||0; this.deltaZ = 0; this.deltaMode = 0; };

window.DeviceOrientationEvent = function() {};
window.DeviceMotionEvent = function() {};
window.getComputedStyle = function(el) { return el?.style || {}; };
window.matchMedia = function(q) { return { matches: q.includes("pointer:coarse") ? false : true, media: q, addListener: function(){}, removeListener: function(){}, addEventListener: function(){}, removeEventListener: function(){}, dispatchEvent: function(){ return true; } }; };
window.requestIdleCallback = function(cb) { return setTimeout(function(){ cb({ didTimeout: false, timeRemaining: function(){ return 50; } }); }, 1); };
window.cancelIdleCallback = function(id) { clearTimeout(id); };
window.scrollX = 0; window.scrollY = 0;
window.pageXOffset = 0; window.pageYOffset = 0;
window.innerWidth = 1920; window.innerHeight = 1080;
window.outerWidth = 1920; window.outerHeight = 1040;
window.screenX = 0; window.screenY = 0;
window.screenLeft = 0; window.screenTop = 0;
window.devicePixelRatio = 1;
window.name = "";
window.closed = false;
window.status = "";
window.origin = location.origin;

window.WebSocket = function(url) { this.url = url; this.readyState = 1; this.send = function(){}; this.close = function(){}; this.addEventListener = function(){}; };

// ===== PDD anti_content 专用环境补充 =====
// document.all 是 PDD 检测的重点
document.all = { length: 0 };
Object.defineProperty(document, "all", {
  get: function() {
    return { length: 0, item: function() { return null; }, namedItem: function() { return null; } };
  }
});

// 拼多多特有检测: document.ontouchstart / 移动端模拟
document.createRange = function() {
  return {
    setStart: function(){}, setEnd: function(){}, commonAncestorContainer: document.body,
    cloneRange: function(){ return this; }, collapse: function(){},
    getBoundingClientRect: function(){ return {top:0,left:0,bottom:0,right:0,width:0,height:0}; },
    getClientRects: function(){ return []; }, selectNode: function(){}, selectNodeContents: function(){},
    toString: function(){ return ""; }
  };
};
document.createDocumentFragment = function() {
  return { appendChild: function(c){return c;}, querySelectorAll: function(){return [];}, children: [], childNodes: [] };
};
document.createComment = function() { return { nodeType: 8 }; };
document.implementation = {
  createHTMLDocument: function(title) {
    return { title: title || "", body: document.body, head: document.head,
      createElement: document.createElement, createTextNode: document.createTextNode };
  }
};
document.currentScript = null;

// Node.js 兼容 Buffer / process
if (typeof process === "undefined") var process = { env: {}, version: "v18.0.0", platform: "linux", nextTick: function(fn) { setTimeout(fn, 0); } };

// Worker / Blob 模拟 (PDD 部分版本用到)
var Blob = function(parts, opts) { this.size = parts ? parts.reduce(function(s,p){return s+(p.length||0);},0) : 0; this.type = opts?.type||""; };
var Worker = function(url) { this.postMessage = function(){}; this.terminate = function(){}; this.addEventListener = function(){}; this.onmessage = null; };
var URL = global.URL || {
  createObjectURL: function() { return "blob:null"; },
  revokeObjectURL: function() {},
};

// MessageChannel / BroadcastChannel
var MessageChannel = function() { this.port1 = { postMessage: function(){}, addEventListener: function(){}, onmessage: null }; this.port2 = { postMessage: function(){}, addEventListener: function(){}, onmessage: null }; };
var BroadcastChannel = function(name) { this.name = name; this.postMessage = function(){}; this.close = function(){}; this.addEventListener = function(){}; this.onmessage = null; };

// Proxy hook 用于发现补环境缺失项
var __env_access_log__ = [];
var __env_proxy_handler__ = {
  get: function(target, prop, receiver) {
    if (typeof prop === "string" && !prop.startsWith("__") && !(prop in target)) {
      __env_access_log__.push("[GET] " + (target === window ? "window" : "obj") + "." + prop);
      if (__env_access_log__.length <= 100) console.log("[ENV MISS]", prop);
    }
    return Reflect.get(target, prop, receiver);
  },
  set: function(target, prop, value) {
    return Reflect.set(target, prop, value);
  }
};

// 可选: 包装 window 为 Proxy 以记录缺失属性访问
// var window = new Proxy(window, __env_proxy_handler__);

Object.defineProperty(window, "location", { value: location, writable: true, configurable: true });
Object.defineProperty(window, "navigator", { value: navigator, writable: true, configurable: true });
Object.defineProperty(window, "document", { value: document, writable: true, configurable: true });
Object.defineProperty(window, "screen", { value: screen, writable: true, configurable: true });
Object.defineProperty(window, "history", { value: history, writable: true, configurable: true });
Object.defineProperty(window, "localStorage", { value: localStorage, writable: true, configurable: true });
Object.defineProperty(window, "sessionStorage", { value: sessionStorage, writable: true, configurable: true });
`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generatePddEnvCode(page: any): Promise<string> {
  let currentUrl = "https://mobile.yangkeduo.com/";
  let currentUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  let cookies = "";
  try {
    currentUrl = await page.url();
    currentUA = await page.evaluate(() => navigator.userAgent);
    cookies = await page.evaluate(() => document.cookie);
  } catch { /* use defaults */ }

  const urlObj = (() => {
    try { return new URL(currentUrl); } catch { return new URL("https://mobile.yangkeduo.com/"); }
  })();

  let code = `// ===== PDD anti_content 专用补环境 =====\n`;
  code += `// 关键: location/UA 必须与抓取时一致，否则 anti_content 验证失败\n\n`;
  code += generateEnvCode();

  code += `\n// ===== PDD 专用覆盖 =====\n`;
  code += `location.href = ${JSON.stringify(currentUrl)};\n`;
  code += `location.protocol = ${JSON.stringify(urlObj.protocol)};\n`;
  code += `location.host = ${JSON.stringify(urlObj.host)};\n`;
  code += `location.hostname = ${JSON.stringify(urlObj.hostname)};\n`;
  code += `location.pathname = ${JSON.stringify(urlObj.pathname)};\n`;
  code += `location.search = ${JSON.stringify(urlObj.search)};\n`;
  code += `location.hash = ${JSON.stringify(urlObj.hash)};\n`;
  code += `location.origin = ${JSON.stringify(urlObj.origin)};\n`;
  code += `location.port = ${JSON.stringify(urlObj.port)};\n\n`;
  code += `navigator.userAgent = ${JSON.stringify(currentUA)};\n`;
  code += `document.cookie = ${JSON.stringify(cookies)};\n`;
  code += `document.referrer = ${JSON.stringify(urlObj.origin + "/")};\n`;
  code += `document.domain = ${JSON.stringify(urlObj.hostname)};\n`;
  code += `document.URL = ${JSON.stringify(currentUrl)};\n`;
  code += `document.documentURI = ${JSON.stringify(currentUrl)};\n`;
  code += `window.origin = ${JSON.stringify(urlObj.origin)};\n\n`;
  code += `// PDD serverTime 需要传入（每次请求不同）\n`;
  code += `// 用法: new (require("./pdd_anti_content_xxx.js"))({serverTime: Date.now()}).messagePack()\n`;

  return code;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generatePddStandaloneJs(wp: WpAnalysis, modules: WpModule[], entryId: string | number, page: any): Promise<string> {
  const pddEnv = await generatePddEnvCode(page);
  let out = pddEnv;

  out += "\n\n// ===== Webpack Loader =====\n";
  out += "var __webpack_modules__ = {\n";
  for (const mod of modules) {
    const cleanCode = mod.code.replace(/^[\s,]*(?:["']?\w+["']?)\s*:\s*/, "");
    out += `  ${JSON.stringify(String(mod.id))}: ${cleanCode},\n`;
  }
  out += "};\n\n";
  out += `var __webpack_module_cache__ = {};\n`;
  out += `function __webpack_require__(moduleId) {\n`;
  out += `  var cachedModule = __webpack_module_cache__[moduleId];\n`;
  out += `  if (cachedModule !== undefined) return cachedModule.exports;\n`;
  out += `  var module = __webpack_module_cache__[moduleId] = { id: moduleId, loaded: false, exports: {} };\n`;
  out += `  try { __webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__); }\n`;
  out += `  catch(e) { console.log("[!] 模块 " + moduleId + " 加载失败:", e.message); }\n`;
  out += `  module.loaded = true;\n`;
  out += `  return module.exports;\n`;
  out += `}\n\n`;
  out += `// ===== __webpack_require__ 辅助方法 =====\n`;
  out += `__webpack_require__.n = function(module) {\n`;
  out += `  var getter = module && module.__esModule ? function() { return module["default"]; } : function() { return module; };\n`;
  out += `  __webpack_require__.d(getter, { a: getter });\n`;
  out += `  return getter;\n`;
  out += `};\n`;
  out += `__webpack_require__.d = function(exports, definition) {\n`;
  out += `  for (var key in definition) {\n`;
  out += `    if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {\n`;
  out += `      Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });\n`;
  out += `    }\n`;
  out += `  }\n`;
  out += `};\n`;
  out += `__webpack_require__.o = function(obj, prop) { return Object.prototype.hasOwnProperty.call(obj, prop); };\n`;
  out += `__webpack_require__.r = function(exports) {\n`;
  out += `  if (typeof Symbol !== "undefined" && Symbol.toStringTag) Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n`;
  out += `  Object.defineProperty(exports, "__esModule", { value: true });\n`;
  out += `};\n`;
  out += `__webpack_require__.e = function() { return Promise.resolve(); };\n`;
  out += `__webpack_require__.t = function(value, mode) { if (mode & 1) value = __webpack_require__(value); return value; };\n\n`;

  out += `// ===== PDD anti_content 入口 =====\n`;
  out += `try {\n`;
  out += `  var _mod = __webpack_require__(${JSON.stringify(String(entryId))});\n`;
  out += `  console.log("[+] 模块 ${entryId} 加载成功, type:", typeof _mod);\n`;
  out += `  if (typeof _mod === "object" && _mod !== null) {\n`;
  out += `    var _keys = Object.keys(_mod);\n`;
  out += `    console.log("[+] 导出 keys:", _keys.slice(0, 30));\n`;
  out += `    // 自动搜索 messagePack / anti_content 相关函数\n`;
  out += `    for (var _k of _keys) {\n`;
  out += `      if (typeof _mod[_k] === "function") {\n`;
  out += `        var _fname = _k.toLowerCase();\n`;
  out += `        console.log("[+] fn:", _k, "->", String(_mod[_k]).slice(0, 80));\n`;
  out += `        if (_fname.includes("messagepack") || _fname.includes("anti") || _fname.includes("crawl") || _fname.includes("risk")) {\n`;
  out += `          try {\n`;
  out += `            var _r = _mod[_k]({serverTime: Date.now()});\n`;
  out += `            console.log("[★] 调用 " + _k + " 成功:", typeof _r === "string" ? _r.slice(0, 300) : JSON.stringify(_r)?.slice(0, 300));\n`;
  out += `          } catch(_e) { console.log("[!] 调用 " + _k + " 失败:", _e.message); }\n`;
  out += `        }\n`;
  out += `      }\n`;
  out += `    }\n`;
  out += `    // 尝试作为构造函数: new Cls({serverTime}).messagePack()\n`;
  out += `    var _Cls = typeof _mod === "function" ? _mod : (_mod.default || _mod[_keys[0]]);\n`;
  out += `    if (typeof _Cls === "function") {\n`;
  out += `      try {\n`;
  out += `        var _inst = new _Cls({serverTime: Date.now()});\n`;
  out += `        var _proto = Object.getOwnPropertyNames(Object.getPrototypeOf(_inst)).filter(function(n){return n!=="constructor"});\n`;
  out += `        console.log("[+] 实例化成功, 原型方法:", _proto);\n`;
  out += `        if (typeof _inst.messagePack === "function") {\n`;
  out += `          var _result = _inst.messagePack();\n`;
  out += `          console.log("[★★★] messagePack() =", typeof _result === "string" ? _result.slice(0, 500) : _result);\n`;
  out += `        }\n`;
  out += `        if (typeof _inst.messagePackSync === "function") {\n`;
  out += `          var _result2 = _inst.messagePackSync();\n`;
  out += `          console.log("[★★★] messagePackSync() =", typeof _result2 === "string" ? _result2.slice(0, 500) : _result2);\n`;
  out += `        }\n`;
  out += `      } catch(_e2) { console.log("[!] new Cls() 失败:", _e2.message, "-> 尝试直接调用"); }\n`;
  out += `    }\n`;
  out += `  }\n`;
  out += `} catch(_e3) {\n`;
  out += `  console.log("[!] 入口模块加载失败:", _e3.message);\n`;
  out += `  console.log("[!] stack:", _e3.stack?.split("\\n").slice(0,5).join("\\n"));\n`;
  out += `  console.log("[*] 请根据报错补充缺失的环境变量或模块");\n`;
  out += `}\n\n`;
  out += `// ===== 导出接口 =====\n`;
  out += `if (typeof module !== "undefined") {\n`;
  out += `  module.exports = { __webpack_require__, entryModule: typeof _mod !== "undefined" ? _mod : null };\n`;
  out += `}\n`;

  return out;
}

export const jsReverseSkill: SkillDefinition = {
  name: "js_reverse",
  displayName: "脚本逆向分析",
  description:
    "JavaScript逆向分析工具。核心能力：Webpack打包解析(模块提取/依赖图谱/入口识别)、补环境代码生成(window/document/navigator等浏览器环境模拟)、模块提取并生成可独立运行的JS脚本。支持PDD拼多多anti_content专项逆向(自动定位messagePack/riskControlCrawler/n(291)→提取Webpack模块→生成PDD专用补环境+可运行脚本)。还支持：JS美化、搜索关键词、全局变量分析、加密库检测、Hook函数、dump源码、一键全量扫描。用户说'JS逆向'、'Webpack分析'、'补环境'、'提取模块'、'加密分析'、'反混淆'、'anti_content'时使用。",
  icon: "Code",
  category: "dev",
  parameters: z.object({
    action: z.enum([
      "list_scripts", "search_code", "analyze_globals", "extract_apis",
      "hook_function", "get_hook_logs", "eval_context", "dump_script",
      "beautify", "full_scan", "cdp_scripts",
      "webpack_analyze", "webpack_extract", "gen_env",
      "auto_reverse", "pdd_analyze",
      "slider_detect", "slider_track", "slider_crack",
    ]).describe(
      "操作: list_scripts=列出JS(DOM), cdp_scripts=CDP运行时脚本, " +
      "search_code=搜索关键词, analyze_globals=全局变量+加密库, " +
      "extract_apis=提取API端点, hook_function=Hook函数, get_hook_logs=Hook日志, " +
      "eval_context=执行分析代码(支持async), dump_script=下载脚本源码, " +
      "beautify=JS美化/反混淆, full_scan=一键全量分析, " +
      "webpack_analyze=分析Webpack打包结构(模块列表/依赖图/入口), " +
      "webpack_extract=提取指定模块及依赖并生成可运行JS(含补环境), " +
      "gen_env=生成浏览器补环境代码(window/document/navigator/canvas等+PDD反爬专用), " +
      "auto_reverse=自动化深度逆向(全流程:扫描→定位加密→Hook→dump→webpack分析→提取→生成可运行脚本), " +
      "pdd_analyze=拼多多anti_content专项分析(自动定位messagePack/getAntiContent/webpack n(291)→提取加密模块→生成补环境+可运行脚本), " +
      "slider_detect=滑块验证码缺口识别(Canvas像素对比/截图分析/自动定位缺口X坐标), " +
      "slider_track=生成人类化滑动轨迹(贝塞尔曲线+加速减速+随机抖动+回弹), " +
      "slider_crack=一键滑块破解(自动检测缺口→生成轨迹→模拟滑动→验证结果)"
    ),
    sessionId: z.string().optional().describe("浏览器会话ID，默认'main'"),
    keyword: z.string().optional().describe("search_code: 搜索关键词(如'encrypt','sign','token','password','md5','aes','hmac')"),
    functionName: z.string().optional().describe("hook_function/get_hook_logs: 函数名(如'JSON.parse','fetch','XMLHttpRequest.prototype.open','CryptoJS.AES.encrypt')"),
    scriptIndex: z.number().optional().describe("dump_script/beautify: 脚本序号(可选，不提供则dump所有外部JS或列出脚本列表)"),
    code: z.string().optional().describe("eval_context: 要在页面执行的分析代码 / beautify: 直接传入代码字符串"),
    filePath: z.string().optional().describe("从文件读取JS代码进行分析(支持大文件最大20MB)，用于beautify/search_code/full_scan/webpack_analyze/webpack_extract"),
    savePath: z.string().optional().describe("dump_script/beautify/webpack_extract/gen_env/slider_detect: 保存路径(slider_detect时保存截图)"),
    moduleId: z.string().optional().describe("webpack_extract: 要提取的模块ID"),
    targetKeyword: z.string().optional().describe("auto_reverse: 要逆向的目标关键词(如'anti_content','sign','encrypt','token','password')"),
    sliderSelector: z.string().optional().describe("slider_crack/slider_detect: 滑块按钮CSS选择器(如'.geetest_slider_button','.tc-fg-item')"),
    bgSelector: z.string().optional().describe("slider_detect: 背景图Canvas/img选择器(如'.geetest_canvas_bg','canvas.bg')"),
    gapSelector: z.string().optional().describe("slider_detect: 缺口图Canvas/img选择器(如'.geetest_canvas_slice','canvas.gap')"),
    sliderDistance: z.number().optional().describe("slider_track: 手动指定滑动距离(像素)，不指定则自动检测"),
    maxResults: z.number().optional().describe("搜索结果最大数量，默认30"),
  }),
  execute: async (params) => {
    const {
      action, sessionId = "main",
      keyword, functionName,
      scriptIndex, code: rawCode,
      filePath, savePath, moduleId, targetKeyword,
      sliderSelector, bgSelector, gapSelector, sliderDistance,
      maxResults = 30,
    } = params as {
      action: string; sessionId?: string;
      keyword?: string; functionName?: string;
      scriptIndex?: number; code?: string;
      filePath?: string; savePath?: string; moduleId?: string;
      targetKeyword?: string;
      sliderSelector?: string; bgSelector?: string; gapSelector?: string;
      sliderDistance?: number;
      maxResults?: number;
    };

    let code = rawCode;

    try {
      if (filePath) {
        const resolved = path.resolve(filePath);
        try {
          const fstat = await fs.stat(resolved);
          if (fstat.size > 20 * 1024 * 1024) {
            return { success: false, message: `文件过大 (${(fstat.size / 1024 / 1024).toFixed(1)}MB > 20MB)` };
          }
          code = await fs.readFile(resolved, "utf-8");
        } catch (err) {
          return { success: false, message: `读取文件失败: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      if (action === "beautify" && code && code.trim().length > 0) {
        const beautified = jsBeautify(code);
        const analysis = analyzeObfuscation(code);

        if (savePath) {
          const outPath = path.resolve(savePath);
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          await fs.writeFile(outPath, beautified, "utf-8");
          return {
            success: true,
            message: `美化后代码已保存: ${outPath}\n原始: ${(code.length / 1024).toFixed(1)}KB → 美化: ${(beautified.length / 1024).toFixed(1)}KB\n混淆评分: ${analysis.score}/100\n${analysis.indicators.length ? "特征: " + analysis.indicators.join("、") : ""}`,
            data: { path: outPath, originalSize: code.length, beautifiedSize: beautified.length, analysis },
          };
        }

        const preview = beautified.length > 6000 ? beautified.slice(0, 6000) + "\n... (使用savePath保存完整文件)" : beautified;
        let msg = `美化后代码 (${(beautified.length / 1024).toFixed(1)}KB)\n混淆评分: ${analysis.score}/100\n`;
        if (analysis.indicators.length) msg += `特征: ${analysis.indicators.join("、")}\n`;
        if (analysis.encryptionPatterns.length) msg += `加密算法: ${analysis.encryptionPatterns.join(", ")}\n`;
        if (analysis.suspiciousFunctions.length) msg += `可疑函数: ${analysis.suspiciousFunctions.join(", ")}\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━\n${preview}`;
        return { success: true, message: msg, data: { originalSize: code.length, beautifiedSize: beautified.length, analysis } };
      }

      const page = await getOrRecoverPage(sessionId);
      if (!page) {
        const status = getSessionStatus(sessionId);
        let hint = `浏览器会话"${sessionId}"不存在且无法自动恢复`;
        if (status.allSessions.length > 0) hint += `，当前活跃会话: [${status.allSessions.join(", ")}]`;
        hint += "。请先使用 browser_open 打开页面";
        return { success: false, message: hint };
      }

      switch (action) {
        case "list_scripts": {
          const scripts = await page.evaluate(() => {
            const result: Array<{ index: number; src: string; type: string; size: number; inline: boolean }> = [];
            document.querySelectorAll("script").forEach((s, i) => {
              result.push({
                index: i, src: s.src || "(inline)",
                type: s.type || "text/javascript",
                size: s.src ? 0 : s.textContent?.length || 0,
                inline: !s.src,
              });
            });
            return result;
          });

          let msg = `页面JS脚本 - DOM层 (${scripts.length}个)\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const s of scripts) {
            msg += `#${s.index} ${s.inline ? "[内联]" : "[外部]"} ${s.src}`;
            if (s.size > 0) msg += ` (${(s.size / 1024).toFixed(1)}KB)`;
            msg += "\n";
          }
          msg += `\n提示:\n- dump_script+scriptIndex 下载源码\n- cdp_scripts 查看运行时动态加载的脚本\n- search_code+keyword 搜索加密代码\n- full_scan 一键全量分析`;

          return { success: true, message: msg, data: { scripts } };
        }

        case "cdp_scripts": {
          let client;
          try {
            client = await page.createCDPSession();
          } catch (e) {
            return { success: false, message: `创建CDP会话失败: ${e instanceof Error ? e.message : String(e)}` };
          }

          const runtimeScripts: Array<{ id: string; url: string; length: number; hash: string }> = [];

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await client.send("Runtime.evaluate", {
              expression: "performance.getEntriesByType('resource').filter(r => r.initiatorType === 'script').map(r => ({ url: r.name, size: r.transferSize, duration: r.duration }))",
              returnByValue: true,
            }) as unknown as { result: { value: Array<{ url: string; size: number; duration: number }> } };

            const resourceScripts = result.result?.value || [];

            let msg = `运行时加载的JS脚本 (${resourceScripts.length}个)\n━━━━━━━━━━━━━━━━━━━━\n`;
            resourceScripts.forEach((s, i) => {
              runtimeScripts.push({ id: String(i), url: s.url, length: s.size, hash: "" });
              const sizeStr = s.size > 0 ? `${(s.size / 1024).toFixed(1)}KB` : "?";
              msg += `#${i} ${sizeStr} ${Math.round(s.duration)}ms ${s.url.slice(0, 140)}\n`;
            });

            msg += `\n这些是浏览器运行时实际加载的JS文件（包含动态注入的）\n`;
            msg += `用 search_code 搜索关键代码 | dump_script 下载源码`;

            return { success: true, message: msg, data: { scripts: runtimeScripts, resourceScripts } };
          } finally {
            try { await client.detach(); } catch { /* ok */ }
          }
        }

        case "search_code": {
          if (!keyword) return { success: false, message: "需要提供 keyword 参数" };

          if (code && code.trim().length > 0) {
            const lines = code.split("\n");
            const re = new RegExp(keyword, "gi");
            const found: Array<{ line: number; context: string }> = [];
            for (let i = 0; i < lines.length && found.length < maxResults; i++) {
              re.lastIndex = 0;
              if (re.test(lines[i])) {
                const ctxStart = Math.max(0, i - 3);
                const ctxEnd = Math.min(lines.length, i + 4);
                let ctx = "";
                for (let j = ctxStart; j < ctxEnd; j++) {
                  ctx += `${j === i ? ">>>" : "   "}${String(j + 1).padStart(6)} | ${lines[j]}\n`;
                }
                found.push({ line: i + 1, context: ctx });
              }
            }
            const src = filePath ? path.basename(filePath) : "传入代码";
            if (found.length === 0) return { success: true, message: `在 ${src} 中未找到"${keyword}"` };
            let msg = `搜索"${keyword}" in ${src} (${(code.length / 1024).toFixed(1)}KB) — ${found.length}处\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            for (const r of found) { msg += `--- 行 ${r.line} ---\n${r.context}\n`; }
            return { success: true, message: msg, data: { keyword, matchCount: found.length, results: found.map((f) => ({ line: f.line })) } };
          }

          const results = await page.evaluate((kw: string, max: number) => {
            const found: Array<{ source: string; line: number; context: string; scriptIndex: number }> = [];
            const scripts = document.querySelectorAll("script");
            const re = new RegExp(kw, "gi");

            scripts.forEach((script, idx) => {
              const code = script.src ? "" : (script.textContent || "");
              if (!code) return;
              const lines = code.split("\n");
              lines.forEach((line, lineNum) => {
                if (re.test(line) && found.length < max) {
                  found.push({
                    source: script.src || `inline#${idx}`,
                    line: lineNum + 1,
                    context: line.trim().slice(0, 300),
                    scriptIndex: idx,
                  });
                }
                re.lastIndex = 0;
              });
            });
            return found;
          }, keyword, maxResults);

          const extResults = await page.evaluate(async (kw: string, max: number) => {
            const found: Array<{ source: string; line: number; context: string }> = [];
            const scripts = document.querySelectorAll("script[src]");
            const re = new RegExp(kw, "gi");
            for (const s of Array.from(scripts)) {
              if (found.length >= max) break;
              try {
                const resp = await fetch((s as HTMLScriptElement).src);
                const code = await resp.text();
                const lines = code.split("\n");
                lines.forEach((line, lineNum) => {
                  if (re.test(line) && found.length < max) {
                    found.push({ source: (s as HTMLScriptElement).src, line: lineNum + 1, context: line.trim().slice(0, 300) });
                  }
                  re.lastIndex = 0;
                });
              } catch { /* cors */ }
            }
            return found;
          }, keyword, maxResults - results.length);

          const all = [...results, ...extResults];
          if (all.length === 0) return { success: true, message: `未找到包含"${keyword}"的代码。\n提示: 外部CDN脚本可能因CORS被跳过，尝试 dump_script 下载后本地搜索。` };

          let msg = `搜索"${keyword}" — 找到${all.length}处\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const r of all) {
            const src = r.source.length > 60 ? "..." + r.source.slice(-57) : r.source;
            msg += `📍 [${src}:${r.line}]\n  ${r.context}\n\n`;
          }

          return { success: true, message: msg, data: { keyword, results: all } };
        }

        case "analyze_globals": {
          const globals = await page.evaluate(() => {
            const builtins = new Set([
              "undefined","NaN","Infinity","eval","parseInt","parseFloat","isNaN","isFinite",
              "decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape",
              "Object","Function","Boolean","Symbol","Error","Number","BigInt","Math","Date","String",
              "RegExp","Array","Int8Array","Uint8Array","Map","Set","WeakMap","WeakSet","ArrayBuffer",
              "SharedArrayBuffer","DataView","JSON","Promise","Proxy","Reflect","Intl","WebAssembly",
              "globalThis","window","self","document","location","navigator","history","screen",
              "performance","console","alert","confirm","prompt","fetch","XMLHttpRequest",
              "setTimeout","setInterval","clearTimeout","clearInterval","requestAnimationFrame",
              "cancelAnimationFrame","queueMicrotask","atob","btoa","URL","URLSearchParams",
              "Headers","Request","Response","FormData","Blob","File","FileReader",
              "AbortController","AbortSignal","TextEncoder","TextDecoder","crypto",
              "localStorage","sessionStorage","indexedDB","caches","postMessage",
              "addEventListener","removeEventListener","dispatchEvent","getComputedStyle",
              "matchMedia","open","close","stop","focus","blur","print","scroll","scrollTo",
              "scrollBy","getSelection","find","moveBy","moveTo","resizeBy","resizeTo",
              "chrome","onerror","onload","onmessage","onunhandledrejection",
            ]);

            const result: Array<{ name: string; type: string; value?: string }> = [];
            const w = window as unknown as Record<string, unknown>;

            for (const key of Object.getOwnPropertyNames(window)) {
              if (builtins.has(key)) continue;
              if (key.startsWith("__") || key.startsWith("webkit") || key.startsWith("on")) continue;
              try {
                const val = w[key];
                const type = typeof val;
                if (type === "function") {
                  result.push({ name: key, type: "function", value: String(val).slice(0, 200) });
                } else if (type === "object" && val !== null) {
                  const keys = Object.keys(val as object).slice(0, 10);
                  result.push({ name: key, type: "object", value: `{${keys.join(", ")}}` });
                } else if (type === "string" || type === "number" || type === "boolean") {
                  result.push({ name: key, type, value: String(val).slice(0, 200) });
                }
              } catch { /* inaccessible */ }
            }

            const cryptoHints: string[] = [];
            if (w.CryptoJS) cryptoHints.push("CryptoJS (crypto-js库)");
            if (w.JSEncrypt) cryptoHints.push("JSEncrypt (RSA加密)");
            if (w.md5 || w.MD5) cryptoHints.push("MD5");
            if (w.forge) cryptoHints.push("node-forge");
            if (w.sjcl) cryptoHints.push("SJCL");
            if (w.Base64) cryptoHints.push("Base64");
            if (w.hex_md5) cryptoHints.push("hex_md5");
            if (w.SHA256 || w.sha256) cryptoHints.push("SHA256");
            if (w.sm2 || w.sm3 || w.sm4) cryptoHints.push("国密算法(SM2/3/4)");
            if (w.jsrsasign) cryptoHints.push("jsrsasign");
            if (w.nacl) cryptoHints.push("TweetNaCl");
            if (w.aesjs) cryptoHints.push("aes-js");

            return { globals: result.slice(0, 100), cryptoLibs: cryptoHints };
          });

          let msg = `全局变量/函数分析\n━━━━━━━━━━━━━━━━━━━━\n`;

          if (globals.cryptoLibs.length > 0) {
            msg += `\n⚠ 检测到加密库:\n`;
            globals.cryptoLibs.forEach((lib) => { msg += `  🔐 ${lib}\n`; });
            msg += `\n建议: 用 hook_function Hook这些库的加密方法来捕获参数\n`;
          } else {
            msg += `\n未检测到常见加密库。可能使用Web Crypto API或自定义加密。\n`;
          }

          const funcs = globals.globals.filter((g) => g.type === "function");
          const objs = globals.globals.filter((g) => g.type === "object");
          const vars = globals.globals.filter((g) => g.type !== "function" && g.type !== "object");

          msg += `\n非内置全局变量 (${globals.globals.length}个)\n`;
          if (funcs.length > 0) {
            msg += `\n函数 (${funcs.length}):\n`;
            funcs.forEach((f) => { msg += `  ${f.name}(): ${f.value?.slice(0, 80)}\n`; });
          }
          if (objs.length > 0) {
            msg += `\n对象 (${objs.length}):\n`;
            objs.forEach((o) => { msg += `  ${o.name}: ${o.value}\n`; });
          }
          if (vars.length > 0) {
            msg += `\n变量 (${vars.length}):\n`;
            vars.forEach((v) => { msg += `  ${v.name} [${v.type}] = ${v.value}\n`; });
          }

          return { success: true, message: msg, data: globals };
        }

        case "extract_apis": {
          const apis = await page.evaluate(() => {
            const found: Array<{ url: string; method: string; source: string }> = [];
            const urlPattern = /['"`]((?:https?:)?\/\/[^\s'"`]+|\/api\/[^\s'"`]+|\/v\d+\/[^\s'"`]+)/g;
            const ajaxPattern = /\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)/gi;
            const fetchPattern = /fetch\s*\(\s*['"`]([^'"`]+)/gi;
            const xhrPattern = /\.open\s*\(\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]\s*,\s*['"`]([^'"`]+)/gi;

            document.querySelectorAll("script").forEach((s) => {
              const code = s.textContent || "";
              let m;
              while ((m = urlPattern.exec(code)) !== null) {
                if (m[1].includes("/api/") || m[1].includes("/v1/") || m[1].includes("/v2/") ||
                    m[1].includes(".json") || m[1].includes("?") || m[1].includes("/rest/") || m[1].includes("/graphql")) {
                  found.push({ url: m[1], method: "?", source: s.src || "inline" });
                }
              }
              while ((m = ajaxPattern.exec(code)) !== null) found.push({ url: m[2], method: m[1].toUpperCase(), source: s.src || "inline" });
              while ((m = fetchPattern.exec(code)) !== null) found.push({ url: m[1], method: "FETCH", source: s.src || "inline" });
              while ((m = xhrPattern.exec(code)) !== null) found.push({ url: m[2], method: m[1].toUpperCase(), source: s.src || "inline" });
            });

            const uniqueUrls = new Map<string, typeof found[0]>();
            found.forEach((f) => { if (!uniqueUrls.has(f.url)) uniqueUrls.set(f.url, f); });
            return Array.from(uniqueUrls.values());
          });

          if (apis.length === 0) return { success: true, message: "未在内联JS中找到API端点。\n建议: 使用 network_capture 抓包来发现运行时API调用。" };

          let msg = `发现API端点 (${apis.length}个)\n━━━━━━━━━━━━━━━━━━━━\n`;
          apis.forEach((a, i) => { msg += `${i + 1}. [${a.method}] ${a.url}\n   来源: ${a.source}\n`; });
          msg += `\n建议: 用 network_capture 抓包验证这些接口是否实际被调用，并捕获完整的请求参数。`;

          return { success: true, message: msg, data: { apis } };
        }

        case "hook_function": {
          if (!functionName) return { success: false, message: "需要提供 functionName 参数\n常用目标:\n- JSON.parse / JSON.stringify\n- fetch / XMLHttpRequest.prototype.open\n- btoa / atob\n- CryptoJS.AES.encrypt / CryptoJS.MD5\n- window.sign / window.encrypt" };

          const hookResult = await page.evaluate((fnName: string) => {
            const logKey = `__xiniu_hook_${fnName.replace(/\./g, "_")}`;
            (window as unknown as Record<string, unknown>)[logKey] = [];

            try {
              const parts = fnName.split(".");
              let parent: unknown = window;
              for (let i = 0; i < parts.length - 1; i++) {
                parent = (parent as Record<string, unknown>)[parts[i]];
                if (!parent) return { ok: false, error: `找不到 ${parts.slice(0, i + 1).join(".")}` };
              }
              const lastKey = parts[parts.length - 1];
              const original = (parent as Record<string, unknown>)[lastKey];
              if (typeof original !== "function") return { ok: false, error: `${fnName} 不是函数(类型: ${typeof original})` };

              (parent as Record<string, unknown>)[lastKey] = function (this: unknown, ...args: unknown[]) {
                const logs = (window as unknown as Record<string, unknown[]>)[logKey];
                const result = (original as Function).apply(this, args);
                logs.push({
                  time: new Date().toISOString(),
                  args: args.map((a) => {
                    try { return typeof a === "string" ? a.slice(0, 500) : JSON.stringify(a)?.slice(0, 500); }
                    catch { return String(a).slice(0, 500); }
                  }),
                  result: (() => {
                    try { return typeof result === "string" ? result.slice(0, 500) : JSON.stringify(result)?.slice(0, 500); }
                    catch { return String(result).slice(0, 200); }
                  })(),
                  stack: new Error().stack?.split("\n").slice(2, 7).map((l) => l.trim()),
                });
                if (logs.length > 200) logs.shift();
                return result;
              };

              return { ok: true, logKey };
            } catch (e) {
              return { ok: false, error: String(e) };
            }
          }, functionName);

          if (!hookResult.ok) return { success: false, message: `Hook失败: ${hookResult.error}` };

          return {
            success: true,
            message: `Hook已注入: ${functionName}\n\n每次调用将记录:\n- 输入参数\n- 返回值\n- 调用栈\n\n在页面上操作触发该函数后，用 get_hook_logs + functionName="${functionName}" 查看记录。`,
            data: { functionName, logKey: hookResult.logKey },
          };
        }

        case "get_hook_logs": {
          if (!functionName) return { success: false, message: "需要提供 functionName 参数" };
          const logKey = `__xiniu_hook_${functionName.replace(/\./g, "_")}`;
          const logs = await page.evaluate((key: string) => {
            return ((window as unknown as Record<string, unknown>)[key] as unknown[]) || [];
          }, logKey);

          if (!Array.isArray(logs) || logs.length === 0) {
            return { success: true, message: `${functionName} 尚无调用记录。在页面上操作触发后再查看。` };
          }

          let msg = `${functionName} 调用记录 (${logs.length}次)\n━━━━━━━━━━━━━━━━━━━━\n`;
          const entries = logs as Array<{ time: string; args: string[]; result?: string; stack: string[] }>;
          entries.slice(-15).forEach((entry, i) => {
            msg += `#${i + 1} [${entry.time}]\n`;
            msg += `  入参: ${entry.args.join(", ")}\n`;
            if (entry.result) msg += `  返回: ${entry.result}\n`;
            if (entry.stack?.length) msg += `  栈: ${entry.stack.slice(0, 3).join("\n       ")}\n`;
            msg += "\n";
          });
          if (entries.length > 15) msg += `... 更早的 ${entries.length - 15} 条已省略\n`;

          return { success: true, message: msg, data: { functionName, callCount: logs.length, logs: entries.slice(-50) } };
        }

        case "eval_context": {
          if (!code) return { success: false, message: "需要提供 code 参数" };
          const wrappedEval = `(async () => {
            try {
              const __result = await (async function() { ${code} })();
              if (__result === undefined || __result === null) {
                const __lastExpr = eval(${JSON.stringify(code)});
                const __final = await Promise.resolve(__lastExpr);
                return { ok: true, result: typeof __final === "object" ? JSON.stringify(__final, null, 2)?.slice(0, 8000) : String(__final).slice(0, 8000) };
              }
              return { ok: true, result: typeof __result === "object" ? JSON.stringify(__result, null, 2)?.slice(0, 8000) : String(__result).slice(0, 8000) };
            } catch(e) { return { ok: false, error: String(e).slice(0, 3000) }; }
          })()`;
          const result = await page.evaluate(wrappedEval) as { ok: boolean; result?: string; error?: string };

          if (!result || !result.ok) return { success: false, message: `执行失败: ${result?.error || "无返回值"}` };
          return { success: true, message: `执行结果:\n${result.result}`, data: { result: result.result } };
        }

        case "dump_script": {
          // 未指定scriptIndex时: dump所有外部JS（可用keyword过滤）
          if (scriptIndex === undefined) {
            const scriptList = await page.evaluate(() => {
              return Array.from(document.querySelectorAll("script")).map((s, i) => ({
                idx: i, src: s.src || "", inline: !s.src, size: (s.textContent || "").length,
              }));
            });

            const extScripts = scriptList.filter((s) => s.src && s.src.endsWith(".js"));
            if (extScripts.length === 0 && scriptList.length === 0) {
              return { success: false, message: "页面上没有找到任何脚本" };
            }

            // 如果有savePath，批量dump所有外部JS
            if (savePath) {
              const outDir = path.resolve(savePath.endsWith(".js") ? path.dirname(savePath) : savePath);
              await fs.mkdir(outDir, { recursive: true });

              const targetScripts = keyword
                ? extScripts.filter((s) => s.src.toLowerCase().includes(keyword.toLowerCase()))
                : extScripts;

              if (targetScripts.length === 0) {
                let msg = `未找到匹配的脚本。`;
                if (keyword) msg += ` 关键词"${keyword}"无匹配。`;
                msg += `\n\n页面所有脚本 (${scriptList.length}个):\n`;
                for (const s of scriptList.slice(0, 30)) {
                  msg += `  #${s.idx} ${s.src || "(inline)"} ${s.inline ? `${s.size}字符` : ""}\n`;
                }
                return { success: false, message: msg };
              }

              const saved: Array<{ idx: number; src: string; path: string; size: number }> = [];
              let totalSize = 0;
              for (const script of targetScripts) {
                try {
                  const content = await page.evaluate(async (url: string) => {
                    try { const r = await fetch(url); return await r.text(); } catch { return ""; }
                  }, script.src);
                  if (!content) continue;

                  const fname = path.basename(new URL(script.src).pathname).replace(/[?#].*/, "") || `script_${script.idx}.js`;
                  const outPath = path.join(outDir, fname);
                  await fs.writeFile(outPath, content, "utf-8");
                  saved.push({ idx: script.idx, src: script.src, path: outPath, size: content.length });
                  totalSize += content.length;
                } catch { /* skip failed downloads */ }
              }

              let msg = `批量Dump完成\n${"━".repeat(40)}\n`;
              msg += `保存目录: ${outDir}\n`;
              msg += `成功: ${saved.length}/${targetScripts.length} 个脚本 (共${(totalSize / 1024).toFixed(0)}KB)\n\n`;
              for (const s of saved) {
                msg += `  #${s.idx} ${path.basename(s.path)} (${(s.size / 1024).toFixed(1)}KB)\n`;
              }
              if (saved.length > 0) {
                msg += `\n📋 下一步:\n`;
                msg += `  webpack_analyze filePath="${saved[0].path}" — 分析Webpack结构\n`;
                msg += `  search_code keyword="anti_content" filePath="${saved[0].path}" — 搜索关键词\n`;
              }
              return { success: true, message: msg, data: { dir: outDir, files: saved } };
            }

            // 无savePath时: 列出所有脚本供选择
            let msg = `页面脚本列表 (${scriptList.length}个)\n${"━".repeat(40)}\n`;
            for (const s of scriptList) {
              if (s.src) {
                const fname = path.basename(new URL(s.src).pathname).replace(/[?#].*/, "");
                msg += `  #${s.idx} [外部] ${fname}\n       ${s.src.slice(0, 120)}\n`;
              } else {
                msg += `  #${s.idx} [内联] ${s.size}字符\n`;
              }
            }
            msg += `\n用法:\n`;
            msg += `  dump_script scriptIndex=N — dump指定脚本\n`;
            msg += `  dump_script savePath="C:/dir/" — dump所有外部JS到目录\n`;
            msg += `  dump_script savePath="C:/dir/" keyword="login" — dump文件名含login的JS\n`;
            return { success: true, message: msg, data: { total: scriptList.length, external: extScripts.length } };
          }

          // 指定scriptIndex: dump单个脚本
          const scriptContent = await page.evaluate((idx: number) => {
            const scripts = document.querySelectorAll("script");
            const s = scripts[idx];
            if (!s) return { ok: false, error: `脚本 #${idx} 不存在 (共${scripts.length}个)` };
            return s.src
              ? { ok: true, src: s.src, content: "", inline: false }
              : { ok: true, src: "(inline)", content: s.textContent || "", inline: true };
          }, scriptIndex);

          if (!scriptContent.ok) return { success: false, message: scriptContent.error || "获取失败" };

          let content = scriptContent.content || "";

          if (!scriptContent.inline && scriptContent.src) {
            try {
              content = await page.evaluate(async (url: string) => {
                const r = await fetch(url);
                return r.text();
              }, scriptContent.src);
            } catch {
              return { success: false, message: `无法下载脚本(CORS限制): ${scriptContent.src}\n建议: 直接通过 http_request 工具从服务端下载，或复制URL在浏览器地址栏打开。` };
            }
          }

          const analysis = analyzeObfuscation(content);

          if (savePath) {
            const outPath = path.resolve(savePath);
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, content, "utf-8");
            let msg = `脚本已保存: ${outPath} (${(content.length / 1024).toFixed(1)}KB)\n来源: ${scriptContent.src}\n`;
            msg += `\n混淆评分: ${analysis.score}/100\n`;
            if (analysis.indicators.length) msg += `特征: ${analysis.indicators.join("、")}\n`;
            if (analysis.encryptionPatterns.length) msg += `加密算法: ${analysis.encryptionPatterns.join(", ")}\n`;
            if (analysis.suspiciousFunctions.length) msg += `可疑函数: ${analysis.suspiciousFunctions.join(", ")}\n`;
            return { success: true, message: msg, data: { path: outPath, size: content.length, analysis } };
          }

          const preview = content.length > 5000 ? content.slice(0, 5000) + "\n... (使用savePath保存完整文件)" : content;
          let msg = `脚本内容 #${scriptIndex} (${(content.length / 1024).toFixed(1)}KB)\n来源: ${scriptContent.src}\n`;
          msg += `混淆评分: ${analysis.score}/100\n`;
          if (analysis.indicators.length) msg += `特征: ${analysis.indicators.join("、")}\n`;
          if (analysis.encryptionPatterns.length) msg += `加密算法: ${analysis.encryptionPatterns.join(", ")}\n`;
          msg += `━━━━━━━━━━━━━━━━━━━━\n${preview}`;

          return { success: true, message: msg, data: { src: scriptContent.src, size: content.length, analysis } };
        }

        case "beautify": {
          let rawCode = code || "";

          if (!rawCode && scriptIndex !== undefined) {
            const scriptContent = await page.evaluate((idx: number) => {
              const scripts = document.querySelectorAll("script");
              const s = scripts[idx];
              if (!s) return { ok: false, content: "" };
              if (s.src) return { ok: true, content: "", src: s.src };
              return { ok: true, content: s.textContent || "" };
            }, scriptIndex);

            if (!scriptContent.ok) return { success: false, message: `脚本 #${scriptIndex} 不存在` };

            if (scriptContent.src) {
              try {
                rawCode = await page.evaluate(async (url: string) => {
                  const r = await fetch(url); return r.text();
                }, scriptContent.src);
              } catch {
                return { success: false, message: `无法下载脚本: ${scriptContent.src}` };
              }
            } else {
              rawCode = scriptContent.content || "";
            }
          }

          if (!rawCode) return { success: false, message: "需要提供 code 或 scriptIndex 参数" };

          const beautified = jsBeautify(rawCode);
          const analysis = analyzeObfuscation(rawCode);

          if (savePath) {
            const outPath = path.resolve(savePath);
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, beautified, "utf-8");
            return {
              success: true,
              message: `美化后代码已保存: ${outPath}\n原始: ${(rawCode.length / 1024).toFixed(1)}KB → 美化: ${(beautified.length / 1024).toFixed(1)}KB\n混淆评分: ${analysis.score}/100\n${analysis.indicators.length ? "特征: " + analysis.indicators.join("、") : ""}`,
              data: { path: outPath, originalSize: rawCode.length, beautifiedSize: beautified.length, analysis },
            };
          }

          const preview = beautified.length > 6000 ? beautified.slice(0, 6000) + "\n... (使用savePath保存完整文件)" : beautified;
          let msg = `美化后代码 (${(beautified.length / 1024).toFixed(1)}KB)\n混淆评分: ${analysis.score}/100\n`;
          if (analysis.indicators.length) msg += `特征: ${analysis.indicators.join("、")}\n`;
          if (analysis.encryptionPatterns.length) msg += `加密算法: ${analysis.encryptionPatterns.join(", ")}\n`;
          if (analysis.suspiciousFunctions.length) msg += `可疑函数: ${analysis.suspiciousFunctions.join(", ")}\n`;
          msg += `━━━━━━━━━━━━━━━━━━━━\n${preview}`;

          return { success: true, message: msg, data: { originalSize: rawCode.length, beautifiedSize: beautified.length, analysis } };
        }

        case "full_scan": {
          if (code && code.trim().length > 0) {
            const src = filePath ? path.basename(filePath) : "传入代码";
            const sizeKB = (code.length / 1024).toFixed(1);
            const lines = code.split("\n");
            let msg = `JS逆向全量扫描报告 (本地文件)\n${"━".repeat(40)}\n`;
            msg += `文件: ${src} (${sizeKB}KB, ${lines.length}行)\n扫描时间: ${new Date().toLocaleString()}\n\n`;

            const funcRe = /(?:function\s+(\w+)\s*\(|(\w+)\s*[=:]\s*(?:async\s+)?function|(\w+)\s*[=:]\s*\([^)]*\)\s*=>)/g;
            const classRe = /class\s+(\w+)/g;
            const exportRe = /(?:export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)|module\.exports|exports\.(\w+))/g;
            const funcs: Array<{ name: string; line: number }> = [];
            const classes: Array<{ name: string; line: number }> = [];
            const exports: Array<{ name: string; line: number }> = [];

            for (let i = 0; i < lines.length; i++) {
              let m;
              funcRe.lastIndex = 0;
              while ((m = funcRe.exec(lines[i])) !== null) {
                const name = m[1] || m[2] || m[3];
                if (name && name.length > 1) funcs.push({ name, line: i + 1 });
              }
              classRe.lastIndex = 0;
              while ((m = classRe.exec(lines[i])) !== null) classes.push({ name: m[1], line: i + 1 });
              exportRe.lastIndex = 0;
              while ((m = exportRe.exec(lines[i])) !== null) exports.push({ name: m[1] || m[2] || "default", line: i + 1 });
            }

            msg += `函数: ${funcs.length}个\n`;
            for (const f of funcs.slice(0, 40)) msg += `  行${String(f.line).padStart(6)}: ${f.name}\n`;
            if (funcs.length > 40) msg += `  ... 还有 ${funcs.length - 40} 个\n`;

            msg += `\n类: ${classes.length}个\n`;
            for (const c of classes) msg += `  行${String(c.line).padStart(6)}: ${c.name}\n`;

            msg += `\n导出: ${exports.length}个\n`;
            for (const e of exports) msg += `  行${String(e.line).padStart(6)}: ${e.name}\n`;

            const keywords = ["encrypt", "decrypt", "sign", "token", "secret", "password", "key", "md5", "sha", "aes", "rsa", "hmac", "anti_content", "anti-content", "messagePack", "fingerprint", "hash", "base64"];
            const keywordHits: Record<string, Array<{ line: number; context: string }>> = {};
            for (const kw of keywords) {
              const re = new RegExp(kw, "gi");
              for (let i = 0; i < lines.length; i++) {
                re.lastIndex = 0;
                if (re.test(lines[i])) {
                  if (!keywordHits[kw]) keywordHits[kw] = [];
                  if (keywordHits[kw].length < 5) {
                    keywordHits[kw].push({ line: i + 1, context: lines[i].trim().slice(0, 150) });
                  }
                }
              }
            }

            const hitKeys = Object.keys(keywordHits);
            if (hitKeys.length > 0) {
              msg += `\n🔑 关键词命中:\n`;
              for (const kw of hitKeys) {
                msg += `  "${kw}" (${keywordHits[kw].length}处):\n`;
                for (const h of keywordHits[kw]) msg += `    行${h.line}: ${h.context}\n`;
              }
            } else {
              msg += `\n🔑 未发现加密/签名关键词\n`;
            }

            const urlRe = /['"]https?:\/\/[^'"]{10,}['"]/g;
            const apis = new Set<string>();
            let um;
            while ((um = urlRe.exec(code)) !== null && apis.size < 20) apis.add(um[0].slice(1, -1));
            if (apis.size > 0) {
              msg += `\n🔗 API端点 (${apis.size}个):\n`;
              for (const a of apis) msg += `  ${a.slice(0, 150)}\n`;
            }

            const analysis = analyzeObfuscation(code);
            msg += `\n🛡 混淆评分: ${analysis.score}/100 (${analysis.score < 30 ? "低" : analysis.score < 60 ? "中" : "高"})\n`;
            if (analysis.indicators.length) msg += `  特征: ${analysis.indicators.join("、")}\n`;
            if (analysis.encryptionPatterns.length) msg += `  加密算法: ${analysis.encryptionPatterns.join("、")}\n`;

            msg += `\n📋 建议:\n`;
            if (hitKeys.length > 0) msg += `  1. search_code keyword="${hitKeys[0]}" 深入搜索\n`;
            msg += `  2. beautify 美化代码后分析\n`;
            msg += `  3. analyze_file + read_lines 查看关键行上下文\n`;

            return { success: true, message: msg, data: { functions: funcs.length, classes: classes.length, keywordHits: hitKeys, obfuscationScore: analysis.score } };
          }

          let msg = `🔍 JS逆向全量扫描报告\n${"━".repeat(40)}\n`;
          msg += `目标: ${page.url()}\n扫描时间: ${new Date().toLocaleString()}\n\n`;

          // 1. 脚本清单
          const scripts = await page.evaluate(() => {
            const result: Array<{ src: string; inline: boolean; size: number }> = [];
            document.querySelectorAll("script").forEach((s) => {
              result.push({ src: s.src || "(inline)", inline: !s.src, size: s.textContent?.length || 0 });
            });
            return result;
          });

          msg += `📁 JS脚本 (${scripts.length}个)\n`;
          const externalScripts = scripts.filter((s) => !s.inline);
          const inlineScripts = scripts.filter((s) => s.inline);
          msg += `  外部脚本: ${externalScripts.length}个\n`;
          externalScripts.forEach((s) => { msg += `    ${s.src.slice(0, 120)}\n`; });
          msg += `  内联脚本: ${inlineScripts.length}个 (${inlineScripts.reduce((a, s) => a + s.size, 0)} 字符)\n\n`;

          // 2. 全局变量 + 加密库
          const globals = await page.evaluate(() => {
            const builtins = new Set(["undefined","NaN","Infinity","eval","parseInt","parseFloat","Object","Function","Boolean","Symbol","Error","Number","Math","Date","String","RegExp","Array","JSON","Promise","Proxy","Reflect","Intl","globalThis","window","self","document","location","navigator","history","screen","performance","console","fetch","XMLHttpRequest","setTimeout","setInterval","clearTimeout","clearInterval","atob","btoa","URL","URLSearchParams","FormData","Blob","File","crypto","localStorage","sessionStorage","chrome"]);
            const fns: string[] = [];
            const objs: string[] = [];
            const w = window as unknown as Record<string, unknown>;
            for (const key of Object.getOwnPropertyNames(window)) {
              if (builtins.has(key) || key.startsWith("__") || key.startsWith("webkit") || key.startsWith("on") || key.startsWith("_")) continue;
              try {
                const t = typeof w[key];
                if (t === "function") fns.push(key);
                else if (t === "object" && w[key] !== null) objs.push(key);
              } catch { /* skip */ }
            }

            const libs: string[] = [];
            if (w.CryptoJS) libs.push("CryptoJS");
            if (w.JSEncrypt) libs.push("JSEncrypt(RSA)");
            if (w.md5 || w.MD5) libs.push("MD5");
            if (w.forge) libs.push("node-forge");
            if (w.sjcl) libs.push("SJCL");
            if (w.sm2 || w.sm3 || w.sm4) libs.push("国密SM");
            if (w.jsrsasign) libs.push("jsrsasign");
            if (w.nacl) libs.push("TweetNaCl");
            if (w.aesjs) libs.push("aes-js");
            if (w.Base64) libs.push("Base64");
            if (w.SHA256 || w.sha256) libs.push("SHA256");

            return { fns, objs, libs };
          });

          if (globals.libs.length > 0) {
            msg += `🔐 检测到加密库: ${globals.libs.join(", ")}\n\n`;
          }
          msg += `🌐 自定义全局函数 (${globals.fns.length}个): ${globals.fns.slice(0, 20).join(", ")}${globals.fns.length > 20 ? "..." : ""}\n`;
          msg += `📦 自定义全局对象 (${globals.objs.length}个): ${globals.objs.slice(0, 20).join(", ")}${globals.objs.length > 20 ? "..." : ""}\n\n`;

          // 3. 关键词搜索
          const keywords = ["encrypt", "decrypt", "sign", "token", "secret", "password", "key", "md5", "sha", "aes", "rsa", "hmac"];
          const keywordHits: Record<string, number> = {};

          const allInlineCode = await page.evaluate(() => {
            return Array.from(document.querySelectorAll("script"))
              .filter((s) => !s.src)
              .map((s) => s.textContent || "")
              .join("\n");
          });

          for (const kw of keywords) {
            const count = (allInlineCode.match(new RegExp(kw, "gi")) || []).length;
            if (count > 0) keywordHits[kw] = count;
          }

          if (Object.keys(keywordHits).length > 0) {
            msg += `🔑 关键词命中 (内联脚本):\n`;
            for (const [kw, count] of Object.entries(keywordHits).sort((a, b) => b[1] - a[1])) {
              msg += `  "${kw}": ${count}次\n`;
            }
            msg += "\n";
          } else {
            msg += `🔑 内联脚本中未发现加密相关关键词\n\n`;
          }

          // 4. API端点
          const apis = await page.evaluate(() => {
            const found = new Set<string>();
            const patterns = [
              /['"`](\/api\/[^\s'"`]+)/g,
              /['"`](\/v\d+\/[^\s'"`]+)/g,
              /['"`](\/rest\/[^\s'"`]+)/g,
              /fetch\s*\(\s*['"`]([^'"`]+)/gi,
            ];
            document.querySelectorAll("script").forEach((s) => {
              const code = s.textContent || "";
              for (const p of patterns) {
                let m;
                while ((m = p.exec(code)) !== null) found.add(m[1]);
              }
            });
            return Array.from(found);
          });

          if (apis.length > 0) {
            msg += `🔗 发现API端点 (${apis.length}个):\n`;
            apis.slice(0, 15).forEach((a) => { msg += `  ${a}\n`; });
            if (apis.length > 15) msg += `  ... 还有 ${apis.length - 15} 个\n`;
            msg += "\n";
          }

          // 5. 混淆分析
          const analysis = analyzeObfuscation(allInlineCode);
          msg += `🛡 混淆程度: ${analysis.score}/100 (${analysis.score < 30 ? "低" : analysis.score < 60 ? "中" : "高"})\n`;
          if (analysis.indicators.length) {
            msg += `  特征: ${analysis.indicators.join("、")}\n`;
          }

          // 6. 建议
          msg += `\n📋 建议操作:\n`;
          if (globals.libs.length > 0) {
            msg += `  1. Hook加密函数: hook_function → "${globals.libs[0]}" 相关方法\n`;
          }
          if (Object.keys(keywordHits).length > 0) {
            const topKw = Object.entries(keywordHits).sort((a, b) => b[1] - a[1])[0][0];
            msg += `  2. 深入搜索: search_code keyword="${topKw}"\n`;
          }
          msg += `  3. 抓包验证: network_capture start → 操作页面 → list\n`;
          if (analysis.score > 50) {
            msg += `  4. 反混淆: beautify + scriptIndex 美化混淆代码\n`;
          }

          return { success: true, message: msg, data: { scriptCount: scripts.length, cryptoLibs: globals.libs, keywordHits, apiCount: apis.length, obfuscationScore: analysis.score } };
        }

        case "webpack_analyze": {
          if (!code || !code.trim()) return { success: false, message: "需要提供 filePath 或 code 参数（Webpack打包的JS文件）" };
          const wp = analyzeWebpack(code);
          const src = filePath ? path.basename(filePath) : "传入代码";
          let msg = `Webpack打包分析: ${src} (${(code.length / 1024).toFixed(0)}KB)\n${"━".repeat(40)}\n\n`;
          msg += `打包格式: ${wp.format}\n`;
          msg += `Loader变量: ${wp.loaderVar || "未识别"}\n`;
          msg += `模块总数: ${wp.modules.size}\n`;
          msg += `入口模块: ${wp.entryModules.length > 0 ? wp.entryModules.join(", ") : "未识别(可手动指定)"}\n`;
          if (wp.chunkIds.length > 0) msg += `Chunk IDs: ${wp.chunkIds.join(", ")}\n`;

          const mods = Array.from(wp.modules.values());
          const withDeps = mods.filter((m) => m.deps.length > 0);
          const exportMods = mods.filter((m) => m.hasExports);
          msg += `\n有依赖的模块: ${withDeps.length}个\n`;
          msg += `有导出的模块: ${exportMods.length}个\n\n`;

          msg += `【模块列表 (前50)】\n`;
          for (const m of mods.slice(0, 50)) {
            const sizeStr = m.size > 1024 ? `${(m.size / 1024).toFixed(1)}KB` : `${m.size}B`;
            msg += `  [${m.id}] ${sizeStr} 依赖:[${m.deps.slice(0, 5).join(",")}${m.deps.length > 5 ? "..." : ""}]`;
            if (m.isEntry) msg += " *入口*";
            msg += "\n";
          }
          if (mods.length > 50) msg += `  ... 还有 ${mods.length - 50} 个模块\n`;

          const cryptoKws = ["encrypt", "decrypt", "sign", "hash", "md5", "sha", "aes", "rsa", "hmac", "anti_content", "anti-content", "messagePack", "fingerprint", "token", "secret"];
          const cryptoMods: Array<{ id: string | number; keywords: string[] }> = [];
          for (const m of mods) {
            const found: string[] = [];
            for (const kw of cryptoKws) {
              if (m.code.toLowerCase().includes(kw)) found.push(kw);
            }
            if (found.length > 0) cryptoMods.push({ id: m.id, keywords: found });
          }

          if (cryptoMods.length > 0) {
            msg += `\n🔐 【含加密/签名关键词的模块】\n`;
            for (const cm of cryptoMods.slice(0, 20)) {
              msg += `  模块[${cm.id}]: ${cm.keywords.join(", ")}\n`;
            }
          }

          msg += `\n📋 下一步:\n`;
          msg += `  1. webpack_extract + moduleId="模块ID" → 提取模块及依赖，生成可独立运行JS\n`;
          msg += `  2. search_code + keyword → 在所有模块中搜索关键代码\n`;
          if (cryptoMods.length > 0) {
            msg += `  3. 建议优先分析模块: ${cryptoMods.map((c) => c.id).slice(0, 5).join(", ")}\n`;
          }

          return {
            success: true, message: msg,
            data: { format: wp.format, moduleCount: wp.modules.size, entryModules: wp.entryModules, cryptoModules: cryptoMods.map((c) => c.id) },
          };
        }

        case "webpack_extract": {
          if (!code || !code.trim()) return { success: false, message: "需要提供 filePath 或 code 参数" };
          if (!moduleId) return { success: false, message: "需要提供 moduleId 参数（从 webpack_analyze 获取）" };

          const wp = analyzeWebpack(code);
          if (wp.modules.size === 0) return { success: false, message: "未识别到Webpack模块，请确认文件是Webpack打包输出" };

          const targetId = isNaN(Number(moduleId)) ? moduleId : Number(moduleId);
          const { modules: extracted, missing } = extractModuleWithDeps(wp, targetId);

          if (extracted.length === 0) {
            return { success: false, message: `模块 ${moduleId} 不存在。可用模块: ${Array.from(wp.modules.keys()).slice(0, 20).join(", ")}` };
          }

          const standaloneJs = generateStandaloneJs(wp, extracted, targetId);

          if (savePath) {
            const outPath = path.resolve(savePath);
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, standaloneJs, "utf-8");
            let msg = `Webpack模块提取完成\n${"━".repeat(40)}\n`;
            msg += `目标模块: ${moduleId}\n`;
            msg += `提取模块数: ${extracted.length} (含依赖)\n`;
            if (missing.length > 0) msg += `缺失依赖: ${missing.join(", ")} (可能是内置模块)\n`;
            msg += `输出文件: ${outPath} (${(standaloneJs.length / 1024).toFixed(1)}KB)\n`;
            msg += `\n文件内容:\n  1. 补环境代码 (window/document/navigator等)\n  2. Webpack Loader 函数\n  3. ${extracted.length}个模块定义\n  4. 入口执行代码\n`;
            msg += `\n运行方式: node ${path.basename(outPath)}`;
            return { success: true, message: msg, data: { moduleId, extractedCount: extracted.length, missing, path: outPath } };
          }

          const preview = standaloneJs.length > 8000 ? standaloneJs.slice(0, 8000) + "\n\n... (使用 savePath 保存完整文件)" : standaloneJs;
          let msg = `模块 ${moduleId} 提取完成 (${extracted.length}个模块, ${(standaloneJs.length / 1024).toFixed(1)}KB)\n`;
          if (missing.length > 0) msg += `缺失依赖: ${missing.join(", ")}\n`;
          msg += `${"━".repeat(40)}\n${preview}`;

          return { success: true, message: msg, data: { moduleId, extractedCount: extracted.length, missing } };
        }

        case "gen_env": {
          const envCode = generateEnvCode();

          if (savePath) {
            const outPath = path.resolve(savePath);
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, envCode, "utf-8");
            return {
              success: true,
              message: `补环境代码已生成: ${outPath} (${(envCode.length / 1024).toFixed(1)}KB)\n\n包含: window, self, globalThis, location, navigator, document(含createElement/canvas), screen, history, localStorage, sessionStorage, XMLHttpRequest, Image, Audio, Event, setTimeout/setInterval, atob/btoa, crypto, performance, fetch, MutationObserver, TextEncoder/TextDecoder\n\n用法: 在目标JS文件开头 require 此文件`,
              data: { path: outPath, size: envCode.length },
            };
          }

          return {
            success: true,
            message: `补环境代码 (${(envCode.length / 1024).toFixed(1)}KB)\n${"━".repeat(40)}\n${envCode.slice(0, 6000)}\n\n... 使用 savePath 保存完整文件`,
            data: { size: envCode.length },
          };
        }

        case "auto_reverse": {
          const kw = targetKeyword || "anti_content";
          const outDir = savePath ? path.dirname(path.resolve(savePath)) : "C:\\Users\\Administrator\\Desktop";
          const timestamp = Date.now();
          const steps: string[] = [];
          let msg = `🔄 自动化深度逆向: "${kw}"\n${"━".repeat(50)}\n`;

          // Step 1: 列出所有脚本
          steps.push("Step1: 扫描页面脚本");
          const scriptList = await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll("script"));
            return scripts.map((s, i) => ({
              index: i,
              src: s.src || "(inline)",
              size: (s.textContent || "").length,
              hasContent: !!(s.textContent?.trim()),
            }));
          });
          msg += `\n📋 Step1: 发现 ${scriptList.length} 个脚本\n`;
          const externalScripts = scriptList.filter((s) => s.src !== "(inline)" && s.src.endsWith(".js"));
          msg += `  外部JS: ${externalScripts.length}个, 内联: ${scriptList.length - externalScripts.length}个\n`;

          // Step 2: 全局变量/加密库扫描
          steps.push("Step2: 全局变量扫描");
          const globals = await page.evaluate(() => {
            const known = new Set(["undefined","NaN","Infinity","eval","isFinite","isNaN","parseFloat","parseInt",
              "decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape",
              "Object","Function","Boolean","Symbol","Error","Number","BigInt","Math","Date","String",
              "RegExp","Array","Map","Set","WeakMap","WeakSet","ArrayBuffer","SharedArrayBuffer",
              "DataView","Float32Array","Float64Array","Int8Array","Int16Array","Int32Array",
              "Uint8Array","Uint8ClampedArray","Uint16Array","Uint32Array","JSON","Promise","Proxy","Reflect",
              "globalThis","Atomics","WebAssembly","console","window","self","document","navigator","location",
              "history","screen","alert","confirm","prompt","setTimeout","clearTimeout","setInterval","clearInterval",
              "requestAnimationFrame","cancelAnimationFrame","fetch","XMLHttpRequest","URL","URLSearchParams",
              "Headers","Request","Response","FormData","Blob","File","FileReader","FileList","AbortController",
              "AbortSignal","Event","EventTarget","CustomEvent","MessageEvent","ErrorEvent","CloseEvent",
              "crypto","performance","localStorage","sessionStorage","indexedDB","caches","CacheStorage",
              "MutationObserver","IntersectionObserver","ResizeObserver","PerformanceObserver",
              "Image","Audio","Video","MediaSource","SourceBuffer","TextEncoder","TextDecoder",
              "atob","btoa","queueMicrotask","structuredClone","reportError","focus","blur","close","stop",
              "open","print","postMessage","getComputedStyle","matchMedia","requestIdleCallback",
              "cancelIdleCallback","getSelection","frames","parent","top","opener","closed","name",
              "status","toolbar","menubar","scrollbars","personalbar","locationbar","statusbar",
              "innerWidth","innerHeight","outerWidth","outerHeight","scrollX","scrollY","pageXOffset","pageYOffset",
              "screenX","screenY","screenLeft","screenTop","devicePixelRatio","visualViewport",
              "chrome","Notification","ServiceWorker","Worker","SharedWorker",
            ]);
            const customs: Array<{ name: string; type: string; preview: string }> = [];
            for (const key of Object.keys(window)) {
              if (known.has(key) || key.startsWith("__") && key.endsWith("__")) continue;
              try {
                const val = (window as unknown as Record<string, unknown>)[key];
                const type = typeof val;
                let preview = "";
                if (type === "function") preview = String(val).slice(0, 120);
                else if (type === "object" && val) preview = JSON.stringify(val)?.slice(0, 120) || "[object]";
                else preview = String(val).slice(0, 80);
                customs.push({ name: key, type, preview });
              } catch { customs.push({ name: key, type: "error", preview: "[不可读]" }); }
            }
            return customs;
          });
          msg += `\n🌐 Step2: ${globals.length} 个自定义全局变量\n`;
          const suspiciousGlobals = globals.filter((g) =>
            g.name.toLowerCase().includes("sign") || g.name.toLowerCase().includes("encrypt") ||
            g.name.toLowerCase().includes("anti") || g.name.toLowerCase().includes("token") ||
            g.name.toLowerCase().includes("secret") || g.name.toLowerCase().includes("finger") ||
            g.name.toLowerCase().includes("crypto") || g.type === "function"
          );
          for (const g of suspiciousGlobals.slice(0, 20)) {
            msg += `  ${g.name} [${g.type}]: ${g.preview.slice(0, 80)}\n`;
          }

          // Step 3: 搜索所有脚本中的目标关键词
          steps.push("Step3: 关键词深度搜索");
          const kwLower = kw.toLowerCase();
          const searchKeywords = [kw, "encrypt", "sign", "hash", "md5", "aes", "token", "secret", "fingerprint"];
          const searchUnique = [...new Set(searchKeywords.map((k) => k.toLowerCase()))];

          const searchResults: Array<{ scriptIdx: number; src: string; keyword: string; matchCount: number; contexts: string[] }> = [];
          for (const script of externalScripts.slice(0, 15)) {
            try {
              const content = await page.evaluate(async (url: string) => {
                try { const r = await fetch(url); return await r.text(); } catch { return ""; }
              }, script.src);
              if (!content) continue;

              for (const k of searchUnique) {
                const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
                const matches = content.match(re);
                if (matches && matches.length > 0) {
                  const contexts: string[] = [];
                  let pos = 0;
                  for (let i = 0; i < Math.min(matches.length, 5); i++) {
                    const idx = content.toLowerCase().indexOf(k.toLowerCase(), pos);
                    if (idx >= 0) {
                      const start = Math.max(0, idx - 60);
                      const end = Math.min(content.length, idx + k.length + 60);
                      contexts.push(content.slice(start, end).replace(/\n/g, " "));
                      pos = idx + k.length;
                    }
                  }
                  searchResults.push({
                    scriptIdx: script.index,
                    src: script.src,
                    keyword: k,
                    matchCount: matches.length,
                    contexts,
                  });
                }
              }
            } catch { /* fetch failed, skip */ }
          }

          // Also search inline scripts
          for (const script of scriptList.filter((s) => s.src === "(inline)" && s.hasContent)) {
            const content = await page.evaluate((idx: number) => {
              const s = document.querySelectorAll("script")[idx];
              return s?.textContent || "";
            }, script.index);
            if (!content) continue;

            for (const k of searchUnique) {
              const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
              const matches = content.match(re);
              if (matches && matches.length > 0) {
                const contexts: string[] = [];
                let pos = 0;
                for (let i = 0; i < Math.min(matches.length, 3); i++) {
                  const idx = content.toLowerCase().indexOf(k.toLowerCase(), pos);
                  if (idx >= 0) {
                    contexts.push(content.slice(Math.max(0, idx - 60), Math.min(content.length, idx + k.length + 60)).replace(/\n/g, " "));
                    pos = idx + k.length;
                  }
                }
                searchResults.push({ scriptIdx: script.index, src: "(inline)", keyword: k, matchCount: matches.length, contexts });
              }
            }
          }

          msg += `\n🔍 Step3: 关键词搜索结果\n`;
          const targetHits = searchResults.filter((r) => r.keyword.toLowerCase() === kwLower);
          const otherHits = searchResults.filter((r) => r.keyword.toLowerCase() !== kwLower);

          if (targetHits.length > 0) {
            msg += `  ★ "${kw}" 命中 ${targetHits.length} 个脚本:\n`;
            for (const hit of targetHits) {
              msg += `    脚本#${hit.scriptIdx} (${path.basename(hit.src)}) — ${hit.matchCount}处\n`;
              for (const ctx of hit.contexts.slice(0, 3)) {
                msg += `      ... ${ctx.slice(0, 120)} ...\n`;
              }
            }
          } else {
            msg += `  ⚠ "${kw}" 未在任何脚本中直接找到\n`;
          }
          if (otherHits.length > 0) {
            msg += `  其他关键词命中:\n`;
            const grouped = new Map<string, typeof otherHits>();
            for (const h of otherHits) {
              const arr = grouped.get(h.keyword) || [];
              arr.push(h);
              grouped.set(h.keyword, arr);
            }
            for (const [k, hits] of grouped) {
              msg += `    "${k}": ${hits.length}个脚本 (共${hits.reduce((s, h) => s + h.matchCount, 0)}处)\n`;
            }
          }

          // Step 4: Hook 关键函数
          steps.push("Step4: Hook关键函数");
          const hookTargets = [
            "JSON.stringify", "JSON.parse",
            "XMLHttpRequest.prototype.open", "XMLHttpRequest.prototype.send",
          ];
          const hookResults: string[] = [];
          for (const fn of hookTargets) {
            try {
              const logKey = `__xiniu_hook_${fn.replace(/\./g, "_")}`;
              await page.evaluate((fname: string, lk: string) => {
                try {
                  const parts = fname.split(".");
                  let obj: Record<string, unknown> = window as unknown as Record<string, unknown>;
                  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]] as Record<string, unknown>;
                  const origFn = obj[parts[parts.length - 1]] as (...args: unknown[]) => unknown;
                  if (typeof origFn !== "function") return;
                  (window as unknown as Record<string, unknown[]>)[lk] = [];
                  obj[parts[parts.length - 1]] = function (this: unknown, ...args: unknown[]) {
                    const logs = (window as unknown as Record<string, unknown[]>)[lk];
                    const entry: Record<string, unknown> = {
                      time: new Date().toISOString(),
                      args: args.map((a) => { try { return typeof a === "object" ? JSON.stringify(a)?.slice(0, 500) : String(a).slice(0, 500); } catch { return "[循环引用]"; } }),
                    };
                    try { entry.stack = new Error().stack?.split("\n").slice(2, 6).map((l) => l.trim()) || []; } catch {}
                    try { const r = origFn.apply(this, args); entry.result = typeof r === "object" ? JSON.stringify(r)?.slice(0, 500) : String(r).slice(0, 200); logs.push(entry); return r; }
                    catch (e) { entry.error = String(e); logs.push(entry); throw e; }
                  };
                } catch {}
              }, fn, logKey);
              hookResults.push(fn);
            } catch { /* hook failed */ }
          }
          msg += `\n🪝 Step4: Hook了 ${hookResults.length} 个关键函数\n`;
          msg += `  ${hookResults.join(", ")}\n`;

          // Step 5: dump最可能包含目标的脚本
          steps.push("Step5: Dump目标脚本");
          const targetScriptIndexes = targetHits.length > 0
            ? [...new Set(targetHits.map((h) => h.scriptIdx))]
            : otherHits.length > 0
              ? [...new Set(otherHits.slice(0, 3).map((h) => h.scriptIdx))]
              : externalScripts.slice(0, 2).map((s) => s.index);

          const dumpedFiles: string[] = [];
          for (const idx of targetScriptIndexes.slice(0, 3)) {
            try {
              const script = scriptList[idx];
              let content = "";
              if (script.src !== "(inline)") {
                content = await page.evaluate(async (url: string) => {
                  try { const r = await fetch(url); return await r.text(); } catch { return ""; }
                }, script.src);
              } else {
                content = await page.evaluate((i: number) => document.querySelectorAll("script")[i]?.textContent || "", idx);
              }
              if (!content) continue;

              const filename = script.src !== "(inline)"
                ? path.basename(new URL(script.src).pathname).replace(/[?#].*/, "")
                : `inline_${idx}.js`;
              const dumpPath = path.join(outDir, `reverse_${timestamp}_${filename}`);
              await fs.mkdir(outDir, { recursive: true });
              await fs.writeFile(dumpPath, content, "utf-8");
              dumpedFiles.push(dumpPath);
              msg += `\n📥 Step5: Dump 脚本#${idx} → ${dumpPath} (${(content.length / 1024).toFixed(1)}KB)\n`;

              // Step 6: Webpack分析
              const wp = analyzeWebpack(content);
              if (wp.modules.size > 0) {
                msg += `\n📦 Step6: Webpack分析 — ${wp.format} 格式, ${wp.modules.size}个模块\n`;

                const cryptoKws = [kw, "encrypt", "decrypt", "sign", "hash", "md5", "sha", "aes", "rsa", "hmac", "anti_content", "fingerprint", "token", "secret"];
                const cryptoMods: Array<{ id: string | number; keywords: string[] }> = [];
                for (const m of wp.modules.values()) {
                  const found: string[] = [];
                  for (const ck of cryptoKws) {
                    if (m.code.toLowerCase().includes(ck.toLowerCase())) found.push(ck);
                  }
                  if (found.length > 0) cryptoMods.push({ id: m.id, keywords: found });
                }

                if (cryptoMods.length > 0) {
                  msg += `  🔐 含"${kw}"相关的模块:\n`;
                  for (const cm of cryptoMods.slice(0, 10)) {
                    const mod = wp.modules.get(cm.id)!;
                    msg += `    [${cm.id}] ${(mod.size / 1024).toFixed(1)}KB 关键词:[${cm.keywords.join(",")}] 依赖:[${mod.deps.slice(0, 5).join(",")}]\n`;
                  }

                  // Step 7: 提取首个包含目标关键词的模块
                  const bestMod = cryptoMods.find((m) => m.keywords.includes(kw.toLowerCase())) || cryptoMods[0];
                  const { modules: extracted, missing } = extractModuleWithDeps(wp, bestMod.id);

                  if (extracted.length > 0) {
                    const standaloneJs = generateStandaloneJs(wp, extracted, bestMod.id);
                    const extractPath = path.join(outDir, `reverse_${timestamp}_module_${bestMod.id}.js`);
                    await fs.writeFile(extractPath, standaloneJs, "utf-8");
                    dumpedFiles.push(extractPath);
                    msg += `\n🎯 Step7: 提取模块[${bestMod.id}] + ${extracted.length - 1}个依赖 → ${extractPath}\n`;
                    msg += `  文件: ${(standaloneJs.length / 1024).toFixed(1)}KB (含补环境+Loader)\n`;
                    if (missing.length > 0) msg += `  缺失依赖: ${missing.slice(0, 10).join(", ")}\n`;
                    msg += `  运行: node "${path.basename(extractPath)}"\n`;
                  }
                } else {
                  msg += `  未找到含目标关键词的Webpack模块\n`;
                }
              } else {
                // 非Webpack打包，做混淆分析
                const analysis = analyzeObfuscation(content);
                msg += `\n🛡 混淆评分: ${analysis.score}/100\n`;
                if (analysis.encryptionPatterns.length) msg += `  加密算法: ${analysis.encryptionPatterns.join(", ")}\n`;
                if (analysis.suspiciousFunctions.length) msg += `  可疑函数: ${analysis.suspiciousFunctions.join(", ")}\n`;
              }
            } catch (err) {
              msg += `  ⚠ 脚本#${idx} 处理失败: ${err instanceof Error ? err.message : String(err)}\n`;
            }
          }

          // Summary
          msg += `\n${"━".repeat(50)}\n`;
          msg += `📊 逆向汇总\n`;
          msg += `  完成步骤: ${steps.join(" → ")}\n`;
          msg += `  扫描脚本: ${scriptList.length}个\n`;
          msg += `  关键词命中: ${targetHits.length > 0 ? `"${kw}"在${targetHits.length}个脚本中找到` : `"${kw}"未直接找到`}\n`;
          msg += `  Hook函数: ${hookResults.length}个\n`;
          msg += `  Dump文件: ${dumpedFiles.length}个\n`;
          for (const f of dumpedFiles) msg += `    ${f}\n`;
          msg += `\n📋 下一步操作建议:\n`;
          if (dumpedFiles.length > 0) {
            msg += `  1. 查看dump文件: read_file filePath="${dumpedFiles[0]}"\n`;
            msg += `  2. 在dump文件中搜索: regex_tester action=match filePath="${dumpedFiles[0]}" pattern="${kw}"\n`;
          }
          msg += `  3. 在页面上操作触发请求后查看Hook日志: js_reverse get_hook_logs functionName="JSON.stringify"\n`;
          msg += `  4. 如已提取Webpack模块: sandbox_run language=node filePath="提取的模块.js"\n`;
          msg += `\n⚠ 重要: 逆向结果必须基于真实代码分析，禁止编造或模拟加密算法！\n`;

          return {
            success: true, message: msg,
            data: { steps, scriptCount: scriptList.length, targetHits: targetHits.length, hookCount: hookResults.length, dumpedFiles },
          };
        }

        case "pdd_analyze": {
          const outDir = savePath ? path.dirname(path.resolve(savePath)) : "C:\\Users\\Administrator\\Desktop";
          const ts = Date.now();
          let msg = `🔴 拼多多 anti_content 专项逆向分析\n${"━".repeat(50)}\n`;

          const pddKeywords = [
            "anti_content", "anti-content", "antiContent", "getAntiContent", "getAnticontent",
            "messagePack", "messagePackSync", "MessagePack",
            "riskControlCrawler", "riskControl",
            "verifyFp", "fingerprint", "crawlerInfo", "verifyAuthToken",
            "touchEvents", "screenInfo", "serverTime",
            "deflate", "pako", "rawdeflate",
            "__LOADABLE_LOADED_CHUNKS__", "webpackChunk",
            "0aq", "0ap", "0ar", "0as",
            "sigerus", "dn(", "Object(l.a)",
          ];

          // Step 1: 扫描所有脚本
          msg += `\n📋 Step1: 扫描页面脚本\n`;
          const allScripts = await page.evaluate(() => {
            return Array.from(document.querySelectorAll("script")).map((s, i) => ({
              idx: i, src: s.src || "(inline)", size: (s.textContent || "").length,
            }));
          });
          const extScripts = allScripts.filter((s) => s.src !== "(inline)" && s.src.endsWith(".js"));
          msg += `  总计: ${allScripts.length}个 (外部JS: ${extScripts.length}个)\n`;

          // Step 2: 搜索PDD特征关键词
          msg += `\n🔍 Step2: PDD特征关键词搜索 (${pddKeywords.length}个关键词)\n`;
          interface PddHit { scriptIdx: number; src: string; keyword: string; count: number; contexts: string[] }
          const pddHits: PddHit[] = [];
          const scriptContents = new Map<number, string>();

          for (const script of extScripts.slice(0, 20)) {
            try {
              const content = await page.evaluate(async (url: string) => {
                try { const r = await fetch(url); return await r.text(); } catch { return ""; }
              }, script.src);
              if (!content) continue;
              scriptContents.set(script.idx, content);

              for (const kw of pddKeywords) {
                const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
                const matches = content.match(re);
                if (matches && matches.length > 0) {
                  const contexts: string[] = [];
                  let pos = 0;
                  for (let i = 0; i < Math.min(matches.length, 3); i++) {
                    const idx = content.toLowerCase().indexOf(kw.toLowerCase(), pos);
                    if (idx >= 0) {
                      contexts.push(content.slice(Math.max(0, idx - 80), Math.min(content.length, idx + kw.length + 80)).replace(/\n/g, " "));
                      pos = idx + kw.length;
                    }
                  }
                  pddHits.push({ scriptIdx: script.idx, src: script.src, keyword: kw, count: matches.length, contexts });
                }
              }
            } catch { /* skip */ }
          }

          // Also search inline
          for (const script of allScripts.filter((s) => s.src === "(inline)" && s.size > 10)) {
            const content = await page.evaluate((i: number) => document.querySelectorAll("script")[i]?.textContent || "", script.idx);
            if (!content) continue;
            scriptContents.set(script.idx, content);
            for (const kw of pddKeywords) {
              const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
              const matches = content.match(re);
              if (matches && matches.length > 0) {
                const contexts: string[] = [];
                let pos = 0;
                for (let i = 0; i < Math.min(matches.length, 2); i++) {
                  const idx = content.toLowerCase().indexOf(kw.toLowerCase(), pos);
                  if (idx >= 0) { contexts.push(content.slice(Math.max(0, idx - 80), Math.min(content.length, idx + kw.length + 80)).replace(/\n/g, " ")); pos = idx + kw.length; }
                }
                pddHits.push({ scriptIdx: script.idx, src: "(inline)", keyword: kw, count: matches.length, contexts });
              }
            }
          }

          // 汇总命中
          const hitsByScript = new Map<number, PddHit[]>();
          for (const h of pddHits) {
            const arr = hitsByScript.get(h.scriptIdx) || [];
            arr.push(h);
            hitsByScript.set(h.scriptIdx, arr);
          }

          if (pddHits.length === 0) {
            msg += `  ⚠ 未找到任何PDD特征关键词。可能:\n`;
            msg += `    - 代码经过深度混淆，关键词被编码\n`;
            msg += `    - anti_content在动态加载的JS中，需用cdp_scripts获取\n`;
            msg += `    - 页面使用了WASM或ServiceWorker\n`;
          } else {
            for (const [idx, hits] of hitsByScript) {
              const scriptSrc = hits[0].src;
              msg += `  脚本#${idx} (${path.basename(scriptSrc).slice(0, 50)})\n`;
              for (const h of hits) {
                msg += `    "${h.keyword}" — ${h.count}处\n`;
                if (h.contexts.length > 0) msg += `      ${h.contexts[0].slice(0, 120)}...\n`;
              }
            }
          }

          // Step 3: 定位 Webpack 加载器和 messagePack 调用
          msg += `\n📦 Step3: Webpack + messagePack 定位\n`;
          let targetScriptIdx = -1;
          let targetContent = "";

          // 优先找包含 messagePack 的脚本
          const mpHits = pddHits.filter((h) => h.keyword.toLowerCase().includes("messagepack"));
          if (mpHits.length > 0) {
            targetScriptIdx = mpHits[0].scriptIdx;
          } else {
            const antiHits = pddHits.filter((h) => h.keyword.toLowerCase().includes("anti"));
            if (antiHits.length > 0) targetScriptIdx = antiHits[0].scriptIdx;
            else if (extScripts.length > 0) targetScriptIdx = extScripts[0].idx;
          }

          if (targetScriptIdx >= 0) {
            targetContent = scriptContents.get(targetScriptIdx) || "";
            if (!targetContent) {
              const script = allScripts[targetScriptIdx];
              if (script && script.src !== "(inline)") {
                targetContent = await page.evaluate(async (url: string) => {
                  try { const r = await fetch(url); return await r.text(); } catch { return ""; }
                }, script.src);
              }
            }
          }

          if (targetContent) {
            // 分析Webpack结构
            const wp = analyzeWebpack(targetContent);
            msg += `  格式: ${wp.format}, 模块总数: ${wp.modules.size}\n`;

            // 在Webpack模块中搜索 messagePack / anti_content 相关模块
            const pddModKws = ["messagePack", "messagePackSync", "anti_content", "antiContent", "getAntiContent",
              "riskControlCrawler", "riskControl", "crawlerInfo", "verifyFp", "fingerprint",
              "verifyAuthToken", "serverTime", "deflate", "pako", "sigerus"];
            const pddMods: Array<{ id: string | number; keywords: string[]; code: string }> = [];

            for (const [id, mod] of wp.modules) {
              const found: string[] = [];
              const lc = mod.code.toLowerCase();
              for (const k of pddModKws) {
                if (lc.includes(k.toLowerCase())) found.push(k);
              }
              if (found.length > 0) pddMods.push({ id, keywords: found, code: mod.code });
            }

            if (pddMods.length > 0) {
              msg += `\n  🔐 PDD加密相关Webpack模块:\n`;
              for (const pm of pddMods.slice(0, 15)) {
                msg += `    模块[${pm.id}] (${(pm.code.length / 1024).toFixed(1)}KB): ${pm.keywords.join(", ")}\n`;

                // 尝试识别 n(291) 风格的调用
                const requireCalls = pm.code.match(/__webpack_require__\(\s*\d+\s*\)/g) || [];
                if (requireCalls.length > 0) {
                  msg += `      依赖: ${requireCalls.slice(0, 8).join(", ")}\n`;
                }

                // 检测 messagePack() 调用
                if (pm.code.includes("messagePack")) {
                  const mpMatch = pm.code.match(/new\s*\(?\s*\w+\s*\(?\s*\d*\s*\)?\s*\)?\s*\(\s*\{[\s\S]{0,200}?\}\s*\)\s*\.\s*messagePack\s*\(\s*\)/);
                  if (mpMatch) {
                    msg += `      ★ 发现 messagePack 调用: ${mpMatch[0].slice(0, 100)}\n`;
                  }
                }
              }

              // Step 4: 提取核心加密模块（多策略）
              msg += `\n🎯 Step4: 提取核心加密模块\n`;

              // 策略1: 包含 messagePack/messagePackSync 的模块
              const msgPackMod = pddMods.find((m) => m.keywords.includes("messagePackSync")) ||
                pddMods.find((m) => m.keywords.includes("messagePack"));
              // 策略2: 包含 riskControlCrawler 的模块
              const riskMod = pddMods.find((m) => m.keywords.includes("riskControlCrawler") || m.keywords.includes("riskControl"));
              // 策略3: 包含 anti_content / antiContent 的模块
              const antiMod = pddMods.find((m) => m.keywords.some((k) => k.toLowerCase().includes("anti")));
              // 策略4: 包含 n(291) 模式的模块
              let n291Mod: typeof pddMods[0] | undefined;
              for (const pm of pddMods) {
                if (/new\s*[\(\s]*\w+\s*\(\s*\d+\s*\)\s*[\)\s]*\(\s*\{/.test(pm.code)) {
                  n291Mod = pm;
                  break;
                }
              }

              const bestMod = msgPackMod || riskMod || n291Mod || antiMod || pddMods[0];
              msg += `  选中策略: ${msgPackMod ? "messagePack模块" : riskMod ? "riskControlCrawler模块" : n291Mod ? "n(291)模式模块" : antiMod ? "anti_content模块" : "首个PDD模块"}\n`;
              msg += `  目标模块ID: ${bestMod.id}, 匹配关键词: ${bestMod.keywords.join(", ")}\n`;

              // 从 bestMod 的代码中寻找 n(xxx) 模式，提取额外模块ID
              const nCallPattern = /(?:__webpack_require__|[a-zA-Z_$])\s*\(\s*(\d+)\s*\)/g;
              const extraModuleIds = new Set<string>();
              let nMatch;
              while ((nMatch = nCallPattern.exec(bestMod.code)) !== null) {
                extraModuleIds.add(nMatch[1]);
              }
              msg += `  发现 ${extraModuleIds.size} 个依赖模块引用\n`;

              // 提取主模块及其依赖
              const { modules: extracted, missing } = extractModuleWithDeps(wp, bestMod.id);

              // 如果还有其他 PDD 相关模块没被包含，也加进来
              const extractedIds = new Set(extracted.map((m) => String(m.id)));
              const additionalMods: WpModule[] = [];
              for (const pm of pddMods) {
                if (!extractedIds.has(String(pm.id))) {
                  const mod = wp.modules.get(pm.id);
                  if (mod) {
                    additionalMods.push(mod);
                    msg += `  追加关联模块[${pm.id}]: ${pm.keywords.join(",")}\n`;
                  }
                }
              }
              const allExtracted = [...extracted, ...additionalMods];

              if (allExtracted.length > 0) {
                // 生成 PDD 专用 standalone JS（定制化 location 和 UA）
                const standaloneJs = await generatePddStandaloneJs(wp, allExtracted, bestMod.id, page);
                const extractPath = path.join(outDir, `pdd_anti_content_${ts}.js`);
                await fs.mkdir(outDir, { recursive: true });
                await fs.writeFile(extractPath, standaloneJs, "utf-8");

                msg += `  提取模块数: ${allExtracted.length} (主模块 + ${allExtracted.length - 1}个依赖/关联)\n`;
                msg += `  输出: ${extractPath} (${(standaloneJs.length / 1024).toFixed(1)}KB)\n`;
                if (missing.length > 0) msg += `  缺失依赖: ${missing.slice(0, 15).join(", ")}\n`;

                // dump 原始完整 JS
                const fullDumpPath = path.join(outDir, `pdd_full_${ts}.js`);
                await fs.writeFile(fullDumpPath, targetContent, "utf-8");
                msg += `  原始JS: ${fullDumpPath} (${(targetContent.length / 1024).toFixed(1)}KB)\n`;

                // 额外生成 PDD 专用环境文件
                const envPath = path.join(outDir, `pdd_env_${ts}.js`);
                const pddEnv = generatePddEnvCode(page);
                await fs.writeFile(envPath, await pddEnv, "utf-8");
                msg += `  PDD补环境: ${envPath}\n`;

                // Step 5: Hook anti_content 生成过程
                msg += `\n🪝 Step5: Hook anti_content 生成链\n`;
                try {
                  await page.evaluate(() => {
                    const w = window as unknown as Record<string, unknown>;
                    w.__pdd_hook_logs__ = [];
                    const logs = w.__pdd_hook_logs__ as Array<Record<string, unknown>>;

                    // Hook XMLHttpRequest
                    const origOpen = XMLHttpRequest.prototype.open;
                    const origSend = XMLHttpRequest.prototype.send;
                    XMLHttpRequest.prototype.open = function(this: XMLHttpRequest & { __url?: string; __method?: string }, method: string, url: string) {
                      this.__url = url; this.__method = method;
                      return origOpen.apply(this, arguments as unknown as Parameters<typeof origOpen>);
                    };
                    XMLHttpRequest.prototype.send = function(this: XMLHttpRequest & { __url?: string; __method?: string }, body?: Document | XMLHttpRequestBodyInit | null) {
                      if (this.__url && (this.__method === "POST" || String(body || "").includes("anti_content"))) {
                        const bodyStr = typeof body === "string" ? body : "";
                        const antiMatch = bodyStr.match(/anti_content=([^&]+)/);
                        if (antiMatch) {
                          logs.push({ type: "xhr_anti_content", url: this.__url, time: new Date().toISOString(), anti_content_preview: decodeURIComponent(antiMatch[1]).slice(0, 200), fullBodyLength: bodyStr.length });
                        }
                        logs.push({ type: "xhr_post", url: this.__url, time: new Date().toISOString(), bodyPreview: bodyStr.slice(0, 300) });
                      }
                      return origSend.apply(this, arguments as unknown as Parameters<typeof origSend>);
                    };

                    // Hook fetch
                    const origFetch = window.fetch;
                    (window as unknown as Record<string, unknown>).fetch = function(...args: unknown[]) {
                      const req = args[0];
                      const init = args[1] as RequestInit | undefined;
                      if (init?.body && typeof init.body === "string" && init.body.includes("anti_content")) {
                        const antiMatch = init.body.match(/anti_content=([^&]+)/);
                        logs.push({ type: "fetch_anti_content", url: String(req), time: new Date().toISOString(), anti_content_preview: antiMatch ? decodeURIComponent(antiMatch[1]).slice(0, 200) : "N/A" });
                      }
                      return origFetch.apply(window, args as Parameters<typeof fetch>);
                    };

                    // Hook JSON.stringify
                    const origStr = JSON.stringify;
                    JSON.stringify = function(...args: unknown[]) {
                      const val = args[0] as Record<string, unknown>;
                      if (val && typeof val === "object" && ("anti_content" in val || "antiContent" in val || "fingerprint" in val || "verifyFp" in val || "crawlerInfo" in val)) {
                        logs.push({ type: "json_stringify_anti", time: new Date().toISOString(), keys: Object.keys(val).slice(0, 20), preview: origStr(val)?.slice(0, 500) });
                      }
                      return origStr.apply(JSON, args as [unknown]);
                    };

                    // Hook Object.defineProperty（检测反调试和环境检测）
                    const origDefProp = Object.defineProperty;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (Object as any).defineProperty = function(obj: any, prop: PropertyKey, desc: PropertyDescriptor) {
                      if (typeof prop === "string" && (prop.includes("anti") || prop.includes("fingerprint") || prop.includes("crawl"))) {
                        logs.push({ type: "define_property_anti", prop, time: new Date().toISOString() });
                      }
                      return origDefProp.call(Object, obj, prop, desc);
                    };
                  });
                  msg += `  已Hook: XHR.open/send, fetch, JSON.stringify, Object.defineProperty\n`;
                  msg += `  现在请在浏览器中操作页面（翻页/搜索/下拉等）触发请求\n`;
                  msg += `  然后使用: js_reverse eval_context code="JSON.stringify(window.__pdd_hook_logs__)"\n`;
                } catch (hookErr) {
                  msg += `  Hook失败: ${hookErr instanceof Error ? hookErr.message : String(hookErr)}\n`;
                }

                // Summary
                msg += `\n${"━".repeat(50)}\n`;
                msg += `📊 PDD逆向汇总\n`;
                msg += `  关键词命中: ${pddHits.length}处 (${hitsByScript.size}个脚本)\n`;
                msg += `  Webpack模块: ${wp.modules.size}个 (PDD相关: ${pddMods.length}个)\n`;
                msg += `  核心模块: [${bestMod.id}] 关键词: ${bestMod.keywords.join(", ")}\n`;
                msg += `  提取文件: ${extractPath}\n`;
                msg += `  PDD补环境: ${envPath}\n`;
                msg += `\n📋 后续操作:\n`;
                msg += `  1. 运行提取的模块: sandbox_run language=node filePath="${extractPath}"\n`;
                msg += `  2. 如果报错缺环境，检查错误提示补充对应属性\n`;
                msg += `  3. 在dump的完整JS中搜索: regex_tester filePath="${fullDumpPath}" pattern="messagePack|getAntiContent|riskControlCrawler"\n`;
                msg += `  4. 查看Hook日志: js_reverse eval_context code="JSON.stringify(window.__pdd_hook_logs__)"\n`;
                msg += `  5. PDD补环境: ${envPath}\n`;
                msg += `  6. 版本签名前缀识别: 搜索 "0aq"|"0ap"|"0ar"|"0as" 确认版本\n`;

                return { success: true, message: msg, data: { pddHits: pddHits.length, modules: wp.modules.size, pddModules: pddMods.map((m) => m.id), extractPath, envPath } };
              }
            } else {
              msg += `  未找到PDD加密相关的Webpack模块\n`;
              msg += `  建议: 使用 cdp_scripts 获取动态注入的脚本\n`;
            }
          } else {
            msg += `  未能获取到目标脚本内容\n`;
          }

          // 如果到这里还没返回，说明没提取成功
          msg += `\n${"━".repeat(50)}\n`;
          msg += `⚠ 未能完全定位加密模块。建议:\n`;
          msg += `  1. js_reverse cdp_scripts — 获取CDP层动态脚本\n`;
          msg += `  2. js_reverse auto_reverse targetKeyword="anti_content" — 全量自动逆向\n`;
          msg += `  3. network_capture start → 操作页面 → network_capture list filterMethod=POST — 先抓包定位接口\n`;

          return { success: true, message: msg, data: { pddHits: pddHits.length, hitScripts: Array.from(hitsByScript.keys()) } };
        }

        // ==================== 滑块验证码逆向 ====================

        case "slider_detect": {
          const page = await getOrRecoverPage(sessionId);
          if (!page) return { success: false, message: `浏览器会话"${sessionId}"不存在。${JSON.stringify(getSessionStatus(sessionId))}` };

          let msg = `🎯 滑块缺口识别\n${"━".repeat(50)}\n`;

          // Step 1: 自动检测页面上的滑块元素
          const detected = await page.evaluate((selectors: { slider?: string; bg?: string; gap?: string }) => {
            const result: {
              sliders: Array<{ selector: string; tag: string; rect: { x: number; y: number; w: number; h: number } }>;
              canvases: Array<{ selector: string; id: string; cls: string; rect: { x: number; y: number; w: number; h: number } }>;
              captchaImages: Array<{ selector: string; src: string; rect: { x: number; y: number; w: number; h: number } }>;
              iframes: Array<{ src: string }>;
            } = { sliders: [], canvases: [], captchaImages: [], iframes: [] };

            const sliderSelectors = [
              selectors.slider,
              ".geetest_slider_button", ".geetest_btn", ".geetest_slider",
              ".tc-fg-item", ".tc-slider-normal",
              ".yidun_slider", ".yidun_slider--hover",
              ".dx-captcha-slider-btn", ".dx_captcha_slider",
              ".slide-verify-slider", ".slider-btn",
              "[class*='slider']", "[class*='Slider']",
              "[class*='drag']", "[class*='Drag']",
              "div[style*='cursor: pointer'][style*='position: absolute']",
            ].filter(Boolean) as string[];

            for (const sel of sliderSelectors) {
              try {
                const els = document.querySelectorAll(sel);
                els.forEach((el, i) => {
                  const r = el.getBoundingClientRect();
                  if (r.width > 10 && r.width < 200 && r.height > 10 && r.height < 200) {
                    result.sliders.push({
                      selector: sel + (els.length > 1 ? `:nth-child(${i + 1})` : ""),
                      tag: el.tagName.toLowerCase(),
                      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                    });
                  }
                });
              } catch { /* invalid selector */ }
            }

            const canvasSelectors = [
              selectors.bg, selectors.gap,
              ".geetest_canvas_bg", ".geetest_canvas_slice", ".geetest_canvas_fullbg",
              ".tc-bg-img", ".yidun_bg-img", ".yidun_jigsaw",
              "canvas[class*='captcha']", "canvas[class*='slider']", "canvas[class*='bg']",
              "canvas",
            ].filter(Boolean) as string[];

            for (const sel of canvasSelectors) {
              try {
                const els = document.querySelectorAll(sel);
                els.forEach((el) => {
                  const r = el.getBoundingClientRect();
                  if (r.width > 50 && r.height > 30) {
                    result.canvases.push({
                      selector: sel,
                      id: (el as HTMLElement).id || "",
                      cls: (el as HTMLElement).className || "",
                      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                    });
                  }
                });
              } catch { /* skip */ }
            }

            const imgSelectors = [
              "img[class*='captcha']", "img[class*='slider']", "img[class*='bg']",
              "img[class*='puzzle']", "img[class*='jigsaw']", "img[class*='verify']",
              ".geetest_item_img img", ".geetest_canvas_bg img",
              "img[src*='captcha']", "img[src*='slider']", "img[src*='verify']",
            ];
            for (const sel of imgSelectors) {
              try {
                const els = document.querySelectorAll(sel);
                els.forEach((el) => {
                  const img = el as HTMLImageElement;
                  const r = img.getBoundingClientRect();
                  if (r.width > 50 && r.height > 30) {
                    result.captchaImages.push({
                      selector: sel,
                      src: img.src?.slice(0, 200) || "",
                      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                    });
                  }
                });
              } catch { /* skip */ }
            }

            document.querySelectorAll("iframe").forEach((f) => {
              if (f.src && (f.src.includes("captcha") || f.src.includes("verify") || f.src.includes("geetest") || f.src.includes("slider"))) {
                result.iframes.push({ src: f.src });
              }
            });

            return result;
          }, { slider: sliderSelector, bg: bgSelector, gap: gapSelector });

          msg += `📋 检测到的滑块组件:\n`;
          msg += `  滑块按钮: ${detected.sliders.length}个\n`;
          for (const s of detected.sliders.slice(0, 5)) {
            msg += `    ${s.selector} (${s.tag}) — 位置: (${s.rect.x},${s.rect.y}) 尺寸: ${s.rect.w}x${s.rect.h}\n`;
          }
          msg += `  Canvas: ${detected.canvases.length}个\n`;
          for (const c of detected.canvases.slice(0, 5)) {
            msg += `    ${c.selector} id="${c.id}" class="${c.cls.slice(0, 50)}" — ${c.rect.w}x${c.rect.h}\n`;
          }
          msg += `  验证码图片: ${detected.captchaImages.length}个\n`;
          for (const img of detected.captchaImages.slice(0, 5)) {
            msg += `    ${img.selector} — ${img.rect.w}x${img.rect.h} src=${img.src.slice(0, 80)}...\n`;
          }
          if (detected.iframes.length > 0) {
            msg += `  验证码iframe: ${detected.iframes.length}个\n`;
            for (const f of detected.iframes) msg += `    ${f.src.slice(0, 100)}\n`;
          }

          // Step 2: 尝试通过 Canvas 像素对比定位缺口
          let gapX = -1;
          let gapY = -1;
          let canvasWidth = 0;

          if (detected.canvases.length >= 1) {
            msg += `\n🔍 Step2: Canvas 像素对比定位缺口\n`;

            const bgSel = bgSelector || detected.canvases[0]?.selector || "canvas";
            const pixelResult = await page.evaluate((sel: string) => {
              const canvas = document.querySelector(sel);
              if (!canvas) return { error: "找不到Canvas元素" };
              const rect = canvas.getBoundingClientRect();

              let ctx: CanvasRenderingContext2D | null = null;
              let w = 0, h = 0;

              if (canvas instanceof HTMLCanvasElement) {
                ctx = canvas.getContext("2d");
                w = canvas.width; h = canvas.height;
              } else if (canvas instanceof HTMLImageElement) {
                const c = document.createElement("canvas");
                c.width = canvas.naturalWidth || rect.width;
                c.height = canvas.naturalHeight || rect.height;
                w = c.width; h = c.height;
                ctx = c.getContext("2d");
                if (ctx) ctx.drawImage(canvas, 0, 0);
              }

              if (!ctx || w === 0 || h === 0) return { error: "无法获取Canvas上下文" };

              const imageData = ctx.getImageData(0, 0, w, h);
              const data = imageData.data;

              // 使用边缘检测找缺口：找到连续的深色垂直线段（缺口边缘）
              const edgeScores: number[] = new Array(w).fill(0);

              for (let x = 10; x < w - 10; x++) {
                let edgeCount = 0;
                for (let y = Math.floor(h * 0.15); y < Math.floor(h * 0.85); y++) {
                  const idx = (y * w + x) * 4;
                  const idxPrev = (y * w + x - 1) * 4;

                  const rDiff = Math.abs(data[idx] - data[idxPrev]);
                  const gDiff = Math.abs(data[idx + 1] - data[idxPrev + 1]);
                  const bDiff = Math.abs(data[idx + 2] - data[idxPrev + 2]);
                  const totalDiff = rDiff + gDiff + bDiff;

                  if (totalDiff > 80) edgeCount++;
                }
                edgeScores[x] = edgeCount;
              }

              // 找到最显著的垂直边缘（通常是缺口的左边缘）
              let maxScore = 0;
              let maxX = -1;
              const scanStart = Math.floor(w * 0.2);
              const scanEnd = Math.floor(w * 0.85);

              for (let x = scanStart; x < scanEnd; x++) {
                if (edgeScores[x] > maxScore) {
                  maxScore = edgeScores[x];
                  maxX = x;
                }
              }

              // 找缺口的Y中心
              let gapYCenter = -1;
              if (maxX > 0) {
                let minBright = 999;
                for (let y = Math.floor(h * 0.15); y < Math.floor(h * 0.85); y++) {
                  const idx = (y * w + maxX + 5) * 4;
                  const bright = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
                  if (bright < minBright) {
                    minBright = bright;
                    gapYCenter = y;
                  }
                }
              }

              // 二次验证：检查该列附近的像素亮度差异（缺口区域通常亮度偏低或有阴影）
              let confidence = 0;
              if (maxX > 0 && maxScore > 0) {
                const maxPossible = Math.floor(h * 0.7);
                confidence = Math.min(100, Math.round((maxScore / maxPossible) * 100));

                // 检查是否有对称的右边缘
                for (let dx = 30; dx < 80; dx++) {
                  if (maxX + dx < w && edgeScores[maxX + dx] > maxScore * 0.5) {
                    confidence = Math.min(100, confidence + 15);
                    break;
                  }
                }
              }

              return {
                gapX: maxX,
                gapY: gapYCenter,
                canvasWidth: w,
                canvasHeight: h,
                displayWidth: Math.round(rect.width),
                displayHeight: Math.round(rect.height),
                edgeScore: maxScore,
                confidence,
                scaleX: rect.width / w,
              };
            }, bgSel);

            if ("error" in pixelResult) {
              msg += `  ⚠ ${pixelResult.error}\n`;
            } else {
              gapX = pixelResult.gapX;
              gapY = pixelResult.gapY;
              canvasWidth = pixelResult.canvasWidth;
              const scaledGapX = Math.round(gapX * pixelResult.scaleX);

              msg += `  Canvas尺寸: ${pixelResult.canvasWidth}x${pixelResult.canvasHeight} (显示: ${pixelResult.displayWidth}x${pixelResult.displayHeight})\n`;
              msg += `  缩放比: ${pixelResult.scaleX.toFixed(3)}\n`;
              msg += `  缺口位置: X=${gapX}px (显示X=${scaledGapX}px), Y≈${gapY}px\n`;
              msg += `  边缘强度: ${pixelResult.edgeScore}\n`;
              msg += `  置信度: ${pixelResult.confidence}%\n`;
              msg += `  需要滑动距离: ≈${scaledGapX}px (显示坐标)\n`;

              if (pixelResult.confidence < 30) {
                msg += `\n  ⚠ 置信度较低，可能原因:\n`;
                msg += `    - Canvas中没有可见的缺口（可能使用了分离的背景图+拼图块）\n`;
                msg += `    - 缺口被CSS隐藏或延迟绘制\n`;
                msg += `    - 使用img标签而非canvas\n`;
                msg += `  建议: 手动检查页面，或尝试用 bgSelector/gapSelector 指定元素\n`;
              }
            }
          }

          // Step 3: 尝试通过双图对比定位缺口（完整背景图 vs 缺口背景图）
          if (gapX < 0 && (detected.canvases.length >= 2 || detected.captchaImages.length >= 2)) {
            msg += `\n🔍 Step3: 双图像素差分定位缺口\n`;

            const result = await page.evaluate((selectors: { canvases: typeof detected.canvases; images: typeof detected.captchaImages }) => {
              function getPixels(el: Element): { data: Uint8ClampedArray; w: number; h: number } | null {
                const c = document.createElement("canvas");
                let w = 0, h = 0;
                const ctx = c.getContext("2d");
                if (!ctx) return null;

                if (el instanceof HTMLCanvasElement) {
                  w = el.width; h = el.height;
                  c.width = w; c.height = h;
                  ctx.drawImage(el, 0, 0);
                } else if (el instanceof HTMLImageElement) {
                  w = el.naturalWidth || el.width;
                  h = el.naturalHeight || el.height;
                  c.width = w; c.height = h;
                  ctx.drawImage(el, 0, 0);
                } else return null;

                if (w === 0 || h === 0) return null;
                return { data: ctx.getImageData(0, 0, w, h).data, w, h };
              }

              const elements: Element[] = [];
              for (const cv of selectors.canvases) {
                const el = document.querySelector(cv.selector);
                if (el) elements.push(el);
              }
              for (const im of selectors.images) {
                const el = document.querySelector(im.selector);
                if (el) elements.push(el);
              }

              if (elements.length < 2) return { error: "需要至少2个图像元素进行差分" };

              const p1 = getPixels(elements[0]);
              const p2 = getPixels(elements[1]);
              if (!p1 || !p2) return { error: "无法获取像素数据" };
              if (p1.w !== p2.w || p1.h !== p2.h) return { error: `尺寸不匹配: ${p1.w}x${p1.h} vs ${p2.w}x${p2.h}` };

              const w = p1.w, h = p1.h;
              const diffCols: number[] = new Array(w).fill(0);

              for (let x = 0; x < w; x++) {
                for (let y = 0; y < h; y++) {
                  const idx = (y * w + x) * 4;
                  const diff = Math.abs(p1.data[idx] - p2.data[idx]) +
                    Math.abs(p1.data[idx + 1] - p2.data[idx + 1]) +
                    Math.abs(p1.data[idx + 2] - p2.data[idx + 2]);
                  if (diff > 70) diffCols[x]++;
                }
              }

              let maxDiff = 0, gapStart = -1, gapEnd = -1;
              let inGap = false;
              for (let x = 0; x < w; x++) {
                if (diffCols[x] > h * 0.1) {
                  if (!inGap) { gapStart = x; inGap = true; }
                  gapEnd = x;
                  if (diffCols[x] > maxDiff) maxDiff = diffCols[x];
                } else if (inGap && x - gapEnd > 10) {
                  break;
                }
              }

              return {
                gapX: gapStart,
                gapEndX: gapEnd,
                gapWidth: gapEnd - gapStart,
                canvasWidth: w,
                maxDiff,
                confidence: Math.min(100, Math.round((maxDiff / h) * 100)),
              };
            }, { canvases: detected.canvases.slice(0, 3), images: detected.captchaImages.slice(0, 3) });

            if ("error" in result) {
              msg += `  ⚠ ${result.error}\n`;
            } else if (result.gapX >= 0) {
              gapX = result.gapX;
              canvasWidth = result.canvasWidth;
              msg += `  差分缺口: X=${result.gapX}~${result.gapEndX} (宽${result.gapWidth}px)\n`;
              msg += `  置信度: ${result.confidence}%\n`;
            }
          }

          // Step 4: 截图保存
          if (savePath) {
            const outPath = path.resolve(savePath);
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await page.screenshot({ path: outPath, fullPage: false });
            msg += `\n📸 截图已保存: ${outPath}\n`;
          }

          msg += `\n${"━".repeat(50)}\n`;
          if (gapX >= 0) {
            msg += `✅ 缺口X坐标: ${gapX}px (Canvas坐标系)\n`;
            msg += `\n📋 后续操作:\n`;
            msg += `  1. 生成轨迹: js_reverse slider_track sliderDistance=${gapX}\n`;
            msg += `  2. 一键破解: js_reverse slider_crack\n`;
          } else {
            msg += `⚠ 未能自动定位缺口。建议:\n`;
            msg += `  1. 手动指定选择器: slider_detect bgSelector=".xxx" gapSelector=".yyy"\n`;
            msg += `  2. 截图后人工确认缺口位置: slider_detect savePath="C:/captcha.png"\n`;
            msg += `  3. 页面可能使用了iframe嵌入验证码，需先切入iframe\n`;
          }

          return { success: true, message: msg, data: { gapX, gapY, canvasWidth, sliders: detected.sliders, canvases: detected.canvases } };
        }

        case "slider_track": {
          const distance = sliderDistance || 200;
          let msg = `🎯 人类化滑动轨迹生成\n${"━".repeat(50)}\n`;
          msg += `滑动距离: ${distance}px\n\n`;

          // 贝塞尔曲线 + 加减速 + 随机抖动 + 回弹的轨迹生成
          function generateHumanTrack(dist: number): Array<{ x: number; y: number; t: number }> {
            const track: Array<{ x: number; y: number; t: number }> = [];
            const totalTime = 600 + Math.random() * 800;

            // 控制点，模拟人类不完美的直线运动
            const cp1x = dist * (0.6 + Math.random() * 0.15);
            const cp1y = -2 + Math.random() * 8;
            const cp2x = dist * (0.85 + Math.random() * 0.1);
            const cp2y = -1 + Math.random() * 4;

            // 过冲距离（人类常常会滑过头再拉回来）
            const overshoot = 3 + Math.random() * 8;
            const overshootDist = dist + overshoot;

            const steps = 40 + Math.floor(Math.random() * 30);
            let t = 0;

            // 阶段1：主滑动（贝塞尔曲线，先快后慢）
            for (let i = 0; i <= steps; i++) {
              const progress = i / steps;

              // 缓动函数：先加速，到70%处开始减速
              let easedProgress: number;
              if (progress < 0.3) {
                easedProgress = progress * progress * 3.5;
              } else if (progress < 0.7) {
                easedProgress = 0.315 + (progress - 0.3) * 1.6;
              } else {
                const remain = 1 - progress;
                easedProgress = 1 - remain * remain * 2.5;
              }

              // 三次贝塞尔曲线插值
              const u = easedProgress;
              const u2 = u * u;
              const u3 = u2 * u;
              const inv = 1 - u;
              const inv2 = inv * inv;
              const inv3 = inv2 * inv;

              const x = inv3 * 0 + 3 * inv2 * u * cp1x + 3 * inv * u2 * cp2x + u3 * overshootDist;
              const y = inv3 * 0 + 3 * inv2 * u * cp1y + 3 * inv * u2 * cp2y + u3 * 0;

              // 时间间隔：非均匀分布
              const dt = (totalTime / steps) * (0.5 + Math.random());
              t += dt;

              // 添加微小抖动
              const jitterX = (Math.random() - 0.5) * 1.5;
              const jitterY = (Math.random() - 0.5) * 2;

              track.push({
                x: Math.round((x + jitterX) * 100) / 100,
                y: Math.round((y + jitterY) * 100) / 100,
                t: Math.round(t),
              });
            }

            // 阶段2：回弹（从过冲位置拉回到目标位置）
            const bounceSteps = 5 + Math.floor(Math.random() * 5);
            const lastPos = track[track.length - 1];
            for (let i = 1; i <= bounceSteps; i++) {
              const progress = i / bounceSteps;
              const eased = 1 - Math.pow(1 - progress, 2);
              const x = lastPos.x - overshoot * eased;
              const y = lastPos.y + (Math.random() - 0.5) * 1;
              t += 20 + Math.random() * 40;
              track.push({
                x: Math.round(x * 100) / 100,
                y: Math.round(y * 100) / 100,
                t: Math.round(t),
              });
            }

            // 阶段3：精确微调（在目标位置附近小幅震荡）
            const adjustSteps = 2 + Math.floor(Math.random() * 3);
            for (let i = 0; i < adjustSteps; i++) {
              t += 30 + Math.random() * 60;
              track.push({
                x: Math.round((dist + (Math.random() - 0.5) * 1.5) * 100) / 100,
                y: Math.round((Math.random() - 0.5) * 1) * 100 / 100,
                t: Math.round(t),
              });
            }

            // 确保最后一个点精确在目标位置
            t += 10 + Math.random() * 20;
            track.push({ x: dist, y: 0, t: Math.round(t) });

            return track;
          }

          const track = generateHumanTrack(distance);

          msg += `📊 轨迹统计:\n`;
          msg += `  总步数: ${track.length}\n`;
          msg += `  总耗时: ${track[track.length - 1].t}ms\n`;
          msg += `  起点: (${track[0].x}, ${track[0].y})\n`;
          msg += `  终点: (${track[track.length - 1].x}, ${track[track.length - 1].y})\n`;

          const maxX = Math.max(...track.map((p) => p.x));
          const maxY = Math.max(...track.map((p) => Math.abs(p.y)));
          msg += `  最远X: ${maxX.toFixed(1)}px (过冲: ${(maxX - distance).toFixed(1)}px)\n`;
          msg += `  Y方向最大偏移: ${maxY.toFixed(1)}px\n`;

          // 速度分析
          const speeds: number[] = [];
          for (let i = 1; i < track.length; i++) {
            const dx = track[i].x - track[i - 1].x;
            const dt = track[i].t - track[i - 1].t;
            if (dt > 0) speeds.push(Math.abs(dx) / dt * 1000);
          }
          const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
          const maxSpeed = Math.max(...speeds);
          msg += `  平均速度: ${avgSpeed.toFixed(1)}px/s\n`;
          msg += `  最大速度: ${maxSpeed.toFixed(1)}px/s\n`;

          msg += `\n📋 轨迹数据 (前10个点):\n`;
          for (const p of track.slice(0, 10)) {
            msg += `  t=${String(p.t).padStart(5)}ms  x=${String(p.x.toFixed(1)).padStart(7)}  y=${String(p.y.toFixed(1)).padStart(6)}\n`;
          }
          if (track.length > 10) msg += `  ... (共${track.length}个点)\n`;

          if (savePath) {
            const outPath = path.resolve(savePath);
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, JSON.stringify(track, null, 2), "utf-8");
            msg += `\n💾 轨迹数据已保存: ${outPath}\n`;
          }

          msg += `\n📋 使用方式:\n`;
          msg += `  1. 一键破解: js_reverse slider_crack sliderDistance=${distance}\n`;
          msg += `  2. 在浏览器中执行轨迹 (eval_context):\n`;
          msg += `     js_reverse eval_context code="...移动轨迹代码..."\n`;

          return { success: true, message: msg, data: { distance, track, totalTime: track[track.length - 1].t, steps: track.length } };
        }

        case "slider_crack": {
          const page = await getOrRecoverPage(sessionId);
          if (!page) return { success: false, message: `浏览器会话"${sessionId}"不存在。${JSON.stringify(getSessionStatus(sessionId))}` };

          let msg = `🚀 一键滑块破解\n${"━".repeat(50)}\n`;

          // Phase 1: 自动检测滑块元素
          msg += `\n🔍 Phase1: 检测滑块元素\n`;

          const elements = await page.evaluate((userSel: string | undefined) => {
            const sliderSelectors = [
              userSel,
              ".geetest_slider_button", ".geetest_btn",
              ".tc-fg-item", ".tc-slider-normal",
              ".yidun_slider", ".yidun_slider--hover",
              ".dx-captcha-slider-btn",
              ".slide-verify-slider", ".slider-btn",
              "[class*='slider-button']", "[class*='slider_button']",
              "[class*='slider-btn']", "[class*='sliderbtn']",
              "[class*='slide-btn']",
              "[class*='drag-btn']", "[class*='drag_btn']",
            ].filter(Boolean) as string[];

            let sliderEl: { selector: string; x: number; y: number; w: number; h: number } | null = null;
            for (const sel of sliderSelectors) {
              try {
                const el = document.querySelector(sel);
                if (el) {
                  const r = el.getBoundingClientRect();
                  if (r.width > 10 && r.height > 10 && r.width < 200 && r.height < 200) {
                    sliderEl = { selector: sel, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
                    break;
                  }
                }
              } catch { /* skip */ }
            }

            // 找滑动轨道（确定最大滑动距离）
            const trackSelectors = [
              ".geetest_slider", ".geetest_slider_track",
              ".tc-slider", ".tc-slider-track",
              ".yidun_slider__track", ".yidun_control",
              ".slide-verify-slider", "[class*='slider-track']", "[class*='slider_track']",
              "[class*='slide-track']",
            ];
            let trackWidth = 260;
            for (const sel of trackSelectors) {
              try {
                const el = document.querySelector(sel);
                if (el) {
                  const r = el.getBoundingClientRect();
                  if (r.width > 100) { trackWidth = r.width; break; }
                }
              } catch { /* skip */ }
            }

            // 找Canvas缺口
            const canvasSelectors = [
              ".geetest_canvas_bg", ".geetest_canvas_slice",
              ".tc-bg-img", ".yidun_bg-img",
              "canvas[class*='captcha']", "canvas[class*='bg']",
              "canvas",
            ];
            const bgCanvases: Array<{ selector: string; w: number; h: number; displayW: number }> = [];
            for (const sel of canvasSelectors) {
              try {
                const els = document.querySelectorAll(sel);
                els.forEach((el) => {
                  const r = el.getBoundingClientRect();
                  if (r.width > 100 && r.height > 30) {
                    const cv = el as HTMLCanvasElement;
                    bgCanvases.push({ selector: sel, w: cv.width || r.width, h: cv.height || r.height, displayW: r.width });
                  }
                });
              } catch { /* skip */ }
            }

            return { sliderEl, trackWidth, bgCanvases };
          }, sliderSelector);

          if (!elements.sliderEl) {
            msg += `  ⚠ 未检测到滑块按钮\n`;
            msg += `  建议: 使用 sliderSelector 参数指定滑块选择器\n`;
            msg += `  示例: js_reverse slider_crack sliderSelector=".geetest_slider_button"\n`;
            return { success: false, message: msg };
          }

          msg += `  滑块: ${elements.sliderEl.selector} at (${Math.round(elements.sliderEl.x)}, ${Math.round(elements.sliderEl.y)})\n`;
          msg += `  轨道宽度: ${elements.trackWidth}px\n`;
          msg += `  背景Canvas: ${elements.bgCanvases.length}个\n`;

          // Phase 2: 检测缺口位置
          msg += `\n🔍 Phase2: 缺口位置检测\n`;

          let targetDistance = sliderDistance || 0;

          if (!targetDistance && elements.bgCanvases.length > 0) {
            const bgSel = bgSelector || elements.bgCanvases[0].selector;

            const gapResult = await page.evaluate((sel: string) => {
              const canvas = document.querySelector(sel);
              if (!canvas) return { gapX: -1, confidence: 0, canvasWidth: 0, displayWidth: 0 };

              const rect = canvas.getBoundingClientRect();
              let ctx: CanvasRenderingContext2D | null = null;
              let w = 0, h = 0;

              if (canvas instanceof HTMLCanvasElement) {
                ctx = canvas.getContext("2d");
                w = canvas.width; h = canvas.height;
              } else if (canvas instanceof HTMLImageElement) {
                const c = document.createElement("canvas");
                c.width = canvas.naturalWidth || rect.width;
                c.height = canvas.naturalHeight || rect.height;
                w = c.width; h = c.height;
                ctx = c.getContext("2d");
                if (ctx) ctx.drawImage(canvas, 0, 0);
              }

              if (!ctx || w === 0 || h === 0) return { gapX: -1, confidence: 0, canvasWidth: w, displayWidth: rect.width };

              const imgData = ctx.getImageData(0, 0, w, h).data;
              const edgeScores: number[] = new Array(w).fill(0);

              for (let x = 10; x < w - 10; x++) {
                for (let y = Math.floor(h * 0.15); y < Math.floor(h * 0.85); y++) {
                  const idx = (y * w + x) * 4;
                  const idxPrev = (y * w + x - 1) * 4;
                  const diff = Math.abs(imgData[idx] - imgData[idxPrev]) +
                    Math.abs(imgData[idx + 1] - imgData[idxPrev + 1]) +
                    Math.abs(imgData[idx + 2] - imgData[idxPrev + 2]);
                  if (diff > 80) edgeScores[x]++;
                }
              }

              let maxScore = 0, gapX = -1;
              for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.85); x++) {
                if (edgeScores[x] > maxScore) { maxScore = edgeScores[x]; gapX = x; }
              }

              const maxPossible = Math.floor(h * 0.7);
              const confidence = maxScore > 0 ? Math.min(100, Math.round((maxScore / maxPossible) * 100)) : 0;
              const scaleX = rect.width / w;

              return { gapX: Math.round(gapX * scaleX), confidence, canvasWidth: w, displayWidth: Math.round(rect.width) };
            }, bgSel);

            if (gapResult.gapX > 0 && gapResult.confidence >= 20) {
              targetDistance = gapResult.gapX;
              msg += `  缺口X: ${gapResult.gapX}px (置信度: ${gapResult.confidence}%)\n`;
            } else {
              msg += `  ⚠ 自动检测未能确定缺口位置 (置信度: ${gapResult.confidence}%)\n`;
            }
          }

          if (!targetDistance) {
            targetDistance = Math.round(elements.trackWidth * (0.3 + Math.random() * 0.3));
            msg += `  使用估算距离: ${targetDistance}px\n`;
          }

          msg += `  目标滑动距离: ${targetDistance}px\n`;

          // Phase 3: 生成轨迹并执行滑动
          msg += `\n🎯 Phase3: 执行滑动 (距离: ${targetDistance}px)\n`;

          const slideResult = await page.evaluate(async (params: {
            sliderX: number; sliderY: number; distance: number;
          }) => {
            const { sliderX, sliderY, distance } = params;
            const logs: string[] = [];

            // 贝塞尔轨迹生成
            function genTrack(dist: number): Array<{ dx: number; dy: number; dt: number }> {
              const points: Array<{ dx: number; dy: number; dt: number }> = [];
              const totalTime = 500 + Math.random() * 700;
              const overshoot = 2 + Math.random() * 6;
              const steps = 35 + Math.floor(Math.random() * 25);

              const cp1x = dist * (0.55 + Math.random() * 0.15);
              const cp1y = -2 + Math.random() * 6;
              const cp2x = dist * (0.82 + Math.random() * 0.12);
              const cp2y = -1 + Math.random() * 3;

              let prevX = 0, prevY = 0, t = 0;

              for (let i = 0; i <= steps; i++) {
                const p = i / steps;
                let ep: number;
                if (p < 0.3) ep = p * p * 3.5;
                else if (p < 0.7) ep = 0.315 + (p - 0.3) * 1.6;
                else { const r = 1 - p; ep = 1 - r * r * 2.5; }

                const u = ep, u2 = u * u, u3 = u2 * u;
                const iv = 1 - u, iv2 = iv * iv, iv3 = iv2 * iv;
                const x = iv3 * 0 + 3 * iv2 * u * cp1x + 3 * iv * u2 * cp2x + u3 * (dist + overshoot);
                const y = iv3 * 0 + 3 * iv2 * u * cp1y + 3 * iv * u2 * cp2y + u3 * 0;

                const dt = (totalTime / steps) * (0.5 + Math.random());
                t += dt;

                const dx = x - prevX + (Math.random() - 0.5) * 1.2;
                const dy = y - prevY + (Math.random() - 0.5) * 1.5;
                prevX = x; prevY = y;

                points.push({ dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10, dt: Math.round(dt) });
              }

              // 回弹
              const bounceSteps = 4 + Math.floor(Math.random() * 4);
              for (let i = 1; i <= bounceSteps; i++) {
                const p = i / bounceSteps;
                const dx = -(overshoot / bounceSteps) + (Math.random() - 0.5) * 0.5;
                const dy = (Math.random() - 0.5) * 0.8;
                points.push({ dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10, dt: 20 + Math.round(Math.random() * 30) });
              }

              return points;
            }

            const track = genTrack(distance);
            logs.push(`轨迹: ${track.length}步, 总时间≈${track.reduce((s, p) => s + p.dt, 0)}ms`);

            // 模拟 mousedown
            const downEvent = new MouseEvent("mousedown", {
              clientX: sliderX, clientY: sliderY, bubbles: true, cancelable: true, button: 0,
            });
            const sliderEl = document.elementFromPoint(sliderX, sliderY);
            if (!sliderEl) return { success: false, logs: ["找不到滑块元素"], finalX: 0 };

            sliderEl.dispatchEvent(downEvent);
            logs.push("mousedown dispatched");

            // 逐步 mousemove
            let curX = sliderX, curY = sliderY;
            for (const step of track) {
              curX += step.dx;
              curY += step.dy;
              await new Promise((r) => setTimeout(r, step.dt));
              const moveEvent = new MouseEvent("mousemove", {
                clientX: curX, clientY: curY, bubbles: true, cancelable: true,
              });
              document.dispatchEvent(moveEvent);
            }

            logs.push(`滑动完成, 最终位置: (${Math.round(curX)}, ${Math.round(curY)})`);

            // mouseup
            await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
            const upEvent = new MouseEvent("mouseup", {
              clientX: curX, clientY: curY, bubbles: true, cancelable: true, button: 0,
            });
            document.dispatchEvent(upEvent);
            sliderEl.dispatchEvent(upEvent);
            logs.push("mouseup dispatched");

            return { success: true, logs, finalX: Math.round(curX - sliderX) };
          }, {
            sliderX: elements.sliderEl.x,
            sliderY: elements.sliderEl.y,
            distance: targetDistance,
          });

          for (const log of slideResult.logs) msg += `  ${log}\n`;

          // Phase 4: 等待并检查结果
          msg += `\n⏳ Phase4: 等待验证结果...\n`;
          await new Promise((r) => setTimeout(r, 2000));

          const verifyResult = await page.evaluate(() => {
            // 检测常见的成功/失败标志
            const successSelectors = [
              ".geetest_success", ".geetest_result_tip.geetest_success",
              ".tc-captcha-verify-success", ".yidun--success",
              "[class*='success']", "[class*='Success']",
            ];
            const failSelectors = [
              ".geetest_fail", ".geetest_result_tip.geetest_fail",
              ".tc-captcha-verify-fail", ".yidun--fail",
              "[class*='fail']", "[class*='error']", "[class*='retry']",
            ];

            for (const sel of successSelectors) {
              try {
                const el = document.querySelector(sel);
                if (el) {
                  const r = el.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) return { status: "success", selector: sel };
                }
              } catch { /* skip */ }
            }

            for (const sel of failSelectors) {
              try {
                const el = document.querySelector(sel);
                if (el) {
                  const r = el.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) return { status: "fail", selector: sel };
                }
              } catch { /* skip */ }
            }

            // 检查验证码区域是否消失（通常成功后验证码会隐藏）
            const captchaSelectors = [
              ".geetest_popup_wrap", ".geetest_panel", ".tc-captcha-wrap",
              ".yidun_panel", "[class*='captcha-panel']", "[class*='captcha-wrap']",
            ];
            for (const sel of captchaSelectors) {
              try {
                const el = document.querySelector(sel);
                if (el) {
                  const style = window.getComputedStyle(el);
                  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
                    return { status: "success", selector: sel + " (hidden)" };
                  }
                }
              } catch { /* skip */ }
            }

            return { status: "unknown", selector: "" };
          });

          msg += `  验证结果: ${verifyResult.status}`;
          if (verifyResult.selector) msg += ` (${verifyResult.selector})`;
          msg += `\n`;

          if (verifyResult.status === "fail") {
            msg += `\n⚠ 滑块验证失败，可能原因:\n`;
            msg += `  1. 缺口检测不够精确，尝试手动指定 sliderDistance\n`;
            msg += `  2. 轨迹被检测为机器行为\n`;
            msg += `  3. 需要等待验证码刷新后重试\n`;
            msg += `  建议: js_reverse slider_crack sliderDistance=${targetDistance + Math.round(Math.random() * 10 - 5)}\n`;
          } else if (verifyResult.status === "success") {
            msg += `\n✅ 滑块验证成功！\n`;
          } else {
            msg += `\n⚠ 无法确定验证结果，请手动检查页面状态\n`;
          }

          msg += `\n${"━".repeat(50)}\n`;
          msg += `📊 执行汇总:\n`;
          msg += `  滑动距离: ${slideResult.finalX}px (目标: ${targetDistance}px)\n`;
          msg += `  验证结果: ${verifyResult.status}\n`;

          return {
            success: verifyResult.status !== "fail",
            message: msg,
            data: { distance: targetDistance, finalX: slideResult.finalX, verifyStatus: verifyResult.status },
          };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `JS逆向异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
