import { execFile } from "child_process";
import { promisify } from "util";
import type { SecurityReport, SecurityFinding } from "../core/types.js";

const execFileAsync = promisify(execFile);

// Severity keywords for pattern-based scanning
const SEVERITY_PATTERNS: Array<{
  pattern: RegExp;
  severity: SecurityFinding["severity"];
  rule: string;
  message: string;
  cwe?: string;
}> = [
  {
    pattern: /eval\s*\(/,
    severity: "high",
    rule: "no-eval",
    message: "Use of eval() is a security risk",
    cwe: "CWE-95",
  },
  {
    pattern: /innerHTML\s*=/,
    severity: "medium",
    rule: "no-inner-html",
    message: "Unescaped innerHTML can lead to XSS",
    cwe: "CWE-79",
  },
  {
    pattern: /exec\s*\(\s*[`'"].*\$\{/,
    severity: "critical",
    rule: "no-command-injection",
    message: "Command injection risk: template literal in exec()",
    cwe: "CWE-78",
  },
  {
    pattern: /password\s*=\s*['"][^'"]+['"]/i,
    severity: "critical",
    rule: "no-hardcoded-creds",
    message: "Hardcoded password detected",
    cwe: "CWE-798",
  },
  {
    pattern: /secret\s*=\s*['"][^'"]{8,}['"]/i,
    severity: "critical",
    rule: "no-hardcoded-secret",
    message: "Hardcoded secret detected",
    cwe: "CWE-798",
  },
  {
    pattern: /crypto\.getRandomValues|Math\.random\(\)/,
    severity: "low",
    rule: "no-insecure-random",
    message: "Math.random() is not cryptographically secure",
    cwe: "CWE-338",
  },
];

export class SecurityScanner {
  private readonly cwd: string;
  private readonly mock: boolean;

  constructor(cwd = process.cwd(), mock = false) {
    this.cwd = cwd;
    this.mock = mock;
  }

  async run(filePaths: string[] = []): Promise<SecurityReport> {
    if (this.mock) {
      return {
        passed: true,
        findings: [],
        output: "No security issues (mock)",
      };
    }

    const findings: SecurityFinding[] = [];
    const output: string[] = [];

    // Try semgrep first
    const semgrepResult = await this.runSemgrep(filePaths);
    if (semgrepResult) {
      findings.push(...semgrepResult.findings);
      output.push(semgrepResult.output);
    } else {
      // Fallback: pattern-based scanning
      const patternResult = await this.patternScan(filePaths);
      findings.push(...patternResult.findings);
      output.push(patternResult.output);
    }

    const hasCritical = findings.some(
      (f) => f.severity === "critical" || f.severity === "high"
    );

    return {
      passed: !hasCritical,
      findings,
      output: output.join("\n"),
    };
  }

  private async runSemgrep(filePaths: string[]): Promise<{ findings: SecurityFinding[]; output: string } | null> {
    try {
      const args = [
        "semgrep",
        "--json",
        "--config=auto",
        ...filePaths,
      ];
      const { stdout } = await execFileAsync("npx", args, {
        cwd: this.cwd,
      });

      const data = JSON.parse(stdout) as {
        results?: Array<{
          check_id: string;
          path: string;
          start: { line: number };
          extra?: { message?: string; severity?: string };
        }>;
      };

      const findings: SecurityFinding[] = (data.results ?? []).map((r) => ({
        severity: (r.extra?.severity?.toLowerCase() as SecurityFinding["severity"]) ?? "medium",
        rule: r.check_id,
        file: r.path,
        line: r.start.line,
        message: r.extra?.message ?? r.check_id,
      }));

      return { findings, output: stdout };
    } catch {
      return null;
    }
  }

  private async patternScan(
    filePaths: string[]
  ): Promise<{ findings: SecurityFinding[]; output: string }> {
    const { readFile } = await import("fs/promises");
    const findings: SecurityFinding[] = [];

    for (const filePath of filePaths) {
      try {
        const content = await readFile(filePath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          for (const { pattern, severity, rule, message, cwe } of SEVERITY_PATTERNS) {
            if (pattern.test(line)) {
              const finding: SecurityFinding = {
                severity,
                rule,
                file: filePath,
                line: i + 1,
                message,
              };
              if (cwe !== undefined) finding.cwe = cwe;
              findings.push(finding);
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return {
      findings,
      output: findings.length === 0
        ? "No security issues found"
        : findings.map((f) => `${f.file}:${f.line} [${f.severity}] ${f.message}`).join("\n"),
    };
  }
}
