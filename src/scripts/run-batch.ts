#!/usr/bin/env tsx
/**
 * run-batch.ts — Batch ticket processor
 *
 * Usage:
 *   npx tsx src/scripts/run-batch.ts --request "Add user management system" [--mock]
 *   npx tsx src/scripts/run-batch.ts --tickets-file tickets.json [--mock]
 */

import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import type { Budget, ModelTier, Ticket } from "../core/types.js";
import { PlannerAgent } from "../agents/planner-agent.js";
import { ImplementerAgent } from "../agents/implementer-agent.js";
import { TesterAgent } from "../agents/tester-agent.js";
import { ReviewerAgent } from "../agents/reviewer-agent.js";
import { MergerAgent } from "../agents/merger-agent.js";
import { Router } from "../orchestrator/router.js";
import { EscalationEngine } from "../orchestrator/escalation.js";
import { BudgetTracker } from "../orchestrator/budget.js";
import { DagEngine } from "../orchestrator/dag.js";
import { TaskStore } from "../memory/task-store.js";
import { Artifacts } from "../memory/artifacts.js";
import { TestRunner } from "../tools/test-runner.js";
import { LintTool } from "../tools/lint-tool.js";
import { TypeCheckTool } from "../tools/typecheck-tool.js";
import { SecurityScanner } from "../tools/security-scanner.js";
import { computeMetrics, formatMetricsReport } from "../eval/metrics.js";
import { buildCostReport, formatCostReport } from "../eval/cost-report.js";

// ──────────────────────────────────────────────
// Parse CLI args
// ──────────────────────────────────────────────

function parseArgs(): {
  request?: string;
  ticketsFile?: string;
  mock: boolean;
  maxConcurrent: number;
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const result: { request?: string; ticketsFile?: string; mock: boolean; maxConcurrent: number } = {
    mock: args.includes("--mock"),
    maxConcurrent: parseInt(get("--concurrent") ?? "3", 10),
  };

  const request = get("--request");
  if (request !== undefined) result.request = request;

  const ticketsFile = get("--tickets-file");
  if (ticketsFile !== undefined) result.ticketsFile = ticketsFile;

  return result;
}

// ──────────────────────────────────────────────
// Process a single ticket
// ──────────────────────────────────────────────

