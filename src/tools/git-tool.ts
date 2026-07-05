import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface GitCommitResult {
  sha: string;
  message: string;
}

export interface GitDiffResult {
  diff: string;
  filesChanged: string[];
}

// ──────────────────────────────────────────────
// GitTool (with mock fallback)
// ──────────────────────────────────────────────

export class GitTool {
  private readonly cwd: string;
  private readonly mock: boolean;

  constructor(cwd = process.cwd(), mock = false) {
    this.cwd = cwd;
    this.mock = mock;
  }

  private async git(...args: string[]): Promise<string> {
    if (this.mock) {
      return `mock-git ${args.join(" ")}`;
    }
    const { stdout } = await execFileAsync("git", args, { cwd: this.cwd });
    return stdout.trim();
  }

  async currentBranch(): Promise<string> {
    return this.git("rev-parse", "--abbrev-ref", "HEAD");
  }

  async checkoutBranch(branch: string, create = false): Promise<void> {
    const args = create
      ? ["checkout", "-b", branch]
      : ["checkout", branch];
    await this.git(...args);
  }

  async addAll(): Promise<void> {
    await this.git("add", "-A");
  }

  async commit(message: string): Promise<GitCommitResult> {
    if (this.mock) {
      return { sha: "abc123mock", message };
    }
    await this.git("commit", "-m", message);
    const sha = await this.git("rev-parse", "HEAD");
    return { sha, message };
  }

  async push(branch: string, remote = "origin"): Promise<void> {
    await this.git("push", remote, branch);
  }

  async diff(base = "HEAD", target = ""): Promise<GitDiffResult> {
    if (this.mock) {
      return { diff: "mock diff", filesChanged: [] };
    }
    const diffArgs = target
      ? ["diff", base, target]
      : ["diff", base];
    const diff = await this.git(...diffArgs);
    const namesArgs = target
      ? ["diff", "--name-only", base, target]
      : ["diff", "--name-only", base];
    const names = await this.git(...namesArgs);
    return {
      diff,
      filesChanged: names ? names.split("\n").filter(Boolean) : [],
    };
  }

  async status(): Promise<string> {
    return this.git("status", "--porcelain");
  }

  async log(n = 10): Promise<string[]> {
    if (this.mock) return ["mock-sha1 mock commit"];
    const output = await this.git("log", `--oneline`, `-${n}`);
    return output ? output.split("\n").filter(Boolean) : [];
  }
}
