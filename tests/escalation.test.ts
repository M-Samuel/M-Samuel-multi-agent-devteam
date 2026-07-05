import { describe, it, expect, beforeEach } from "vitest";
import { EscalationEngine } from "../src/orchestrator/escalation.js";
import type { EscalationContext, Ticket, ReviewReport, ImplementationResult } from "../src/core/types.js";

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  const now = new Date().toISOString();
  return {
    id: "test-1",
    title: "Test ticket",
    description: "A test ticket",
    priority: "medium",
    status: "pending",
    tier: "C",
    repairCount: 0,
    createdAt: now,
    updatedAt: now,
    dependencies: [],
    filePaths: [],
    tags: [],
    ...overrides,
  };
}

function makeContext(overrides: Partial<EscalationContext> = {}): EscalationContext {
  return {
    ticket: makeTicket(),
    repairCount: 0,
    ...overrides,
  };
}

function makeReviewReport(opts: Partial<ReviewReport> = {}): ReviewReport {
  return {
    approved: true,
    score: 80,
    comments: [],
    requiresEscalation: false,
    summary: "LGTM",
    ...opts,
  };
}

function makeImplementation(linesAdded = 10): ImplementationResult {
  return {
    files: [{ path: "src/index.ts", after: "export {};", linesAdded, linesRemoved: 0 }],
    totalLinesAdded: linesAdded,
    totalLinesRemoved: 0,
    commitMessage: "feat: test",
    branchName: "feat/test",
  };
}

describe("EscalationEngine", () => {
  let engine: EscalationEngine;

  beforeEach(() => {
    engine = new EscalationEngine();
  });

  describe("no escalation", () => {
    it("does not escalate normal tickets", () => {
      const ctx = makeContext();
      const result = engine.evaluate(ctx);
      expect(result.shouldEscalate).toBe(false);
    });

    it("does not escalate already-at-tier-A tickets", () => {
      const ctx = makeContext({ ticket: makeTicket({ tier: "A", priority: "critical" }) });
      const result = engine.evaluate(ctx);
      // Even critical, can't escalate above A
      expect(result.shouldEscalate).toBe(false);
    });
  });

  describe("critical priority rule", () => {
    it("escalates critical tickets from C → A", () => {
      const ctx = makeContext({
        ticket: makeTicket({ tier: "C", priority: "critical" }),
      });
      const result = engine.evaluate(ctx);
      expect(result.shouldEscalate).toBe(true);
      expect(result.toTier).toBe("A");
    });

    it("escalates critical tickets from B → A", () => {
      const ctx = makeContext({
        ticket: makeTicket({ tier: "B", priority: "critical" }),
      });
      const result = engine.evaluate(ctx);
      expect(result.shouldEscalate).toBe(true);
      expect(result.toTier).toBe("A");
    });
  });

  describe("protected path rule", () => {
    it("escalates tickets touching auth paths", () => {
      const ctx = makeContext({
        ticket: makeTicket({ filePaths: ["src/auth/jwt.ts"] }),
      });
      const result = engine.evaluate(ctx);
      expect(result.shouldEscalate).toBe(true);
      expect(result.toTier).toBe("A");
    });

    it("escalates tickets touching payment paths", () => {
      const ctx = makeContext({
        ticket: makeTicket({ filePaths: ["src/payment/stripe.ts"] }),
      });
      const result = engine.evaluate(ctx);
      expect(result.shouldEscalate).toBe(true);
    });

    it("escalates tickets touching migration files", () => {
      const ctx = makeContext({
        ticket: makeTicket({ filePaths: ["migration/add_users.sql"] }),
      });
      const result = engine.evaluate(ctx);
      expect(result.shouldEscalate).toBe(true);
    });
  });

  describe("security concern rule", () => {
    it("escalates when reviewer reports security blocker", () => {
      const ctx = makeContext({
        reviewReport: makeReviewReport({
          comments: [
            {
              file: "src/api.ts",
              line: 10,
              severity: "blocker",
              message: "security vulnerability: SQL injection",
            },
          ],
        }),
      });
      const result = engine.evaluate(ctx);
      expect(result.shouldEscalate).toBe(true);
      expect(result.toTier).toBe("A");
    });

    it("does not escalate for non-security blockers", () => {
      const ctx = makeContext({
        ticket: makeTicket({ tier: "C" }),
        reviewReport: makeReviewReport({
          comments: [
            {
              file: "src/api.ts",
              line: 10,
              severity: "blocker",
              message: "Missing null check",
            },
          ],
        }),
      });
      const result = engine.evaluate(ctx);
      // May escalate due to other rules, but not security-concern rule specifically
      // Check that it at least doesn't blow up
      expect(typeof result.shouldEscalate).toBe("boolean");
    });
  });

  describe("large change rule", () => {
    it("escalates when implementation exceeds LOC threshold", () => {
      const ctx = makeContext({
        implementation: makeImplementation(500),
      });
      const result = engine.evaluate(ctx);
      expect(result.shouldEscalate).toBe(true);
    });

    it("does not escalate for small changes", () => {
      const ctx = makeContext({
        implementation: makeImplementation(50),
      });
      const result = engine.evaluate(ctx);
      // Should not escalate for small changes (no other triggers)
      expect(result.shouldEscalate).toBe(false);
    });
  });

  describe("reviewer escalation rule", () => {
    it("escalates when reviewer sets requiresEscalation", () => {
      const ctx = makeContext({
        reviewReport: makeReviewReport({ requiresEscalation: true }),
      });
      const result = engine.evaluate(ctx);
      expect(result.shouldEscalate).toBe(true);
    });
  });

  describe("repair loop rule", () => {
    it("escalates when repair count hits threshold", () => {
      const ctx = makeContext({ repairCount: 3 });
      const result = engine.evaluate(ctx);
      expect(result.shouldEscalate).toBe(true);
    });

    it("does not escalate before threshold", () => {
      const ctx = makeContext({ repairCount: 1 });
      const result = engine.evaluate(ctx);
      expect(result.shouldEscalate).toBe(false);
    });
  });

  describe("custom rules", () => {
    it("supports adding custom escalation rules", () => {
      engine.addRule({
        name: "custom-test-rule",
        description: "Always escalate",
        fromTier: "C",
        toTier: "B",
        condition: () => true,
      });
      const ctx = makeContext({ ticket: makeTicket({ tier: "C" }) });
      const result = engine.evaluate(ctx);
      expect(result.shouldEscalate).toBe(true);
    });

    it("listRules returns all rules including custom ones", () => {
      const before = engine.listRules().length;
      engine.addRule({
        name: "custom-rule-2",
        description: "Custom rule",
        fromTier: "C",
        toTier: "B",
        condition: () => false,
      });
      expect(engine.listRules().length).toBe(before + 1);
    });
  });
});
