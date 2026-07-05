import { describe, it, expect, beforeEach } from "vitest";
import { StateMachine } from "../src/orchestrator/state-machine.js";
import { Router } from "../src/orchestrator/router.js";
import { EscalationEngine } from "../src/orchestrator/escalation.js";
import type { Ticket, TestReport, ReviewReport, ImplementationResult } from "../src/core/types.js";

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

function makeTestReport(passed: boolean): TestReport {
  return {
    passed,
    total: 5,
    passed_count: passed ? 5 : 4,
    failed_count: passed ? 0 : 1,
    skipped_count: 0,
    cases: [],
    durationMs: 100,
    output: passed ? "All tests passed" : "1 test failed",
  };
}

function makeReviewReport(approved: boolean, requiresEscalation = false): ReviewReport {
  return {
    approved,
    score: approved ? 85 : 40,
    comments: [],
    requiresEscalation,
    summary: approved ? "LGTM" : "Needs work",
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

describe("StateMachine", () => {
  let sm: StateMachine;

  beforeEach(() => {
    sm = new StateMachine(new Router(), new EscalationEngine());
  });

  describe("pending → planning", () => {
    it("transitions pending to planning", () => {
      const ticket = makeTicket({ status: "pending" });
      const result = sm.transition({ ticket });
      expect(result.nextStatus).toBe("planning");
    });
  });

  describe("planning → implementing", () => {
    it("transitions planning to implementing", () => {
      const ticket = makeTicket({ status: "planning" });
      const result = sm.transition({ ticket });
      expect(result.nextStatus).toBe("implementing");
    });
  });

  describe("implementing → testing", () => {
    it("transitions to testing when implementation succeeds", () => {
      const ticket = makeTicket({ status: "implementing" });
      const result = sm.transition({ ticket, implementation: makeImplementation() });
      expect(result.nextStatus).toBe("testing");
    });

    it("fails when no implementation provided", () => {
      const ticket = makeTicket({ status: "implementing" });
      const result = sm.transition({ ticket });
      expect(result.nextStatus).toBe("failed");
    });

    it("escalates when LOC threshold exceeded", () => {
      const ticket = makeTicket({ status: "implementing", tier: "C" });
      const bigImpl = makeImplementation(500); // > 400 LOC threshold
      const result = sm.transition({ ticket, implementation: bigImpl });
      expect(result.nextStatus).toBe("escalated");
      expect(result.shouldEscalate).toBe(true);
      expect(result.nextTier).toBe("B");
    });
  });

  describe("testing → reviewing", () => {
    it("moves to reviewing when tests pass", () => {
      const ticket = makeTicket({ status: "testing" });
      const result = sm.transition({ ticket, testReport: makeTestReport(true) });
      expect(result.nextStatus).toBe("reviewing");
    });

    it("sends back to implementing on test failure (within repair budget)", () => {
      const ticket = makeTicket({ status: "testing", repairCount: 0 });
      const result = sm.transition({ ticket, testReport: makeTestReport(false) });
      expect(result.nextStatus).toBe("implementing");
      expect(result.shouldRepair).toBe(true);
    });

    it("escalates after max repair loops", () => {
      const ticket = makeTicket({ status: "testing", tier: "C", repairCount: 3 });
      const result = sm.transition({ ticket, testReport: makeTestReport(false) });
      expect(result.nextStatus).toBe("escalated");
      expect(result.shouldEscalate).toBe(true);
    });

    it("fails when already at Tier A and tests fail", () => {
      const ticket = makeTicket({ status: "testing", tier: "A", repairCount: 3 });
      const result = sm.transition({ ticket, testReport: makeTestReport(false) });
      expect(result.nextStatus).toBe("failed");
    });

    it("fails when no test report", () => {
      const ticket = makeTicket({ status: "testing" });
      const result = sm.transition({ ticket });
      expect(result.nextStatus).toBe("failed");
    });
  });

  describe("reviewing → merging", () => {
    it("moves to merging when review is approved", () => {
      const ticket = makeTicket({ status: "reviewing" });
      const result = sm.transition({
        ticket,
        reviewReport: makeReviewReport(true),
        testReport: makeTestReport(true),
      });
      expect(result.nextStatus).toBe("merging");
    });

    it("sends back to implementing when review rejects (within budget)", () => {
      const ticket = makeTicket({ status: "reviewing", repairCount: 0 });
      const result = sm.transition({
        ticket,
        reviewReport: makeReviewReport(false),
        testReport: makeTestReport(true),
      });
      expect(result.nextStatus).toBe("implementing");
      expect(result.shouldRepair).toBe(true);
    });

    it("escalates when reviewer requests it", () => {
      const ticket = makeTicket({ status: "reviewing", tier: "C" });
      const result = sm.transition({
        ticket,
        reviewReport: makeReviewReport(false, true),
        testReport: makeTestReport(true),
      });
      expect(result.shouldEscalate).toBe(true);
      expect(result.nextTier).toBe("B");
    });

    it("fails when review rejected and repair budget exhausted", () => {
      const ticket = makeTicket({ status: "reviewing", repairCount: 3 });
      const result = sm.transition({
        ticket,
        reviewReport: makeReviewReport(false),
        testReport: makeTestReport(true),
      });
      expect(result.nextStatus).toBe("failed");
    });
  });

  describe("merging → done", () => {
    it("transitions merging to done", () => {
      const ticket = makeTicket({ status: "merging" });
      const result = sm.transition({ ticket });
      expect(result.nextStatus).toBe("done");
    });
  });

  describe("terminal states", () => {
    it("done stays done", () => {
      const ticket = makeTicket({ status: "done" });
      const result = sm.transition({ ticket });
      expect(result.nextStatus).toBe("done");
    });

    it("failed stays failed", () => {
      const ticket = makeTicket({ status: "failed" });
      const result = sm.transition({ ticket });
      expect(result.nextStatus).toBe("failed");
    });
  });

  describe("escalated state", () => {
    it("resumes implementing after escalation", () => {
      const ticket = makeTicket({ status: "escalated", tier: "B" });
      const result = sm.transition({ ticket });
      expect(result.nextStatus).toBe("implementing");
    });
  });
});
