import type { ModelTier, Ticket, TicketStatus } from "../core/types.js";
import type { Router } from "./router.js";
import type { EscalationEngine } from "./escalation.js";
import type {
  TestReport,
  ReviewReport,
  ImplementationResult,
} from "../core/types.js";

// ──────────────────────────────────────────────
// Transition input
// ──────────────────────────────────────────────

export interface TransitionInput {
  ticket: Ticket;
  testReport?: TestReport;
  reviewReport?: ReviewReport;
  implementation?: ImplementationResult;
}

// ──────────────────────────────────────────────
// Transition result
// ──────────────────────────────────────────────

export interface TransitionResult {
  nextStatus: TicketStatus;
  nextTier: ModelTier;
  shouldEscalate: boolean;
  shouldRepair: boolean;
  reason: string;
}

// ──────────────────────────────────────────────
// State Machine
// ──────────────────────────────────────────────

export class StateMachine {
  private readonly router: Router;
  private readonly escalationEngine: EscalationEngine;

  constructor(router: Router, escalationEngine: EscalationEngine) {
    this.router = router;
    this.escalationEngine = escalationEngine;
  }

  transition(input: TransitionInput): TransitionResult {
    const { ticket, testReport, reviewReport, implementation } = input;

    switch (ticket.status) {
      case "pending":
        return this.fromPending(ticket);

      case "planning":
        return this.fromPlanning(ticket);

      case "implementing":
        return this.fromImplementing(ticket, implementation);

      case "testing":
        return this.fromTesting(ticket, testReport);

      case "reviewing":
        return this.fromReviewing(ticket, reviewReport, testReport, implementation);

      case "merging":
        return this.fromMerging(ticket);

      case "done":
      case "failed":
        return {
          nextStatus: ticket.status,
          nextTier: ticket.tier,
          shouldEscalate: false,
          shouldRepair: false,
          reason: `Terminal state: ${ticket.status}`,
        };

      case "escalated":
        return this.fromEscalated(ticket);

      default: {
        const _exhaustive: never = ticket.status;
        throw new Error(`Unknown status: ${String(_exhaustive)}`);
      }
    }
  }

  // ──────────────────────────────────────────────
  // State handlers
  // ──────────────────────────────────────────────

  private fromPending(ticket: Ticket): TransitionResult {
    return {
      nextStatus: "planning",
      nextTier: ticket.tier,
      shouldEscalate: false,
      shouldRepair: false,
      reason: "Starting planning phase",
    };
  }

  private fromPlanning(ticket: Ticket): TransitionResult {
    return {
      nextStatus: "implementing",
      nextTier: ticket.tier,
      shouldEscalate: false,
      shouldRepair: false,
      reason: "Planning complete, beginning implementation",
    };
  }

  private fromImplementing(
    ticket: Ticket,
    implementation: ImplementationResult | undefined
  ): TransitionResult {
    // Check if implementation needs to go to testing
    if (!implementation) {
      return {
        nextStatus: "failed",
        nextTier: ticket.tier,
        shouldEscalate: false,
        shouldRepair: false,
        reason: "Implementation produced no output",
      };
    }

    // Check LOC threshold for escalation
    if (
      implementation.totalLinesAdded > this.router.locThreshold &&
      ticket.tier !== "A"
    ) {
      const nextTier = this.router.escalate(ticket.tier);
      if (nextTier) {
        return {
          nextStatus: "escalated",
          nextTier,
          shouldEscalate: true,
          shouldRepair: false,
          reason: `LOC threshold exceeded (${implementation.totalLinesAdded} > ${this.router.locThreshold})`,
        };
      }
    }

    return {
      nextStatus: "testing",
      nextTier: ticket.tier,
      shouldEscalate: false,
      shouldRepair: false,
      reason: "Implementation complete, beginning testing",
    };
  }

