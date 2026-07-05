import { appendFile, readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { Task } from "../core/types.js";

// ──────────────────────────────────────────────
// Artifacts — logs, patches, reports
// ──────────────────────────────────────────────

export interface ArtifactEntry {
  id: string;
  ticketId: string;
  type: "log" | "patch" | "report" | "prompt";
  content: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export class Artifacts {
  private readonly artifactsDir: string;

  constructor(artifactsDir = join(process.cwd(), ".artifacts")) {
    this.artifactsDir = artifactsDir;
  }

  private async ensureDir(subDir?: string): Promise<string> {
    const dir = subDir ? join(this.artifactsDir, subDir) : this.artifactsDir;
    await mkdir(dir, { recursive: true });
    return dir;
  }

  // ──────────────────────────────────────────────
  // Logging
  // ──────────────────────────────────────────────

  async log(ticketId: string, message: string, level: "info" | "warn" | "error" = "info"): Promise<void> {
    const dir = await this.ensureDir(ticketId);
    const logFile = join(dir, "run.log");
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    await appendFile(logFile, line, "utf8");
  }

  // ──────────────────────────────────────────────
  // Patches
  // ──────────────────────────────────────────────

  async savePatch(ticketId: string, patchContent: string, iteration: number): Promise<string> {
    const dir = await this.ensureDir(join(ticketId, "patches"));
    const patchFile = join(dir, `iteration-${iteration}.patch`);
    await writeFile(patchFile, patchContent, "utf8");
    return patchFile;
  }

  // ──────────────────────────────────────────────
  // Reports
  // ──────────────────────────────────────────────

  async saveReport(ticketId: string, reportType: string, data: unknown): Promise<string> {
    const dir = await this.ensureDir(join(ticketId, "reports"));
    const reportFile = join(dir, `${reportType}.json`);
    await writeFile(reportFile, JSON.stringify(data, null, 2), "utf8");
    return reportFile;
  }

  async getReport(ticketId: string, reportType: string): Promise<unknown> {
    const reportFile = join(this.artifactsDir, ticketId, "reports", `${reportType}.json`);
    try {
      const raw = await readFile(reportFile, "utf8");
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  // ──────────────────────────────────────────────
  // Task summary
  // ──────────────────────────────────────────────

  async saveTaskSummary(task: Task): Promise<void> {
    const dir = await this.ensureDir(task.ticket.id);
    const summaryFile = join(dir, "summary.json");

    const summary = {
      ticket: task.ticket,
      status: task.ticket.status,
      totalCostUsd: task.costUsd,
      tokenUsage: task.tokenUsageByStage,
      testPassed: task.testReport?.passed,
      reviewApproved: task.reviewReport?.approved,
      mergeStatus: task.mergerOutput?.mergeStatus,
      timestamp: new Date().toISOString(),
    };

    await writeFile(summaryFile, JSON.stringify(summary, null, 2), "utf8");
  }

  async readLog(ticketId: string): Promise<string> {
    const logFile = join(this.artifactsDir, ticketId, "run.log");
    try {
      return await readFile(logFile, "utf8");
    } catch {
      return "";
    }
  }
}
