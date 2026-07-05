import { z } from "zod";

// ──────────────────────────────────────────────
// Enumerations
// ──────────────────────────────────────────────

export type ModelTier = "A" | "B" | "C";

export type TicketStatus =
  | "pending"
  | "planning"
  | "implementing"
  | "testing"
  | "reviewing"
  | "merging"
  | "done"
  | "failed"
  | "escalated";

export type TicketPriority = "low" | "medium" | "high" | "critical";

// ──────────────────────────────────────────────
// Token / Budget
// ──────────────────────────────────────────────

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface Budget {
  maxTokensPerTier: Record<ModelTier, number>;
  maxCostUsd: number;
  maxRepairLoops: number;
}

// ──────────────────────────────────────────────
// Ticket
// ──────────────────────────────────────────────

export interface Ticket {
  id: string;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  tier: ModelTier;
  repairCount: number;
  createdAt: string;
  updatedAt: string;
  dependencies: string[];
  filePaths: string[];
  tags: string[];
}

// ──────────────────────────────────────────────
// Agent Result
// ──────────────────────────────────────────────

export interface AgentResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  tokenUsage: TokenUsage;
  tier: ModelTier;
  durationMs: number;
}

// ──────────────────────────────────────────────
// Test / Lint / Security Reports
// ──────────────────────────────────────────────

export interface TestCase {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

export interface TestReport {
  passed: boolean;
  total: number;
  passed_count: number;
  failed_count: number;
  skipped_count: number;
  cases: TestCase[];
  durationMs: number;
  output: string;
}

export interface LintIssue {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  rule: string;
}

export interface LintReport {
  passed: boolean;
  issues: LintIssue[];
  output: string;
}

export interface TypeCheckReport {
  passed: boolean;
  errors: string[];
  output: string;
}

export interface SecurityFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  rule: string;
  file: string;
  line: number;
  message: string;
  cwe?: string;
}

export interface SecurityReport {
  passed: boolean;
  findings: SecurityFinding[];
  output: string;
}

// ──────────────────────────────────────────────
// Review Report
// ──────────────────────────────────────────────

export interface ReviewComment {
  file: string;
  line: number;
  severity: "blocker" | "warning" | "suggestion";
  message: string;
}

export interface ReviewReport {
  approved: boolean;
  score: number; // 0–100
  comments: ReviewComment[];
  requiresEscalation: boolean;
  escalationReason?: string;
  summary: string;
}

// ──────────────────────────────────────────────
// Implementation Result
// ──────────────────────────────────────────────

export interface FileChange {
  path: string;
  before?: string;
  after: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface ImplementationResult {
  files: FileChange[];
  totalLinesAdded: number;
  totalLinesRemoved: number;
  commitMessage: string;
  branchName: string;
}

// ──────────────────────────────────────────────
// Planner Output
// ──────────────────────────────────────────────

export interface PlannerOutput {
  tickets: Omit<Ticket, "id" | "status" | "tier" | "repairCount" | "createdAt" | "updatedAt">[];
  summary: string;
  estimatedTotalTokens: number;
  estimatedCostUsd: number;
}

// ──────────────────────────────────────────────
// Merger Output
// ──────────────────────────────────────────────

export interface MergerOutput {
  branchName: string;
  prTitle: string;
  prBody: string;
  commitSha?: string;
  prUrl?: string;
  mergeStatus: "ready" | "merged" | "blocked";
}

// ──────────────────────────────────────────────
// Task (full lifecycle record)
// ──────────────────────────────────────────────

export interface Task {
  ticket: Ticket;
  implementation?: ImplementationResult;
  testReport?: TestReport;
  lintReport?: LintReport;
  typeCheckReport?: TypeCheckReport;
  securityReport?: SecurityReport;
  reviewReport?: ReviewReport;
  mergerOutput?: MergerOutput;
  tokenUsageByStage: Partial<Record<string, TokenUsage>>;
  costUsd: number;
}

// ──────────────────────────────────────────────
// DAG Node
// ──────────────────────────────────────────────

export interface DagNode {
  id: string;
  dependencies: string[];
  status: "pending" | "running" | "done" | "failed";
}

// ──────────────────────────────────────────────
// Escalation
// ──────────────────────────────────────────────

export interface EscalationRule {
  name: string;
  description: string;
  fromTier: ModelTier;
  toTier: ModelTier;
  condition: (context: EscalationContext) => boolean;
}

export interface EscalationContext {
  ticket: Ticket;
  testReport?: TestReport;
  reviewReport?: ReviewReport;
  implementation?: ImplementationResult;
  repairCount: number;
}

// ──────────────────────────────────────────────
// Zod Schemas (runtime validation)
// ──────────────────────────────────────────────

export const TicketSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum([
    "pending",
    "planning",
    "implementing",
    "testing",
    "reviewing",
    "merging",
    "done",
    "failed",
    "escalated",
  ]),
  tier: z.enum(["A", "B", "C"]),
  repairCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  dependencies: z.array(z.string()),
  filePaths: z.array(z.string()),
  tags: z.array(z.string()),
});

export const PlannerOutputSchema = z.object({
  tickets: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      priority: z.enum(["low", "medium", "high", "critical"]),
      dependencies: z.array(z.string()),
      filePaths: z.array(z.string()),
      tags: z.array(z.string()),
    })
  ),
  summary: z.string(),
  estimatedTotalTokens: z.number().int().positive(),
  estimatedCostUsd: z.number().positive(),
});

export const ImplementationResultSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      before: z.string().optional(),
      after: z.string(),
      linesAdded: z.number().int().min(0),
      linesRemoved: z.number().int().min(0),
    })
  ),
  totalLinesAdded: z.number().int().min(0),
  totalLinesRemoved: z.number().int().min(0),
  commitMessage: z.string().min(1),
  branchName: z.string().min(1),
});

export const ReviewReportSchema = z.object({
  approved: z.boolean(),
  score: z.number().min(0).max(100),
  comments: z.array(
    z.object({
      file: z.string(),
      line: z.number().int().min(0),
      severity: z.enum(["blocker", "warning", "suggestion"]),
      message: z.string(),
    })
  ),
  requiresEscalation: z.boolean(),
  escalationReason: z.string().optional(),
  summary: z.string(),
});

export const MergerOutputSchema = z.object({
  branchName: z.string().min(1),
  prTitle: z.string().min(1),
  prBody: z.string(),
  commitSha: z.string().optional(),
  prUrl: z.string().optional(),
  mergeStatus: z.enum(["ready", "merged", "blocked"]),
});
