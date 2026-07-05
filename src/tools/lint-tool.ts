import { execFile } from "child_process";
import { promisify } from "util";
import type { LintReport, LintIssue } from "../core/types.js";

const execFileAsync = promisify(execFile);

export class LintTool {
  private readonly cwd: string;
  private readonly mock: boolean;

  constructor(cwd = process.cwd(), mock = false) {
    this.cwd = cwd;
    this.mock = mock;
  }

  async run(filePaths: string[] = []): Promise<LintReport> {
    if (this.mock) {
      return { passed: true, issues: [], output: "No lint issues (mock)" };
    }

    try {
      const args = ["eslint", "--format=json", ...filePaths];
      const { stdout, stderr } = await execFileAsync("npx", args, {
        cwd: this.cwd,
      }).catch((err: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => ({
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
      }));

      return this.parseEslintOutput(stdout, stderr);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        passed: false,
        issues: [],
        output: `Lint tool error: ${message}`,
      };
    }
  }

  private parseEslintOutput(stdout: string, stderr: string): LintReport {
    try {
      const results = JSON.parse(stdout) as Array<{
        filePath: string;
        messages: Array<{
          line: number;
          column: number;
          severity: number;
          message: string;
          ruleId: string | null;
        }>;
      }>;

      const issues: LintIssue[] = [];
      for (const result of results) {
        for (const msg of result.messages) {
          issues.push({
            file: result.filePath,
            line: msg.line,
            column: msg.column,
            severity: msg.severity === 2 ? "error" : "warning",
            message: msg.message,
            rule: msg.ruleId ?? "unknown",
          });
        }
      }

      const hasErrors = issues.some((i) => i.severity === "error");
      return { passed: !hasErrors, issues, output: stdout };
    } catch {
      const passed = !stdout.includes("error") && !stderr.includes("error");
      return { passed, issues: [], output: stdout + stderr };
    }
  }
}