async function processTicket(
  ticket: Ticket,
  budget: Budget,
  budgetTracker: BudgetTracker,
  taskStore: TaskStore,
  artifacts: Artifacts,
  mock: boolean
): Promise<{ success: boolean; error?: string }> {
  const testRunner = new TestRunner(process.cwd(), mock);
  const lintTool = new LintTool(process.cwd(), mock);
  const typeCheckTool = new TypeCheckTool(process.cwd(), mock);
  const securityScanner = new SecurityScanner(process.cwd(), mock);

  const implementer = new ImplementerAgent(ticket.tier, budget);
  const tester = new TesterAgent(
    ticket.tier,
    budget,
    testRunner,
    lintTool,
    typeCheckTool,
    securityScanner
  );
  const reviewer = new ReviewerAgent(ticket.tier, budget);
  const merger = new MergerAgent("C", budget);

  let task = TaskStore.createTask(ticket);
  await taskStore.save(task);

  try {
    await artifacts.log(ticket.id, `Starting ticket: ${ticket.title}`);

    // Implementation
    ticket.status = "implementing";
    const implResult = await implementer.run({ ticket });
    budgetTracker.record(ticket.tier, implResult.tokenUsage);

    if (!implResult.success || !implResult.data) {
      ticket.status = "failed";
      await taskStore.save(task);
      const res: { success: boolean; error?: string } = { success: false };
      if (implResult.error !== undefined) res.error = implResult.error;
      return res;
    }

    task.implementation = implResult.data;
    task.tokenUsageByStage["implementation"] = implResult.tokenUsage;

    // Testing
    ticket.status = "testing";
    const testerResult = await tester.runQualityGates({
      ticket,
      implementation: implResult.data,
    });
    task.testReport = testerResult.testReport;
    await artifacts.saveReport(ticket.id, "test", testerResult.testReport);

    // Review
    ticket.status = "reviewing";
    const reviewResult = await reviewer.run({
      ticket,
      implementation: implResult.data,
      testReport: testerResult.testReport,
    });
    budgetTracker.record(ticket.tier, reviewResult.tokenUsage);

    if (!reviewResult.success || !reviewResult.data) {
      ticket.status = "failed";
      await taskStore.save(task);
      const res: { success: boolean; error?: string } = { success: false };
      if (reviewResult.error !== undefined) res.error = reviewResult.error;
      return res;
    }

    task.reviewReport = reviewResult.data;
    task.tokenUsageByStage["review"] = reviewResult.tokenUsage;
    await artifacts.saveReport(ticket.id, "review", reviewResult.data);

    // Merge
    if (reviewResult.data.approved) {
      ticket.status = "merging";
      const mergeResult = await merger.run({
        ticket,
        implementation: implResult.data,
        reviewReport: reviewResult.data,
      });
      budgetTracker.record("C", mergeResult.tokenUsage);

      if (mergeResult.success && mergeResult.data) {
        task.mergerOutput = mergeResult.data;
        ticket.status = "done";
      }
    } else {
      ticket.status = "failed";
    }

    ticket.updatedAt = new Date().toISOString();
    task.costUsd = budgetTracker.totalCostUsd;
    await taskStore.save(task);
    await artifacts.saveTaskSummary(task);

    return { success: ticket.status === "done" };
  } catch (err) {
    ticket.status = "failed";
    ticket.updatedAt = new Date().toISOString();
    await taskStore.save(task);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  const { request, ticketsFile, mock, maxConcurrent } = parseArgs();

  const budget: Budget = {
    maxTokensPerTier: { A: 100_000, B: 50_000, C: 20_000 },
    maxCostUsd: 20,
    maxRepairLoops: 3,
  };

  const budgetTracker = new BudgetTracker(budget.maxCostUsd);
  const router = new Router();
  const taskStore = new TaskStore();
  const artifacts = new Artifacts();

  let tickets: Ticket[] = [];

  // ── Load or plan tickets ───────────────────────
  if (ticketsFile) {
    const raw = await readFile(ticketsFile, "utf8");
    const parsed = JSON.parse(raw) as Ticket[];
    tickets = parsed;
    console.log(`📂 Loaded ${tickets.length} tickets from ${ticketsFile}`);
  } else if (request) {
    console.log("📋 Planning tickets...");
    const planner = new PlannerAgent("A", budget);
    const planResult = await planner.run({ request });
    budgetTracker.record("A", planResult.tokenUsage);

    if (!planResult.success || !planResult.data) {
      console.error("❌ Planning failed:", planResult.error);
      process.exit(1);
    }

    const now = new Date().toISOString();
    tickets = planResult.data.tickets.map((t) => ({
      id: randomUUID(),
      status: "pending" as const,
      tier: router.selectTier({
        id: "tmp",
        title: t.title,
        description: t.description,
        priority: t.priority,
        status: "pending",
        tier: "C",
        repairCount: 0,
        createdAt: now,
        updatedAt: now,
        dependencies: t.dependencies,
        filePaths: t.filePaths,
        tags: t.tags,
      }).tier,
      repairCount: 0,
      createdAt: now,
      updatedAt: now,
      ...t,
    }));

    console.log(`   ✅ ${tickets.length} tickets planned`);
    console.log(`   📝 ${planResult.data.summary}`);
  } else {
    console.error("Error: provide --request or --tickets-file");
    process.exit(1);
  }

  // ── Build DAG ──────────────────────────────────
  const dag = DagEngine.fromTicketDependencies(
    tickets.map((t) => ({ id: t.id, dependencies: t.dependencies }))
  );
  const plan = dag.getExecutionPlan();
  console.log(`\n🗂️  Execution plan (${plan.length} tickets):`);
  for (const id of plan) {
    const t = tickets.find((t) => t.id === id);
    console.log(`   [${t?.tier ?? "?"}] ${t?.title ?? id}`);
  }

  // ── Execute ─────────────────────────────────────
  console.log(`\n🚀 Processing up to ${maxConcurrent} tickets concurrently...\n`);

  const ticketMap = new Map(tickets.map((t) => [t.id, t]));
  const results = new Map<string, { success: boolean; error?: string }>();

  // Process in topological order, respecting concurrency
  let processed = 0;
  const inFlight = new Set<string>();
  const completed = new Set<string>();

  while (processed < tickets.length) {
    // Find ready tickets
    const ready = tickets.filter((t) => {
      if (completed.has(t.id) || inFlight.has(t.id)) return false;
      return t.dependencies.every((dep) => completed.has(dep));
    });

    if (ready.length === 0 && inFlight.size === 0) break;

    const toRun = ready.slice(0, maxConcurrent - inFlight.size);
    for (const ticket of toRun) {
      inFlight.add(ticket.id);
    }

    await Promise.all(
      toRun.map(async (ticket) => {
        console.log(`⚙️  [${ticket.tier}] ${ticket.title}`);
        const result = await processTicket(
          ticket,
          budget,
          budgetTracker,
          taskStore,
          artifacts,
          mock
        );
        results.set(ticket.id, result);
        inFlight.delete(ticket.id);
        completed.add(ticket.id);
        processed++;
        const icon = result.success ? "✅" : "❌";
        console.log(`${icon} [${ticket.tier}] ${ticket.title}${result.error ? ` — ${result.error}` : ""}`);
      })
    );
  }

  // ── Reports ────────────────────────────────────
  const allTasks = await taskStore.list();
  const metrics = computeMetrics(allTasks);
  const costReport = buildCostReport(allTasks, budgetTracker.snapshot());

  console.log("\n" + formatMetricsReport(metrics));
  console.log("\n" + formatCostReport(costReport));
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