  private fromTesting(
    ticket: Ticket,
    testReport: TestReport | undefined
  ): TransitionResult {
    if (!testReport) {
      return {
        nextStatus: "failed",
        nextTier: ticket.tier,
        shouldEscalate: false,
        shouldRepair: false,
        reason: "No test report produced",
      };
    }

    if (testReport.passed) {
      return {
        nextStatus: "reviewing",
        nextTier: ticket.tier,
        shouldEscalate: false,
        shouldRepair: false,
        reason: "Tests passed, moving to review",
      };
    }

    // Tests failed — check if we should repair or escalate
    if (ticket.repairCount >= this.router.maxRepairLoops) {
      // Escalate
      const nextTier = this.router.escalate(ticket.tier);
      if (nextTier) {
        return {
          nextStatus: "escalated",
          nextTier,
          shouldEscalate: true,
          shouldRepair: false,
          reason: `Repair loops exhausted (${ticket.repairCount}/${this.router.maxRepairLoops}), escalating to tier ${nextTier}`,
        };
      }
      // Already at top tier, fail
      return {
        nextStatus: "failed",
        nextTier: ticket.tier,
        shouldEscalate: false,
        shouldRepair: false,
        reason: "Tests failed and already at tier A — marking as failed",
      };
    }

    return {
      nextStatus: "implementing",
      nextTier: ticket.tier,
      shouldEscalate: false,
      shouldRepair: true,
      reason: `Tests failed (${testReport.failed_count} failures), repair loop ${ticket.repairCount + 1}`,
    };
  }

  private fromReviewing(
    ticket: Ticket,
    reviewReport: ReviewReport | undefined,
    testReport: TestReport | undefined,
    implementation: ImplementationResult | undefined
  ): TransitionResult {
    if (!reviewReport) {
      return {
        nextStatus: "failed",
        nextTier: ticket.tier,
        shouldEscalate: false,
        shouldRepair: false,
        reason: "No review report produced",
      };
    }

    if (reviewReport.requiresEscalation && ticket.tier !== "A") {
      const nextTier = this.router.escalate(ticket.tier);
      if (nextTier) {
        return {
          nextStatus: "escalated",
          nextTier,
          shouldEscalate: true,
          shouldRepair: false,
          reason: reviewReport.escalationReason ?? "Reviewer requested escalation",
        };
      }
    }

    if (reviewReport.approved) {
      // Check escalation rules engine before approving (security, protected paths, etc.)
      const escalationResult = this.escalationEngine.evaluate({
        ticket,
        repairCount: ticket.repairCount,
        ...(testReport !== undefined ? { testReport } : {}),
        ...(reviewReport !== undefined ? { reviewReport } : {}),
        ...(implementation !== undefined ? { implementation } : {}),
      });

      if (escalationResult.shouldEscalate && ticket.tier !== "A") {
        // Honour the explicit target tier from the escalation rule when present;
        // fall back to a single-step escalation if no target is specified.
        const nextTier =
          escalationResult.toTier ?? this.router.escalate(ticket.tier);
        if (nextTier) {
          return {
            nextStatus: "escalated",
            nextTier,
            shouldEscalate: true,
            shouldRepair: false,
            reason: escalationResult.reason,
          };
        }
      }

      return {
        nextStatus: "merging",
        nextTier: ticket.tier,
        shouldEscalate: false,
        shouldRepair: false,
        reason: "Review approved, proceeding to merge",
      };
    }

    // Not approved — send back for repair if budget allows
    if (ticket.repairCount < this.router.maxRepairLoops) {
      return {
        nextStatus: "implementing",
        nextTier: ticket.tier,
        shouldEscalate: false,
        shouldRepair: true,
        reason: "Review rejected, sending back for repair",
      };
    }

    return {
      nextStatus: "failed",
      nextTier: ticket.tier,
      shouldEscalate: false,
      shouldRepair: false,
      reason: "Review rejected and repair budget exhausted",
    };
  }

  private fromMerging(ticket: Ticket): TransitionResult {
    return {
      nextStatus: "done",
      nextTier: ticket.tier,
      shouldEscalate: false,
      shouldRepair: false,
      reason: "Merge complete",
    };
  }

  private fromEscalated(ticket: Ticket): TransitionResult {
    // After escalation, restart from implementing with new tier
    return {
      nextStatus: "implementing",
      nextTier: ticket.tier, // tier was already updated by the orchestrator
      shouldEscalate: false,
      shouldRepair: true,
      reason: `Resuming implementation at tier ${ticket.tier} after escalation`,
    };
  }
}
