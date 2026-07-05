import { execFile } from "child_process";
import { promisify } from "util";
import type { TypeCheckReport } from "../core/types.js";

const execFileAsync = promisify(execFile);

export class TypeCheckTool {
  private readonly cwd: string;
  private readonly mock: boolean;

  constructor(cwd = process.cwd(), mock = false) {
    this.cwd = cwd;
    this.mock = mock;
  }

  async run(): Promise<TypeCheckReport> {
    if (this.mock) {
      return { passed: true, errors: [], output: "No type errors (mock)" };
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        "npx",
        ["tsc", "--noEmit"],
        { cwd: this.cwd }
      ).catch((err: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => ({
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
      }));

      const output = stdout + stderr;
      const errors = output
        .split("\n")
        .filter((line) => line.includes("error TS"));

      return {
        passed: errors.length === 0,
        errors,
        output,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        passed: false,
        errors: [message],
        output: `TypeCheck tool error: ${message}`,
      };
    }
  }
}
