#!/usr/bin/env tsx
/**
 * run-ticket.ts — CLI driver for a single ticket
 *
 * Usage:
 *   npm run run:ticket -- --title "Add user endpoint" --description "..." [--tier C]
 */

import { randomUUID } from "crypto";
import type { Budget, Ticket, ModelTier } from "../core/types.js";
import { PlannerAgent } from "../agents/planner-agent.js";
import { ImplementerAgent } from "../agents/implementer-agent.js";
import { TesterAgent } from "../agents/tester-agent.js";
import { ReviewerAgent } from "../agents/reviewer-agent.js";
import { MergerAgent } from "../agents/merger-agent.js";
import { Router } from "../orchestrator/router.js";
import { StateMachine } from "../orchestrator/state-machine.js";
import { EscalationEngine } from "../orchestrator/escalation.js";
import { BudgetTracker } from "../orchestrator/budget.js";
import { TaskStore } from "../memory/task-store.js";
import { Artifacts } from "../memory/artifacts.js";
import { TestRunner } from "../tools/test-runner.js";
import { LintTool } from "../tools/lint-tool.js";
import { TypeCheckTool } from "../tools/typecheck-tool.js";
import { SecurityScanner } from "../tools/security-scanner.js";

// ──────────────────────────────────────────────
// Parse CLI args
// ──────────────────────────────────────────────

function parseArgs(): {
  title: string;
  description: string;
  tier: ModelTier;
  priority: Ticket["priority"];
  filePaths: string[];
  mock: boolean;
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const title = get("--title") ?? "Default ticket";
  const description = get("--description") ?? "Implement the requested feature.";
  const tier = (get("--tier") ?? "C") as ModelTier;
  const priority = (get("--priority") ?? "medium") as Ticket["priority"];
  const filePathsRaw = get("--files") ?? "";
  const filePaths = filePathsRaw ? filePathsRaw.split(",") : [];
  const mock = args.includes("--mock");

  return { title, description, tier, priority, filePaths, mock };
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  const { title, description, tier, priority, filePaths, mock } = parseArgs();

  const now = new Date().toISOString();
  const ticket: Ticket = {
    id: randomUUID(),
    title,
    description,
    priority,
    status: "pending",
    tier,
    repairCount: 0,
    createdAt: now,
    updatedAt: now,
    dependencies: [],
    filePaths,
    tags: [],
  };

  const budget: Budget = {
    maxTokensPerTier: { A: 100_000, B: 50_000, C: 20_000 },
    maxCostUsd: 5,
    maxRepairLoops: 3,
  };

  const budgetTracker = new BudgetTracker(budget.maxCostUsd);
  const router = new Router();
  const escalationEngine = new EscalationEngine();
  const stateMachine = new StateMachine(router, escalationEngine);
  const taskStore = new TaskStore();
  const artifacts = new Artifacts();

  // Tools (mock mode skips actual CLI calls)
  const testRunner = new TestRunner(process.cwd(), mock);
  const lintTool = new LintTool(process.cwd(), mock);
  const typeCheckTool = new TypeCheckTool(process.cwd(), mock);
  const securityScanner = new SecurityScanner(process.cwd(), mock);

  // Agents
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

  console.log(`\n🎫 Ticket: ${ticket.id}`);
  console.log(`   Title:  ${ticket.title}`);
  console.log(`   Tier:   ${ticket.tier}`);
  console.log(`   Mode:   ${mock ? "mock" : "live"}\n`);

  // ── Implementation ────────────────────────────
  console.log("⚙️  Running implementer...");
  const implResult = await implementer.run({ ticket });
  budgetTracker.record(ticket.tier, implResult.tokenUsage);

  if (!implResult.success || !implResult.data) {
    console.error("❌ Implementation failed:", implResult.error);
    process.exit(1);
  }

  task.implementation = implResult.data;
  task.tokenUsageByStage["implementation"] = implResult.tokenUsage;
  await taskStore.save(task);
  await artifacts.log(ticket.id, `Implementation complete: ${implResult.data.commitMessage}`);
  console.log(`   ✅ ${implResult.data.files.length} file(s) changed`);

  // ── Testing ───────────────────────────────────
  console.log("🧪 Running quality gates...");
  const testerResult = await tester.runQualityGates({
    ticket,
    implementation: implResult.data,
  });

  task.testReport = testerResult.testReport;
  await taskStore.save(task);
  await artifacts.saveReport(ticket.id, "test", testerResult.testReport);
  console.log(`   ${testerResult.allPassed ? "✅" : "❌"} ${testerResult.summary}`);

  if (!testerResult.allPassed) {
    console.warn("⚠️  Quality gates failed — in a full run this triggers repair loops");
  }

  // ── Review ────────────────────────────────────
  console.log("🔍 Running reviewer...");
  const reviewResult = await reviewer.run({
    ticket,
    implementation: implResult.data,
    testReport: testerResult.testReport,
  });
  budgetTracker.record(ticket.tier, reviewResult.tokenUsage);

  if (!reviewResult.success || !reviewResult.data) {
    console.error("❌ Review failed:", reviewResult.error);
    process.exit(1);
  }

  task.reviewReport = reviewResult.data;
  task.tokenUsageByStage["review"] = reviewResult.tokenUsage;
  await taskStore.save(task);
  await artifacts.saveReport(ticket.id, "review", reviewResult.data);
  console.log(
    `   ${reviewResult.data.approved ? "✅" : "❌"} Score: ${reviewResult.data.score}/100 — ${reviewResult.data.summary}`
  );

  // ── Merge ──────────────────────────────────────
  if (reviewResult.data.approved) {
    console.log("🚀 Running merger...");
    const mergeResult = await merger.run({
      ticket,
      implementation: implResult.data,
      reviewReport: reviewResult.data,
    });
    budgetTracker.record("C", mergeResult.tokenUsage);

    if (mergeResult.success && mergeResult.data) {
      task.mergerOutput = mergeResult.data;
      task.ticket.status = "done";
      await taskStore.save(task);
      await artifacts.saveTaskSummary(task);
      console.log(`   ✅ PR ready: ${mergeResult.data.prTitle}`);
    }
  } else {
    task.ticket.status = "failed";
    await taskStore.save(task);
  }

  // ── Summary ────────────────────────────────────
  const snap = budgetTracker.snapshot();
  console.log(
    `\n💰 Total cost: $${snap.totalCostUsd.toFixed(4)} / ${snap.totalTokens} tokens`
  );
  console.log(`🏁 Status: ${task.ticket.status}`);
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
