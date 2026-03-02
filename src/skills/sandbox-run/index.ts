import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";
import {
  browserOpen,
  browserScreenshot,
  browserScript,
  browserClick,
  browserWait,
  browserPressKey,
  browserGetConsoleErrors,
  browserClose,
} from "@/lib/puppeteer-render";

const SESSION_ID = "sandbox";
const SCREENSHOT_DIR = path.join(process.env.USERPROFILE || process.env.HOME || ".", ".xiniu", "screenshots");

async function saveScreenshot(base64: string, label: string, step: number): Promise<string> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const ts = Date.now();
  const safeName = label.replace(/[^a-zA-Z0-9\u4e00-\u9fff-_]/g, "_").slice(0, 30);
  const filename = `step${step}_${safeName}_${ts}.png`;
  const filePath = path.join(SCREENSHOT_DIR, filename);
  await fs.writeFile(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

const stepSchema = z.object({
  action: z.enum(["wait", "click", "key", "js", "screenshot", "check", "autoplay"]).describe(
    "操作: wait=等待ms, click=CSS选择器, key=键名(非游戏场景用), js=执行JS, screenshot=截图保存PNG, check=健康检查(canvas/DOM/变量), autoplay=游戏自动玩N秒(游戏类必须用此而非key)"
  ),
  value: z.string().describe(
    "参数: wait→ms数, click→选择器, key→键名(如ArrowRight*3), js→代码, screenshot→描述, check→要检查的JS表达式(如score,lives), autoplay→秒数(如60表示玩60秒)"
  ),
});

export const sandboxRunSkill: SkillDefinition = {
  name: "sandbox_run",
  displayName: "沙盒运行测试",
  description:
    "在浏览器中打开HTML文件执行测试。⚠️ 游戏类测试必须用autoplay(不要用key,盲目按键会0分即死)。autoplay注入AI寻路脚本自动玩游戏N秒,实时读取状态决策方向,自动重开,汇报分数统计。check自动检查canvas/DOM/变量。screenshot截图保存本地PNG。",
  icon: "Monitor",
  category: "dev",
  parameters: z.object({
    filePath: z.string().describe("HTML文件路径或URL"),
    steps: z.array(stepSchema).describe("测试操作序列"),
  }),
  execute: async (params) => {
    const { filePath, steps } = params as {
      filePath: string;
      steps: { action: string; value: string }[];
    };

    let targetUrl = filePath;
    if (!filePath.startsWith("http") && !filePath.startsWith("file:///")) {
      const pathMod = await import("path");
      const resolved = pathMod.default.resolve(filePath);
      targetUrl = "file:///" + resolved.replace(/\\/g, "/");
    }

    await browserClose(SESSION_ID);

    const openResult = await browserOpen(targetUrl, SESSION_ID, {
      headless: false,
      waitUntil: "load",
    });
    if (!openResult.ok) {
      return { success: false, message: `浏览器打开失败: ${openResult.error}` };
    }

    await browserWait(SESSION_ID, { ms: 1000 });

    const stepResults: { step: number; action: string; ok: boolean; detail: string }[] = [];
    const screenshotFiles: { step: number; label: string; path: string; sizeKB: number }[] = [];

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const n = i + 1;

      try {
        switch (s.action) {
          case "wait": {
            const ms = parseInt(s.value) || 1000;
            await browserWait(SESSION_ID, { ms });
            stepResults.push({ step: n, action: "wait", ok: true, detail: `等待 ${ms}ms` });
            break;
          }

          case "click": {
            const r = await browserClick(SESSION_ID, s.value, { waitAfter: 500 });
            stepResults.push({
              step: n, action: "click", ok: r.ok,
              detail: r.ok ? `点击 ${s.value}` : `点击失败: ${r.error}`,
            });
            break;
          }

          case "key": {
            const match = s.value.match(/^(.+?)(?:[×xX*])(\d+)$/);
            const keyName = match ? match[1] : s.value;
            const count = match ? parseInt(match[2]) : 1;
            const r = await browserPressKey(SESSION_ID, keyName, { count, delay: 150 });
            stepResults.push({
              step: n, action: "key", ok: r.ok,
              detail: r.ok ? `按键 ${keyName}${count > 1 ? ` x${count}` : ""}` : `按键失败: ${r.error}`,
            });
            break;
          }

          case "js": {
            const r = await browserScript(SESSION_ID, s.value);
            const resultStr = r.result !== undefined ? String(r.result).slice(0, 500) : "";
            stepResults.push({
              step: n, action: "js", ok: r.ok,
              detail: r.ok ? `JS返回: ${resultStr || "(void)"}` : `JS失败: ${r.error}`,
            });
            break;
          }

          case "screenshot": {
            const r = await browserScreenshot(SESSION_ID);
            if (r.ok && r.base64) {
              const label = s.value || `步骤${n}截图`;
              const sizeKB = Math.round(r.base64.length * 3 / 4 / 1024);
              try {
                const savedPath = await saveScreenshot(r.base64, label, n);
                screenshotFiles.push({ step: n, label, path: savedPath, sizeKB });
                stepResults.push({ step: n, action: "screenshot", ok: true, detail: `截图已保存: ${savedPath} (${sizeKB}KB)` });
              } catch (saveErr) {
                stepResults.push({ step: n, action: "screenshot", ok: true, detail: `截图已捕获但保存失败: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}` });
              }
            } else {
              stepResults.push({ step: n, action: "screenshot", ok: false, detail: `截图失败: ${r.error}` });
            }
            break;
          }

          case "check": {
            const checkScript = `
              (function() {
                var result = {};
                // canvas检查
                var canvas = document.querySelector('canvas');
                if (canvas) {
                  result.canvasFound = true;
                  result.canvasSize = canvas.width + 'x' + canvas.height;
                  try {
                    var ctx = canvas.getContext('2d');
                    if (ctx) {
                      var img = ctx.getImageData(0, 0, Math.min(canvas.width, 100), Math.min(canvas.height, 100));
                      var nonBlack = 0, nonWhite = 0, total = img.data.length / 4;
                      for (var i = 0; i < img.data.length; i += 4) {
                        if (img.data[i] > 10 || img.data[i+1] > 10 || img.data[i+2] > 10) nonBlack++;
                        if (img.data[i] < 245 || img.data[i+1] < 245 || img.data[i+2] < 245) nonWhite++;
                      }
                      result.canvasBlackRatio = ((total - nonBlack) / total * 100).toFixed(1) + '%';
                      result.canvasWhiteRatio = ((total - nonWhite) / total * 100).toFixed(1) + '%';
                      result.canvasHasContent = nonBlack > total * 0.05 && nonWhite > total * 0.05;
                    } else {
                      result.canvasType = 'webgl';
                      try {
                        var gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
                        result.canvasHasContent = gl ? true : false;
                        result.webglRenderer = gl ? gl.getParameter(gl.RENDERER) : 'none';
                      } catch(e) { result.canvasHasContent = 'unknown(webgl)'; }
                    }
                  } catch(e) { result.canvasError = e.message; }
                } else {
                  result.canvasFound = false;
                }
                // DOM检查
                result.visibleElements = document.querySelectorAll('div,p,h1,h2,h3,span,button,a').length;
                result.bodyTextLength = (document.body.innerText || '').trim().length;
                result.title = document.title;
                // 用户指定变量检查
                var varsToCheck = '${s.value}'.split(',').map(function(v){return v.trim()}).filter(Boolean);
                if (varsToCheck.length > 0) {
                  result.variables = {};
                  varsToCheck.forEach(function(v) {
                    try { result.variables[v] = eval(v); } catch(e) { result.variables[v] = 'ERROR: ' + e.message; }
                  });
                }
                return JSON.stringify(result);
              })()
            `;
            const r = await browserScript(SESSION_ID, checkScript);
            if (r.ok && r.result) {
              try {
                const check = JSON.parse(String(r.result));
                let detail = `健康检查:\n`;
                detail += `    Canvas: ${check.canvasFound ? `找到 (${check.canvasSize})` : "未找到"}\n`;
                if (check.canvasFound) {
                  if (check.canvasType === "webgl") {
                    detail += `    渲染: WebGL (${check.webglRenderer || "active"})\n`;
                  } else {
                    detail += `    黑屏率: ${check.canvasBlackRatio} | 白屏率: ${check.canvasWhiteRatio}\n`;
                    detail += `    有内容: ${check.canvasHasContent ? "是" : "否 ⚠️ 可能白屏/黑屏"}\n`;
                  }
                }
                detail += `    可见DOM: ${check.visibleElements}个元素 | 文字: ${check.bodyTextLength}字符\n`;
                detail += `    标题: ${check.title}`;
                if (check.variables) {
                  detail += `\n    变量值:`;
                  Object.entries(check.variables).forEach(([k, v]) => {
                    detail += `\n      ${k} = ${JSON.stringify(v)}`;
                  });
                }
                const hasContent = check.canvasFound
                  ? (check.canvasHasContent === true || check.canvasHasContent === "unknown(webgl)" || check.canvasType === "webgl")
                  : check.bodyTextLength > 10;
                stepResults.push({ step: n, action: "check", ok: hasContent, detail });
              } catch {
                stepResults.push({ step: n, action: "check", ok: false, detail: `解析失败: ${String(r.result).slice(0, 200)}` });
              }
            } else {
              stepResults.push({ step: n, action: "check", ok: false, detail: `检查失败: ${r.error}` });
            }
            break;
          }

          case "autoplay": {
            const durationSec = parseInt(s.value) || 60;
            const autoplayScript = `
              (function() {
                var duration = ${durationSec} * 1000;
                var startTime = Date.now();
                var log = { moves: 0, restarts: 0, maxScore: 0, deaths: 0, finalScore: 0, mode: 'unknown', probeDetail: '' };

                function pressKey(code) {
                  var canvas = document.querySelector('canvas');
                  var target = canvas || document.body;
                  ['keydown','keyup'].forEach(function(type) {
                    target.dispatchEvent(new KeyboardEvent(type, {key: code, code: code, keyCode: ({ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,' ':32,Enter:13})[code]||0, bubbles: true, cancelable: true}));
                    document.dispatchEvent(new KeyboardEvent(type, {key: code, code: code, keyCode: ({ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,' ':32,Enter:13})[code]||0, bubbles: true, cancelable: true}));
                  });
                }

                var G = null;

                function tryCall(obj, names) {
                  for (var i = 0; i < names.length; i++) {
                    try {
                      if (typeof obj[names[i]] === 'function') return obj[names[i]]();
                    } catch(e) {}
                    try {
                      if (obj[names[i]] !== undefined) return obj[names[i]];
                    } catch(e) {}
                  }
                  return undefined;
                }

                function normalizeCoord(p) {
                  if (!p) return null;
                  if (p.x !== undefined) return {x: p.x, y: p.y !== undefined ? p.y : (p.z || 0)};
                  if (p.position) return normalizeCoord(p.position);
                  if (p.pos) return normalizeCoord(p.pos);
                  if (Array.isArray(p) && p.length >= 2) return {x: p[0], y: p[1]};
                  return null;
                }

                function normalizeSnakeArray(raw) {
                  if (!raw) return [];
                  if (!Array.isArray(raw)) {
                    if (raw.segments && Array.isArray(raw.segments)) raw = raw.segments;
                    else if (raw.body && Array.isArray(raw.body)) raw = raw.body;
                    else if (raw.cells && Array.isArray(raw.cells)) raw = raw.cells;
                    else if (typeof raw.getSegments === 'function') raw = raw.getSegments();
                    else if (typeof raw.getBody === 'function') raw = raw.getBody();
                    else return [];
                  }
                  try { return JSON.parse(JSON.stringify(raw)); } catch(e) { return []; }
                }

                function dirFromString(d) {
                  if (typeof d !== 'string') return null;
                  var m = {up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0},north:{x:0,y:-1},south:{x:0,y:1},west:{x:-1,y:0},east:{x:1,y:0}};
                  return m[d.toLowerCase()] || null;
                }

                function probeGameVars() {
                  // Pattern 1: global flat variables
                  try {
                    if (typeof snake !== 'undefined' && typeof food !== 'undefined') {
                      log.mode = 'global-flat';
                      log.probeDetail = 'found global snake+food';
                      return {
                        getSnake: function() { try { return normalizeSnakeArray(snake); } catch(e) { return []; } },
                        getFood: function() { try { return normalizeCoord(JSON.parse(JSON.stringify(food))); } catch(e) { return null; } },
                        getDir: function() {
                          try {
                            var d = typeof nextDirection!=='undefined'?nextDirection:direction;
                            if (typeof d === 'string') return dirFromString(d) || {x:1,y:0};
                            return normalizeCoord(d) || {x:1,y:0};
                          } catch(e) { return {x:1,y:0}; }
                        },
                        getScore: function() { return typeof score !== 'undefined' ? score : 0; },
                        isOver: function() { return typeof isGameOver !== 'undefined' ? isGameOver : (typeof gameOver !== 'undefined' ? gameOver : false); },
                        isPaused: function() { return typeof isPaused !== 'undefined' ? isPaused : (typeof paused !== 'undefined' ? paused : false); },
                        getBoardRange: function() { return {min:0,max:typeof tileCount!=='undefined'?tileCount:(typeof gridSize!=='undefined'?gridSize:20)}; },
                        getSpeed: function() { return typeof speed !== 'undefined' ? speed : (typeof moveInterval !== 'undefined' ? moveInterval : 100); },
                        restart: function() {
                          ['resetGame','initGame','startGame','restartGame','newGame','reset','start'].forEach(function(fn) {
                            try { if (typeof window[fn]==='function') window[fn](); } catch(e) {}
                          });
                        }
                      };
                    }
                  } catch(e) {}

                  // Pattern 2: object with methods (getSnake, getScore, getGameState etc.)
                  var rootNames = ['gameInstance','game','app','Game','gameManager','gm','engine','snakeGame','gameController'];
                  for (var rni = 0; rni < rootNames.length; rni++) {
                    try {
                      var root = window[rootNames[rni]];
                      if (!root || typeof root !== 'object') continue;

                      var hasMethodAPI = typeof root.getScore === 'function' || typeof root.getGameState === 'function' || typeof root.getSnake === 'function';
                      var hasPropAPI = root.snake !== undefined || root.score !== undefined;
                      if (!hasMethodAPI && !hasPropAPI) continue;

                      log.mode = 'object-instance(' + rootNames[rni] + ')';
                      log.probeDetail = 'methods: ' + Object.keys(root).filter(function(k){return typeof root[k]==='function'}).join(',');

                      return (function(r, rName) {
                        return {
                          getSnake: function() {
                            var raw = tryCall(r, ['getSnake','getBody','getSegments','snake','body','segments']);
                            return normalizeSnakeArray(raw);
                          },
                          getFood: function() {
                            var raw = tryCall(r, ['getFood','getApple','getFruit','getTarget','food','apple','fruit','target']);
                            if (raw) return normalizeCoord(raw);
                            return null;
                          },
                          getDir: function() {
                            var raw = tryCall(r, ['getDirection','getNextDirection','getDir','getHeading','direction','nextDirection','dir','heading']);
                            if (typeof raw === 'string') return dirFromString(raw) || {x:1,y:0};
                            return normalizeCoord(raw) || {x:1,y:0};
                          },
                          getScore: function() {
                            var s = tryCall(r, ['getScore','score']);
                            return typeof s === 'number' ? s : (parseInt(s) || 0);
                          },
                          isOver: function() {
                            var st = tryCall(r, ['getGameState','getState','getStatus','isGameOver','isOver','gameState','state','status','gameOver','isGameRunning']);
                            if (typeof st === 'boolean') return st === true && (r.isGameOver !== undefined || r.gameOver !== undefined || r.isOver !== undefined) ? st : !st;
                            if (typeof st === 'string') return /over|dead|ended|gameover|lost|finished/i.test(st);
                            return false;
                          },
                          isPaused: function() {
                            var st = tryCall(r, ['getGameState','getState','isPaused','paused','state','status']);
                            if (typeof st === 'boolean' && (r.isPaused !== undefined || r.paused !== undefined)) return st;
                            if (typeof st === 'string') return /pause/i.test(st);
                            return false;
                          },
                          getBoardRange: function() {
                            var tc = tryCall(r, ['getGridSize','getBoardSize','getTileCount','gridSize','boardSize','tileCount','cols','rows']);
                            var n = parseInt(tc) || 20;
                            return {min:0, max:n};
                          },
                          getSpeed: function() {
                            var s = tryCall(r, ['getSpeed','getMoveInterval','speed','moveInterval','interval']);
                            return parseInt(s) || 100;
                          },
                          restart: function() {
                            var fns = ['restart','reset','resetGame','initGame','startGame','newGame','start','init'];
                            for (var fi=0; fi<fns.length; fi++) {
                              try { if (typeof r[fns[fi]]==='function') { r[fns[fi]](); return; } } catch(e) {}
                            }
                            var btn = document.querySelector('#restart-btn,#restartBtn,#retryBtn,#retry-btn,[data-action=restart],#playAgainBtn,.restart-btn,#start-btn,#startBtn');
                            if (btn) btn.click();
                          }
                        };
                      })(root, rootNames[rni]);
                    } catch(e) {}
                  }

                  // Pattern 3: search all window props for snake-like arrays
                  try {
                    var wKeys = Object.keys(window);
                    for (var wi = 0; wi < wKeys.length; wi++) {
                      var k = wKeys[wi];
                      if (/snake/i.test(k)) {
                        var val = window[k];
                        if (Array.isArray(val) && val.length > 0 && val[0] && typeof val[0] === 'object') {
                          log.mode = 'global-prop(' + k + ')';
                          log.probeDetail = 'found window.' + k;
                          return {
                            getSnake: function() { try { return normalizeSnakeArray(window[k]); } catch(e) { return []; } },
                            getFood: function() {
                              for (var fi = 0; fi < wKeys.length; fi++) {
                                if (/food|apple|fruit|target/i.test(wKeys[fi])) {
                                  var f = window[wKeys[fi]];
                                  if (f && typeof f === 'object') return normalizeCoord(f);
                                }
                              }
                              return null;
                            },
                            getDir: function() { return {x:1,y:0}; },
                            getScore: function() {
                              for (var si = 0; si < wKeys.length; si++) {
                                if (/^score$/i.test(wKeys[si])) return window[wKeys[si]] || 0;
                              }
                              return 0;
                            },
                            isOver: function() {
                              for (var oi = 0; oi < wKeys.length; oi++) {
                                if (/gameOver|isGameOver|isOver/i.test(wKeys[oi])) return !!window[wKeys[oi]];
                              }
                              return false;
                            },
                            isPaused: function() { return false; },
                            getBoardRange: function() { return {min:0,max:20}; },
                            getSpeed: function() { return 100; },
                            restart: function() {
                              ['resetGame','initGame','startGame','restartGame'].forEach(function(fn) {
                                try { if (typeof window[fn]==='function') window[fn](); } catch(e) {}
                              });
                            }
                          };
                        }
                      }
                    }
                  } catch(e) {}

                  return null;
                }

                G = probeGameVars();

                var blindKeys = ['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'];
                var blindIdx = 0;
                var lastBlindTurn = 0;
                var probeRetries = 0;

                function tickSmart() {
                  if (Date.now() - startTime > duration) return;

                  if (!G && probeRetries < 20) {
                    G = probeGameVars();
                    probeRetries++;
                  }

                  if (G) {
                    var sc = G.getScore();
                    if (typeof sc === 'number') {
                      if (sc > log.maxScore) log.maxScore = sc;
                      log.finalScore = sc;
                    }

                    if (G.isOver()) {
                      log.deaths++;
                      G.restart();
                      setTimeout(tickSmart, 800);
                      return;
                    }
                    if (G.isPaused()) {
                      pressKey(' ');
                      setTimeout(tickSmart, 300);
                      return;
                    }

                    var snakeArr = G.getSnake();
                    var foodPos = G.getFood();
                    var dir = G.getDir();

                    if (snakeArr.length > 0 && foodPos) {
                      var head = normalizeCoord(snakeArr[0]);
                      if (!head) head = {x:0,y:0};
                      var fx = foodPos.x || 0, fy = foodPos.y || 0;
                      var br = G.getBoardRange ? G.getBoardRange() : {min:0,max:20};

                      var bodySet = {};
                      for (var bi = 1; bi < snakeArr.length; bi++) {
                        var seg = normalizeCoord(snakeArr[bi]);
                        if (seg) bodySet[Math.round(seg.x)+','+Math.round(seg.y)] = true;
                      }

                      var cands = [
                        {dx:0,dy:-1,key:'ArrowUp'},{dx:0,dy:1,key:'ArrowDown'},
                        {dx:-1,dy:0,key:'ArrowLeft'},{dx:1,dy:0,key:'ArrowRight'}
                      ];
                      if (dir) cands = cands.filter(function(c) { return !(c.dx===-dir.x && c.dy===-dir.y); });
                      var safe = cands.filter(function(c) {
                        var nx = Math.round(head.x+c.dx), ny = Math.round(head.y+c.dy);
                        if (nx < br.min || nx >= br.max || ny < br.min || ny >= br.max) return false;
                        return !bodySet[nx+','+ny];
                      });
                      if (safe.length === 0) safe = cands;
                      if (safe.length === 0) safe = [{key:'ArrowRight',dx:1,dy:0}];
                      safe.sort(function(a,b) {
                        return (Math.abs(head.x+a.dx-fx)+Math.abs(head.y+a.dy-fy)) - (Math.abs(head.x+b.dx-fx)+Math.abs(head.y+b.dy-fy));
                      });
                      pressKey(safe[0].key);
                      log.moves++;
                    } else {
                      pressKey(blindKeys[blindIdx % 4]);
                      log.moves++;
                      if (Date.now() - lastBlindTurn > 1500) { blindIdx++; lastBlindTurn = Date.now(); }
                    }

                    var spd = G.getSpeed();
                    setTimeout(tickSmart, Math.max(50, (spd || 100) - 20));
                  } else {
                    log.mode = 'blind-keys';
                    pressKey(blindKeys[blindIdx % 4]);
                    log.moves++;
                    if (Date.now() - lastBlindTurn > 1500) { blindIdx++; lastBlindTurn = Date.now(); }

                    try {
                      var scoreEl = document.querySelector('#score,[class*=score],[id*=score]');
                      if (scoreEl) {
                        var domScore = parseInt(scoreEl.textContent) || 0;
                        if (domScore > log.maxScore) log.maxScore = domScore;
                        log.finalScore = domScore;
                      }
                    } catch(e) {}

                    var overEl = document.querySelector('.game-over,[class*=gameOver],[class*=game-over],[id*=gameOver],[id*=game-over]');
                    if (overEl && overEl.style.display !== 'none' && overEl.offsetParent !== null) {
                      log.deaths++;
                      log.restarts++;
                      var retryBtn = overEl.querySelector('button') || document.querySelector('#restart-btn,#restartBtn,#retryBtn,.restart-btn,#playAgainBtn');
                      if (retryBtn) retryBtn.click();
                      else pressKey('Enter');
                    }
                    setTimeout(tickSmart, 150);
                  }
                }

                // click start button if visible
                var startBtns = document.querySelectorAll('#start-btn,#startBtn,.start-btn,[data-action=start],button');
                for (var si = 0; si < startBtns.length; si++) {
                  if (startBtns[si].offsetParent !== null) { startBtns[si].click(); break; }
                }
                // also try calling start methods on game objects
                var rootNames2 = ['gameInstance','game','app'];
                for (var ri2 = 0; ri2 < rootNames2.length; ri2++) {
                  try {
                    var rr = window[rootNames2[ri2]];
                    if (rr && typeof rr.start === 'function') rr.start();
                    else if (rr && typeof rr.startGame === 'function') rr.startGame();
                    else if (rr && typeof rr.init === 'function') rr.init();
                  } catch(e) {}
                }

                setTimeout(tickSmart, 500);

                return new Promise(function(resolve) {
                  var earlyCheckDone = false;
                  setTimeout(function() {
                    if (earlyCheckDone) return;
                    earlyCheckDone = true;
                    if (log.moves < 3 && !G) {
                      log.probeDetail += ' | EARLY_EXIT: no game vars found after 8s, probe failed';
                      resolve(JSON.stringify(log));
                      return;
                    }
                  }, 8000);

                  setTimeout(function() {
                    if (G) {
                      try {
                        var sc = G.getScore();
                        if (typeof sc === 'number') {
                          if (sc > log.maxScore) log.maxScore = sc;
                          log.finalScore = sc;
                        }
                      } catch(e) {}
                    }
                    earlyCheckDone = true;
                    resolve(JSON.stringify(log));
                  }, duration + 1000);
                });
              })()
            `;
            const timeoutMs = (durationSec + 10) * 1000;
            const r = await browserScript(SESSION_ID, autoplayScript, { timeoutMs });
            if (r.ok && r.result) {
              try {
                const result = JSON.parse(String(r.result));
                stepResults.push({
                  step: n, action: "autoplay", ok: true,
                  detail: `AI自动玩了${durationSec}秒 | 操作${result.moves}次 | 最高分${result.maxScore} | 最终分${result.finalScore} | 死亡${result.deaths}次 | 重开${result.restarts}次`,
                });
              } catch {
                stepResults.push({ step: n, action: "autoplay", ok: true, detail: `自动玩完成: ${String(r.result).slice(0, 300)}` });
              }
            } else {
              stepResults.push({ step: n, action: "autoplay", ok: false, detail: `自动玩失败: ${r.error}` });
            }
            break;
          }

          default:
            stepResults.push({ step: n, action: s.action, ok: false, detail: `未知操作` });
        }
      } catch (err) {
        stepResults.push({
          step: n, action: s.action, ok: false,
          detail: `异常: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    const errResult = await browserGetConsoleErrors(SESSION_ID);
    const allErrors = errResult.ok ? errResult.errors : [];
    const ENV_PATTERNS = [/WebGL/i, /GPU/i, /hardware acceleration/i, /deprecated/i, /third-party cookie/i];
    const envWarnings = allErrors.filter((e) => ENV_PATTERNS.some((p) => p.test(e)));
    const jsErrors = allErrors.filter((e) => !ENV_PATTERNS.some((p) => p.test(e)));

    const pageInfo = await browserScript(SESSION_ID, `
      (function(){
        var r = { title: document.title };
        try { r.text = document.body.innerText.substring(0, 500); } catch(e){}
        var c = document.querySelector('canvas');
        if(c) { r.canvas = c.width + 'x' + c.height; }
        return JSON.stringify(r);
      })()
    `);

    const passed = stepResults.filter((r) => r.ok).length;
    const failed = stepResults.filter((r) => !r.ok).length;

    let report = `🧪 沙盒测试报告\n`;
    report += `━━━━━━━━━━━━━━━━━━━━\n`;
    report += `📁 目标: ${targetUrl}\n`;
    report += `📊 结果: ${passed}/${stepResults.length} 步骤通过`;
    if (failed > 0) report += ` ⚠️ ${failed} 步骤失败`;
    report += `\n\n`;

    report += `📝 执行详情:\n`;
    stepResults.forEach((r) => {
      report += `  ${r.ok ? "✓" : "✗"} 步骤${r.step} [${r.action}]: ${r.detail}\n`;
    });

    if (jsErrors.length > 0) {
      report += `\n🐛 JS致命错误 (${jsErrors.length}):\n`;
      jsErrors.forEach((e, i) => { report += `  ${i + 1}. ${e}\n`; });
    } else {
      report += `\n✅ 无JS致命错误\n`;
    }

    if (envWarnings.length > 0) {
      report += `\n⚙️ 环境警告 (${envWarnings.length}):\n`;
      envWarnings.forEach((e, i) => { report += `  ${i + 1}. ${e}\n`; });
    }

    if (pageInfo.ok && pageInfo.result) {
      try {
        const info = JSON.parse(String(pageInfo.result));
        report += `\n📄 页面: ${info.title}`;
        if (info.canvas) report += ` | Canvas: ${info.canvas}`;
        if (info.text) report += `\n  文字: ${info.text.slice(0, 200)}`;
      } catch { /* noop */ }
    }

    if (screenshotFiles.length > 0) {
      report += `\n\n📸 截图已保存到本地 (${screenshotFiles.length}张):`;
      screenshotFiles.forEach((s) => {
        report += `\n  - 步骤${s.step} [${s.label}]: ${s.path} (${s.sizeKB}KB)`;
      });
    }

    report += `\n━━━━━━━━━━━━━━━━━━━━`;

    const resultData: Record<string, unknown> = {
      url: targetUrl,
      steps: stepResults,
      passed,
      failed,
      jsErrors,
      envWarnings,
    };

    if (screenshotFiles.length > 0) {
      resultData.screenshots = screenshotFiles.map((s) => ({
        step: s.step,
        label: s.label,
        path: s.path,
        sizeKB: s.sizeKB,
      }));
    }

    return {
      success: failed === 0 && jsErrors.length === 0,
      message: report,
      data: resultData,
    };
  },
};
