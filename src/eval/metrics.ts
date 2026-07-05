import type { Task } from "../core/types.js";

// ──────────────────────────────────────────────
// Metrics
// ──────────────────────────────────────────────

export interface MetricsReport {
  totalTasks: number;
  successRate: number; // 0-1
  failureRate: number;
  escalationRate: number;
  reworkRate: number; // tasks that needed >0 repair loops
  averageRepairLoops: number;
  averageDurationMs: number;
  byStatus: Record<string, number>;
  byTier: Record<string, number>;
  byPriority: Record<string, number>;
}

export function computeMetrics(tasks: Task[]): MetricsReport {
  if (tasks.length === 0) {
    return {
      totalTasks: 0,
      successRate: 0,
      failureRate: 0,
      escalationRate: 0,
      reworkRate: 0,
      averageRepairLoops: 0,
      averageDurationMs: 0,
      byStatus: {},
      byTier: {},
      byPriority: {},
    };
  }

  const total = tasks.length;
  const done = tasks.filter((t) => t.ticket.status === "done").length;
  const failed = tasks.filter((t) => t.ticket.status === "failed").length;
  const escalated = tasks.filter((t) => t.ticket.status === "escalated").length;
  const reworked = tasks.filter((t) => t.ticket.repairCount > 0).length;

  const totalRepairLoops = tasks.reduce((sum, t) => sum + t.ticket.repairCount, 0);

  // Duration from createdAt to updatedAt
  const durations = tasks.map((t) => {
    const created = new Date(t.ticket.createdAt).getTime();
    const updated = new Date(t.ticket.updatedAt).getTime();
    return updated - created;
  });
  const avgDuration = durations.reduce((a, b) => a + b, 0) / total;

  // Group by status
  const byStatus: Record<string, number> = {};
  for (const task of tasks) {
    const s = task.ticket.status;
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }

  // Group by tier
  const byTier: Record<string, number> = {};
  for (const task of tasks) {
    const t = task.ticket.tier;
    byTier[t] = (byTier[t] ?? 0) + 1;
  }

  // Group by priority
  const byPriority: Record<string, number> = {};
  for (const task of tasks) {
    const p = task.ticket.priority;
    byPriority[p] = (byPriority[p] ?? 0) + 1;
  }

  return {
    totalTasks: total,
    successRate: done / total,
    failureRate: failed / total,
    escalationRate: escalated / total,
    reworkRate: reworked / total,
    averageRepairLoops: totalRepairLoops / total,
    averageDurationMs: avgDuration,
    byStatus,
    byTier,
    byPriority,
  };
}

export function formatMetricsReport(report: MetricsReport): string {
  const lines: string[] = [
    "## Metrics Report",
    "",
    `Total tasks:       ${report.totalTasks}`,
    `Success rate:      ${(report.successRate * 100).toFixed(1)}%`,
    `Failure rate:      ${(report.failureRate * 100).toFixed(1)}%`,
    `Escalation rate:   ${(report.escalationRate * 100).toFixed(1)}%`,
    `Rework rate:       ${(report.reworkRate * 100).toFixed(1)}%`,
    `Avg repair loops:  ${report.averageRepairLoops.toFixed(2)}`,
    `Avg duration:      ${(report.averageDurationMs / 1000).toFixed(1)}s`,
    "",
    "### By Status",
    ...Object.entries(report.byStatus).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "### By Tier",
    ...Object.entries(report.byTier).map(([k, v]) => `  Tier ${k}: ${v}`),
    "",
    "### By Priority",
    ...Object.entries(report.byPriority).map(([k, v]) => `  ${k}: ${v}`),
  ];
  return lines.join("\n");
}
