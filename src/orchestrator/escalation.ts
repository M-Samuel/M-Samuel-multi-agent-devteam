import type {
  EscalationContext,
  EscalationRule,
  ModelTier,
} from "../core/types.js";

// ──────────────────────────────────────────────
// Escalation result
// ──────────────────────────────────────────────

export interface EscalationResult {
  shouldEscalate: boolean;
  toTier?: ModelTier;
  ruleName?: string;
  reason: string;
}

// ──────────────────────────────────────────────
// Built-in rules
// ──────────────────────────────────────────────

const PROTECTED_PATH_RULE: EscalationRule = {
  name: "protected-path",
  description: "Escalate when implementation touches protected paths",
  fromTier: "C",
  toTier: "A",
  condition: (ctx) => {
    const protectedPatterns = [
      /\/auth\//,
      /\/payments?\//,
      /(^|\/)migration(s)?\//,
      /\.secret\./,
      /\/\.env/,
    ];
    const paths = ctx.ticket.filePaths;
    return paths.some((p) =>
      protectedPatterns.some((pattern) => pattern.test(p))
    );
  },
};

const LARGE_CHANGE_RULE: EscalationRule = {
  name: "large-change",
  description: "Escalate for large implementations (>400 LOC)",
  fromTier: "C",
  toTier: "B",
  condition: (ctx) => {
    const loc = ctx.implementation?.totalLinesAdded ?? 0;
    return loc > 400;
  },
};

const REVIEWER_ESCALATION_RULE: EscalationRule = {
  name: "reviewer-escalation",
  description: "Escalate when reviewer explicitly requests it",
  fromTier: "C",
  toTier: "B",
  condition: (ctx) => ctx.reviewReport?.requiresEscalation === true,
};

const SECURITY_CONCERN_RULE: EscalationRule = {
  name: "security-concern",
  description: "Escalate when review identifies security blockers",
  fromTier: "C",
  toTier: "A",
  condition: (ctx) => {
    const blockers = ctx.reviewReport?.comments.filter(
      (c) => c.severity === "blocker" && c.message.toLowerCase().includes("security")
    );
    return (blockers?.length ?? 0) > 0;
  },
};

const CRITICAL_TICKET_RULE: EscalationRule = {
  name: "critical-priority",
  description: "Critical tickets always run at Tier A",
  fromTier: "C",
  toTier: "A",
  condition: (ctx) => ctx.ticket.priority === "critical",
};

// ──────────────────────────────────────────────
// Escalation Engine
// ──────────────────────────────────────────────

export class EscalationEngine {
  private rules: EscalationRule[];

  constructor(additionalRules: EscalationRule[] = [], maxRepairLoops = 3) {
    const repairLoopRule: EscalationRule = {
      name: "repair-loop-exhausted",
      description: "Escalate when max repair loops reached on current tier",
      fromTier: "C",
      toTier: "B",
      condition: (ctx) => ctx.repairCount >= maxRepairLoops,
    };

    this.rules = [
      CRITICAL_TICKET_RULE,
      PROTECTED_PATH_RULE,
      SECURITY_CONCERN_RULE,
      LARGE_CHANGE_RULE,
      REVIEWER_ESCALATION_RULE,
      repairLoopRule,
      ...additionalRules,
    ];
  }

  evaluate(context: EscalationContext): EscalationResult {
    const currentTier = context.ticket.tier;

    for (const rule of this.rules) {
      if (rule.condition(context)) {
        // Only escalate if the rule applies to the current tier
        // or if the target tier is higher than current
        const tierOrder: Record<ModelTier, number> = { C: 0, B: 1, A: 2 };
        const currentOrder = tierOrder[currentTier];
        const targetOrder = tierOrder[rule.toTier];

        if (targetOrder > currentOrder) {
          return {
            shouldEscalate: true,
            toTier: rule.toTier,
            ruleName: rule.name,
            reason: rule.description,
          };
        }
      }
    }

    return { shouldEscalate: false, reason: "No escalation required" };
  }

  addRule(rule: EscalationRule): void {
    this.rules.push(rule);
  }

  listRules(): EscalationRule[] {
    return [...this.rules];
  }
}
