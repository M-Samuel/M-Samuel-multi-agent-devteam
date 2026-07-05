import type { Task, ModelTier } from "../core/types.js";
import type { BudgetSnapshot } from "../orchestrator/budget.js";

// ──────────────────────────────────────────────
// Cost Report
// ──────────────────────────────────────────────

export interface TaskCostEntry {
  ticketId: string;
  title: string;
  tier: ModelTier;
  status: string;
  totalTokens: number;
  costUsd: number;
  repairLoops: number;
}

export interface CostReport {
  entries: TaskCostEntry[];
  totalCostUsd: number;
  totalTokens: number;
  costByTier: Record<ModelTier, number>;
  tokensByTier: Record<ModelTier, number>;
  topCostlyTickets: TaskCostEntry[];
  budgetSnapshot?: BudgetSnapshot;
}

// Pricing constants (USD per 1k tokens)
const TIER_COST_PER_1K: Record<ModelTier, number> = {
  A: 0.03, // avg of input+output for GPT-4-turbo
  B: 0.002,
  C: 0.001,
};

export function buildCostReport(
  tasks: Task[],
  budgetSnapshot?: BudgetSnapshot
): CostReport {
  const entries: TaskCostEntry[] = tasks.map((task) => {
    const totalTokens = Object.values(task.tokenUsageByStage).reduce(
      (sum, usage) => sum + (usage?.totalTokens ?? 0),
      0
    );
    const costPer1k = TIER_COST_PER_1K[task.ticket.tier];
    const costUsd = (totalTokens / 1000) * costPer1k;

    return {
      ticketId: task.ticket.id,
      title: task.ticket.title,
      tier: task.ticket.tier,
      status: task.ticket.status,
      totalTokens,
      costUsd: task.costUsd > 0 ? task.costUsd : costUsd,
      repairLoops: task.ticket.repairCount,
    };
  });

  const totalCostUsd = entries.reduce((sum, e) => sum + e.costUsd, 0);
  const totalTokens = entries.reduce((sum, e) => sum + e.totalTokens, 0);

  const costByTier: Record<ModelTier, number> = { A: 0, B: 0, C: 0 };
  const tokensByTier: Record<ModelTier, number> = { A: 0, B: 0, C: 0 };

  for (const entry of entries) {
    costByTier[entry.tier] += entry.costUsd;
    tokensByTier[entry.tier] += entry.totalTokens;
  }

  const topCostlyTickets = [...entries]
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 10);

  const base = {
    entries,
    totalCostUsd,
    totalTokens,
    costByTier,
    tokensByTier,
    topCostlyTickets,
  };

  return budgetSnapshot !== undefined
    ? { ...base, budgetSnapshot }
    : base;
}

export function formatCostReport(report: CostReport): string {
  const lines: string[] = [
    "## Cost Report",
    "",
    `Total cost:    $${report.totalCostUsd.toFixed(4)}`,
    `Total tokens:  ${report.totalTokens.toLocaleString()}`,
    "",
    "### Cost by Tier",
    `  Tier A: $${report.costByTier.A.toFixed(4)} (${report.tokensByTier.A.toLocaleString()} tokens)`,
    `  Tier B: $${report.costByTier.B.toFixed(4)} (${report.tokensByTier.B.toLocaleString()} tokens)`,
    `  Tier C: $${report.costByTier.C.toFixed(4)} (${report.tokensByTier.C.toLocaleString()} tokens)`,
    "",
    "### Top Costly Tickets",
    ...report.topCostlyTickets.map(
      (e) =>
        `  [${e.tier}] ${e.title.slice(0, 50).padEnd(50)} $${e.costUsd.toFixed(4)} (${e.repairLoops} repairs)`
    ),
  ];

  if (report.budgetSnapshot) {
    const snap = report.budgetSnapshot;
    lines.push(
      "",
      "### Budget",
      `  Remaining: $${snap.remainingBudgetUsd.toFixed(4)}`,
      `  Over budget: ${snap.isOverBudget ? "YES ⚠️" : "No"}`
    );
  }

  return lines.join("\n");
}
