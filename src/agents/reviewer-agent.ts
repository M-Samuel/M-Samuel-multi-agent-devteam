import { readFileSync } from "fs";
import { join } from "path";
import { BaseAgent, type LLMMessage, type LLMProvider } from "./base-agent.js";
import type {
  Budget,
  ImplementationResult,
  ModelTier,
  ReviewReport,
  TestReport,
  Ticket,
} from "../core/types.js";
import { ReviewReportSchema } from "../core/types.js";

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

export interface ReviewerInput {
  ticket: Ticket;
  implementation: ImplementationResult;
  testReport: TestReport;
}

export class ReviewerAgent extends BaseAgent<ReviewerInput, ReviewReport> {
  private readonly systemPrompt: string;

  constructor(tier: ModelTier, budget: Budget, llm?: LLMProvider) {
    super(tier, budget, llm);
    this.systemPrompt = loadPrompt("reviewer");
  }

  protected get agentName(): string {
    return "reviewer";
  }

  protected buildMessages(input: ReviewerInput): LLMMessage[] {
    const fileSummary = input.implementation.files
      .map(
        (f) =>
          `### ${f.path}\n+${f.linesAdded} / -${f.linesRemoved}\n\`\`\`\n${f.after.slice(0, 2000)}\n\`\`\``
      )
      .join("\n\n");

    return [
      { role: "system", content: this.systemPrompt },
      {
        role: "user",
        content: `## Ticket\n${input.ticket.title}: ${input.ticket.description}

## Test Results
Passed: ${input.testReport.passed} (${input.testReport.passed_count}/${input.testReport.total})

## Changed Files
${fileSummary}

Review the implementation for correctness, security, and code quality.
Respond with JSON matching:
{
  "approved": boolean,
  "score": number (0-100),
  "comments": [{ "file", "line", "severity" ("blocker"|"warning"|"suggestion"), "message" }],
  "requiresEscalation": boolean,
  "escalationReason": string (optional),
  "summary": string
}`,
      },
    ];
  }

  protected parseResponse(raw: string): ReviewReport {
    const json = this.extractJson(raw);
    return this.validate(ReviewReportSchema, json) as ReviewReport;
  }
}
