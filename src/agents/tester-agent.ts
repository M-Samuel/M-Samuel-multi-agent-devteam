import { readFileSync } from "fs";
import { join } from "path";
import { BaseAgent, type LLMMessage, type LLMProvider } from "./base-agent.js";
import type {
  Budget,
  ImplementationResult,
  ModelTier,
  TestReport,
  Ticket,
} from "../core/types.js";
import { z } from "zod";
import type { TestRunner } from "../tools/test-runner.js";
import type { LintTool } from "../tools/lint-tool.js";
import type { TypeCheckTool } from "../tools/typecheck-tool.js";
import type { SecurityScanner } from "../tools/security-scanner.js";

function loadPrompt(name: string): string {
  try {
    return readFileSync(
      join(process.cwd(), "config", "prompts", `${name}.md`),
      "utf8"
    );
  } catch {
    return `You are a ${name} agent. Respond with valid JSON.`;
  }
}

const TesterOutputSchema = z.object({
  passed: z.boolean(),
  summary: z.string(),
  totalLinesAdded: z.number().optional(),
});

type TesterOutput = z.infer<typeof TesterOutputSchema>;

export interface TesterInput {
  ticket: Ticket;
  implementation: ImplementationResult;
}

export interface TesterResult {
  testReport: TestReport;
  allPassed: boolean;
  summary: string;
}

export class TesterAgent extends BaseAgent<TesterInput, TesterOutput> {
  private readonly systemPrompt: string;
  private readonly testRunner: TestRunner;
  private readonly lintTool: LintTool;
  private readonly typeCheckTool: TypeCheckTool;
  private readonly securityScanner: SecurityScanner;

  constructor(
    tier: ModelTier,
    budget: Budget,
    testRunner: TestRunner,
    lintTool: LintTool,
    typeCheckTool: TypeCheckTool,
    securityScanner: SecurityScanner,
    llm?: LLMProvider
  ) {
    super(tier, budget, llm);
    this.systemPrompt = loadPrompt("tester");
    this.testRunner = testRunner;
    this.lintTool = lintTool;
    this.typeCheckTool = typeCheckTool;
    this.securityScanner = securityScanner;
  }

  protected get agentName(): string {
    return "tester";
  }

  protected buildMessages(input: TesterInput): LLMMessage[] {
    return [
      { role: "system", content: this.systemPrompt },
      {
        role: "user",
        content: `## Ticket: ${input.ticket.title}\n## Files Changed:\n${input.implementation.files.map((f) => f.path).join("\n")}\n\nRun all quality gates and report results as JSON: { "passed": boolean, "summary": string }`,
      },
    ];
  }

  protected parseResponse(raw: string): TesterOutput {
    const json = this.extractJson(raw);
    return this.validate(TesterOutputSchema, json);
  }

  // The tester agent orchestrates actual tool runs
  async runQualityGates(input: TesterInput): Promise<TesterResult> {
    const [testReport, lintReport, typeCheckReport, securityReport] =
      await Promise.all([
        this.testRunner.run(input.implementation.files.map((f) => f.path)),
        this.lintTool.run(input.implementation.files.map((f) => f.path)),
        this.typeCheckTool.run(),
        this.securityScanner.run(input.implementation.files.map((f) => f.path)),
      ]);

    const allPassed =
      testReport.passed &&
      lintReport.passed &&
      typeCheckReport.passed &&
      securityReport.passed;

    const summaryParts: string[] = [];
    if (!testReport.passed)
      summaryParts.push(`Tests: ${testReport.failed_count} failures`);
    if (!lintReport.passed)
      summaryParts.push(`Lint: ${lintReport.issues.length} issues`);
    if (!typeCheckReport.passed)
      summaryParts.push(`TypeCheck: ${typeCheckReport.errors.length} errors`);
    if (!securityReport.passed)
      summaryParts.push(`Security: ${securityReport.findings.length} findings`);

    return {
      testReport,
      allPassed,
      summary: allPassed ? "All quality gates passed" : summaryParts.join("; "),
    };
  }
}
