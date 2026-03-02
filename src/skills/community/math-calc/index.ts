import { z } from "zod";
import type { SkillDefinition } from "../types";

function factorial(n: number): number {
  if (n < 0) throw new Error("负数无阶乘");
  if (n > 170) throw new Error("数值过大");
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function combination(n: number, k: number): number {
  if (k > n || k < 0) return 0;
  return factorial(n) / (factorial(k) * factorial(n - k));
}

function permutation(n: number, k: number): number {
  if (k > n || k < 0) return 0;
  return factorial(n) / factorial(n - k);
}

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcd(a, b);
}

function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

function primeFactors(n: number): number[] {
  const factors: number[] = [];
  let num = Math.abs(Math.floor(n));
  for (let d = 2; d * d <= num; d++) {
    while (num % d === 0) { factors.push(d); num /= d; }
  }
  if (num > 1) factors.push(num);
  return factors;
}

function mean(arr: number[]): number { return arr.reduce((a, b) => a + b, 0) / arr.length; }

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / arr.length);
}

function solveQuadratic(a: number, b: number, c: number): { x1: string; x2: string; discriminant: number } {
  const d = b * b - 4 * a * c;
  if (d > 0) {
    return { x1: String((-b + Math.sqrt(d)) / (2 * a)), x2: String((-b - Math.sqrt(d)) / (2 * a)), discriminant: d };
  } else if (d === 0) {
    return { x1: String(-b / (2 * a)), x2: String(-b / (2 * a)), discriminant: d };
  } else {
    const real = (-b / (2 * a)).toFixed(4);
    const imag = (Math.sqrt(-d) / (2 * a)).toFixed(4);
    return { x1: `${real} + ${imag}i`, x2: `${real} - ${imag}i`, discriminant: d };
  }
}

