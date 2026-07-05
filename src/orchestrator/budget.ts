import type { ModelTier, TokenUsage } from "../core/types.js";

// ──────────────────────────────────────────────
// Cost per-tier record
// ──────────────────────────────────────────────

export interface TierCostRecord {
  tier: ModelTier;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface BudgetSnapshot {
  totalTokens: number;
  totalCostUsd: number;
  byTier: Record<ModelTier, TierCostRecord>;
  remainingBudgetUsd: number;
  isOverBudget: boolean;
}

// ──────────────────────────────────────────────
// Pricing config
// ──────────────────────────────────────────────

export interface TierPricing {
  costPer1kInput: number; // USD per 1k prompt tokens
  costPer1kOutput: number; // USD per 1k completion tokens
}

const DEFAULT_PRICING: Record<ModelTier, TierPricing> = {
  A: { costPer1kInput: 0.01, costPer1kOutput: 0.03 },
  B: { costPer1kInput: 0.001, costPer1kOutput: 0.002 },
  C: { costPer1kInput: 0.0005, costPer1kOutput: 0.0015 },
};

// ──────────────────────────────────────────────
// Budget Tracker
// ──────────────────────────────────────────────

export class BudgetTracker {
  private records: TierCostRecord[] = [];
  private readonly maxBudgetUsd: number;
  private readonly pricing: Record<ModelTier, TierPricing>;

  constructor(
    maxBudgetUsd = 10,
    pricing: Partial<Record<ModelTier, TierPricing>> = {}
  ) {
    this.maxBudgetUsd = maxBudgetUsd;
    this.pricing = {
      A: pricing["A"] ?? DEFAULT_PRICING.A,
      B: pricing["B"] ?? DEFAULT_PRICING.B,
      C: pricing["C"] ?? DEFAULT_PRICING.C,
    };
  }

  // ──────────────────────────────────────────────
  // Record usage
  // ──────────────────────────────────────────────

  record(tier: ModelTier, usage: TokenUsage): void {
    const p = this.pricing[tier];
    const costUsd =
      (usage.promptTokens / 1000) * p.costPer1kInput +
      (usage.completionTokens / 1000) * p.costPer1kOutput;

    this.records.push({
      tier,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      costUsd,
    });
  }

  // ──────────────────────────────────────────────
  // Snapshot
  // ──────────────────────────────────────────────

  snapshot(): BudgetSnapshot {
    const tiers: ModelTier[] = ["A", "B", "C"];
    const byTier = Object.fromEntries(
      tiers.map((t) => [
        t,
        {
          tier: t,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        } satisfies TierCostRecord,
      ])
    ) as Record<ModelTier, TierCostRecord>;

    let totalTokens = 0;
    let totalCostUsd = 0;

    for (const rec of this.records) {
      const entry = byTier[rec.tier];
      entry.promptTokens += rec.promptTokens;
      entry.completionTokens += rec.completionTokens;
      entry.totalTokens += rec.totalTokens;
      entry.costUsd += rec.costUsd;
      totalTokens += rec.totalTokens;
      totalCostUsd += rec.costUsd;
    }

    return {
      totalTokens,
      totalCostUsd,
      byTier,
      remainingBudgetUsd: this.maxBudgetUsd - totalCostUsd,
      isOverBudget: totalCostUsd > this.maxBudgetUsd,
    };
  }

  // ──────────────────────────────────────────────
  // Guard
  // ──────────────────────────────────────────────

  assertUnderBudget(): void {
    const snap = this.snapshot();
    if (snap.isOverBudget) {
      throw new Error(
        `Budget exceeded: spent $${snap.totalCostUsd.toFixed(4)} / max $${this.maxBudgetUsd.toFixed(2)}`
      );
    }
  }

  get totalCostUsd(): number {
    return this.snapshot().totalCostUsd;
  }
}
