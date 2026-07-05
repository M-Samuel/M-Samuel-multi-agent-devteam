import { readFileSync } from "fs";
import { join } from "path";
import { BaseAgent, type LLMMessage, type LLMProvider } from "./base-agent.js";
import type {
  Budget,
  ImplementationResult,
  MergerOutput,
  ModelTier,
  ReviewReport,
  Ticket,
} from "../core/types.js";
import { MergerOutputSchema } from "../core/types.js";

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

export interface MergerInput {
  ticket: Ticket;
  implementation: ImplementationResult;
  reviewReport: ReviewReport;
}

export class MergerAgent extends BaseAgent<MergerInput, MergerOutput> {
  private readonly systemPrompt: string;

  constructor(tier: ModelTier, budget: Budget, llm?: LLMProvider) {
    super(tier, budget, llm);
    this.systemPrompt = loadPrompt("merger");
  }

  protected get agentName(): string {
    return "merger";
  }

  protected buildMessages(input: MergerInput): LLMMessage[] {
    return [
      { role: "system", content: this.systemPrompt },
      {
        role: "user",
        content: `## Ticket
${input.ticket.title}: ${input.ticket.description}

## Implementation
Branch: ${input.implementation.branchName}
Commit: ${input.implementation.commitMessage}
Files: ${input.implementation.files.map((f) => f.path).join(", ")}
+${input.implementation.totalLinesAdded} / -${input.implementation.totalLinesRemoved}

## Review
Score: ${input.reviewReport.score}/100
Summary: ${input.reviewReport.summary}

Prepare this implementation for merge. Respond with JSON:
{
  "branchName": string,
  "prTitle": string,
  "prBody": string (markdown with summary, changes, testing info),
  "mergeStatus": "ready" | "merged" | "blocked",
  "commitSha": string (optional),
  "prUrl": string (optional)
}`,
      },
    ];
  }

  protected parseResponse(raw: string): MergerOutput {
    const json = this.extractJson(raw);
    return this.validate(MergerOutputSchema, json) as MergerOutput;
  }
}