export const mathCalcSkill: SkillDefinition = {
  name: "math_calc",
  displayName: "高级数学计算",
  description:
    "高级数学计算：表达式求值、阶乘、排列组合、最大公约数、质数判断、质因数分解、统计分析、二次方程求解。" +
    "用户说'计算'、'数学'、'方程'、'阶乘'、'排列组合'、'质数'、'统计'时使用。",
  icon: "Calculator",
  category: "life",
  parameters: z.object({
    action: z.enum(["eval", "factorial", "combination", "permutation", "gcd", "lcm", "prime", "factors", "stats", "quadratic"])
      .describe("操作: eval=表达式求值, factorial=阶乘, combination=组合C(n,k), permutation=排列P(n,k), gcd=最大公约数, lcm=最小公倍数, prime=质数判断, factors=质因数分解, stats=统计分析, quadratic=二次方程"),
    expression: z.string().optional().describe("eval时的数学表达式(如'2*3+4', 'Math.sqrt(16)')"),
    n: z.number().optional().describe("factorial/combination/permutation的n"),
    k: z.number().optional().describe("combination/permutation的k"),
    a: z.number().optional().describe("gcd/lcm的第一个数 或 二次方程的a"),
    b: z.number().optional().describe("gcd/lcm的第二个数 或 二次方程的b"),
    c: z.number().optional().describe("二次方程的c (ax²+bx+c=0)"),
    number: z.number().optional().describe("prime/factors的数字"),
    numbers: z.array(z.number()).optional().describe("stats的数据集"),
  }),
  execute: async (params) => {
    const p = params as Record<string, unknown>;

    try {
      switch (p.action as string) {
        case "eval": {
          if (!p.expression) return { success: false, message: "❌ 请提供数学表达式" };
          const expr = (p.expression as string)
            .replace(/[^0-9+\-*/().%,\s^eEpiPItancosinlgsqrtabsflorceilroundpowlogMath]/g, "");
          const result = new Function(`return ${expr}`)();
          return { success: true, message: `🔢 计算结果\n━━━━━━━━━━━━━━━━━━━━\n${p.expression} = **${result}**`, data: { result } };
        }

        case "factorial": {
          const n = p.n as number;
          if (n == null) return { success: false, message: "❌ 请提供 n" };
          const result = factorial(n);
          return { success: true, message: `🔢 ${n}! = **${result}**`, data: { result } };
        }

        case "combination": {
          const n = p.n as number, k = p.k as number;
          if (n == null || k == null) return { success: false, message: "❌ 请提供 n 和 k" };
          const result = combination(n, k);
          return { success: true, message: `🔢 C(${n}, ${k}) = **${result}**`, data: { result } };
        }

        case "permutation": {
          const n = p.n as number, k = p.k as number;
          if (n == null || k == null) return { success: false, message: "❌ 请提供 n 和 k" };
          const result = permutation(n, k);
          return { success: true, message: `🔢 P(${n}, ${k}) = **${result}**`, data: { result } };
        }

        case "gcd": {
          const a = p.a as number, b = p.b as number;
          if (a == null || b == null) return { success: false, message: "❌ 请提供 a 和 b" };
          const result = gcd(a, b);
          return { success: true, message: `🔢 GCD(${a}, ${b}) = **${result}**`, data: { result } };
        }

        case "lcm": {
          const a = p.a as number, b = p.b as number;
          if (a == null || b == null) return { success: false, message: "❌ 请提供 a 和 b" };
          const result = lcm(a, b);
          return { success: true, message: `🔢 LCM(${a}, ${b}) = **${result}**`, data: { result } };
        }

        case "prime": {
          const num = p.number as number;
          if (num == null) return { success: false, message: "❌ 请提供 number" };
          const result = isPrime(num);
          return { success: true, message: `🔢 ${num} ${result ? "**是**质数 ✅" : "**不是**质数 ❌"}`, data: { isPrime: result } };
        }

        case "factors": {
          const num = p.number as number;
          if (num == null) return { success: false, message: "❌ 请提供 number" };
          const factors = primeFactors(num);
          return { success: true, message: `🔢 ${num} = ${factors.join(" × ")}`, data: { factors } };
        }

        case "stats": {
          const nums = p.numbers as number[];
          if (!nums || nums.length === 0) return { success: false, message: "❌ 请提供 numbers 数组" };
          const sorted = [...nums].sort((a, b) => a - b);
          let msg = `📊 统计分析\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `数据: [${nums.length > 10 ? nums.slice(0, 10).join(", ") + "..." : nums.join(", ")}]\n`;
          msg += `个数: ${nums.length}\n`;
          msg += `平均值: ${mean(nums).toFixed(4)}\n`;
          msg += `中位数: ${median(nums).toFixed(4)}\n`;
          msg += `标准差: ${stddev(nums).toFixed(4)}\n`;
          msg += `最小值: ${sorted[0]}\n`;
          msg += `最大值: ${sorted[sorted.length - 1]}\n`;
          msg += `总和: ${nums.reduce((a, b) => a + b, 0)}`;
          return { success: true, message: msg, data: { mean: mean(nums), median: median(nums), stddev: stddev(nums), min: sorted[0], max: sorted[sorted.length - 1] } };
        }

        case "quadratic": {
          const a = p.a as number, b = p.b as number, c = p.c as number;
          if (a == null || b == null || c == null) return { success: false, message: "❌ 请提供 a, b, c (ax²+bx+c=0)" };
          if (a === 0) return { success: false, message: "❌ a 不能为0" };
          const result = solveQuadratic(a, b, c);
          let msg = `🔢 二次方程求解\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `${a}x² + ${b}x + ${c} = 0\n`;
          msg += `Δ = ${result.discriminant}\n`;
          msg += `x₁ = ${result.x1}\nx₂ = ${result.x2}`;
          return { success: true, message: msg, data: result };
        }

        default:
          return { success: false, message: `❌ 未知操作: ${p.action}` };
      }
    } catch (err) {
      return { success: false, message: `❌ 计算错误: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
