import { execFile } from "child_process";
import { promisify } from "util";
import type { TestReport, TestCase } from "../core/types.js";

const execFileAsync = promisify(execFile);

// ──────────────────────────────────────────────
// TestRunner
// ──────────────────────────────────────────────

export class TestRunner {
  private readonly cwd: string;
  private readonly mock: boolean;

  constructor(cwd = process.cwd(), mock = false) {
    this.cwd = cwd;
    this.mock = mock;
  }

  async run(filePaths: string[] = []): Promise<TestReport> {
    if (this.mock) {
      return this.mockReport(true);
    }

    const start = Date.now();
    try {
      const args = ["run", "--reporter=json", ...filePaths];
      const { stdout, stderr } = await execFileAsync(
        "npx",
        ["vitest", ...args],
        { cwd: this.cwd }
      ).catch((err: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => ({
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
      }));

      return this.parseVitestOutput(stdout, stderr, Date.now() - start);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        passed: false,
        total: 0,
        passed_count: 0,
        failed_count: 0,
        skipped_count: 0,
        cases: [],
        durationMs: Date.now() - start,
        output: `Test runner error: ${message}`,
      };
    }
  }

  private parseVitestOutput(
    stdout: string,
    stderr: string,
    durationMs: number
  ): TestReport {
    try {
      // Vitest JSON output
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]) as {
          numTotalTests?: number;
          numPassedTests?: number;
          numFailedTests?: number;
          numPendingTests?: number;
          testResults?: Array<{
            testFilePath: string;
            testResults?: Array<{
              title: string;
              status: string;
              duration: number;
              failureMessages?: string[];
            }>;
          }>;
        };

        const cases: TestCase[] = [];
        for (const suite of data.testResults ?? []) {
          for (const t of suite.testResults ?? []) {
            const firstFailure = t.failureMessages?.[0];
            const tc: TestCase = {
              name: t.title,
              passed: t.status === "passed",
              durationMs: t.duration,
            };
            if (firstFailure !== undefined) tc.error = firstFailure;
            cases.push(tc);
          }
        }

        return {
          passed: (data.numFailedTests ?? 0) === 0,
          total: data.numTotalTests ?? 0,
          passed_count: data.numPassedTests ?? 0,
          failed_count: data.numFailedTests ?? 0,
          skipped_count: data.numPendingTests ?? 0,
          cases,
          durationMs,
          output: stdout,
        };
      }
    } catch {
      // Fall through to text parsing
    }

    // Text-based fallback
    const passed = !stdout.includes("FAIL") && !stderr.includes("error");
    return {
      passed,
      total: 0,
      passed_count: 0,
      failed_count: 0,
      skipped_count: 0,
      cases: [],
      durationMs,
      output: stdout + stderr,
    };
  }

  mockReport(passing: boolean): TestReport {
    const failCase: TestCase = {
      name: "should validate input",
      passed: passing,
      durationMs: 2,
    };
    if (!passing) failCase.error = "AssertionError: expected true to be false";

    return {
      passed: passing,
      total: 3,
      passed_count: passing ? 3 : 2,
      failed_count: passing ? 0 : 1,
      skipped_count: 0,
      cases: [
        { name: "should work correctly", passed: true, durationMs: 5 },
        { name: "should handle edge cases", passed: true, durationMs: 3 },
        failCase,
      ],
      durationMs: 42,
      output: passing ? "All tests passed" : "1 test failed",
    };
  }
}
