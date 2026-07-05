import { readFileSync } from "fs";
import { join } from "path";
import { BaseAgent, type LLMMessage, type LLMProvider } from "./base-agent.js";
import type { Budget, ImplementationResult, ModelTier, Ticket } from "../core/types.js";
import { ImplementationResultSchema } from "../core/types.js";

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

export interface ImplementerInput {
  ticket: Ticket;
  previousImplementation?: ImplementationResult;
  testFailures?: string;
  reviewComments?: string;
}

export class ImplementerAgent extends BaseAgent<ImplementerInput, ImplementationResult> {
  private readonly systemPrompt: string;

  constructor(tier: ModelTier, budget: Budget, llm?: LLMProvider) {
    super(tier, budget, llm);
    this.systemPrompt = loadPrompt("implementer");
  }

  protected get agentName(): string {
    return "implementer";
  }

  protected buildMessages(input: ImplementerInput): LLMMessage[] {
    const parts: string[] = [
      `## Ticket\nID: ${input.ticket.id}\nTitle: ${input.ticket.title}\nDescription:\n${input.ticket.description}`,
      `Files to modify/create: ${input.ticket.filePaths.join(", ") || "(determine from ticket)"}`,
    ];

    if (input.previousImplementation) {
      parts.push(
        `## Previous Implementation\nBranch: ${input.previousImplementation.branchName}\nFiles changed: ${input.previousImplementation.files.map((f) => f.path).join(", ")}`
      );
    }

    if (input.testFailures) {
      parts.push(`## Test Failures to Fix\n${input.testFailures}`);
    }

    if (input.reviewComments) {
      parts.push(`## Review Comments to Address\n${input.reviewComments}`);
    }

    parts.push(`\nRespond with a JSON object matching this schema:
{
  "files": [{ "path", "before"(optional), "after", "linesAdded", "linesRemoved" }],
  "totalLinesAdded": number,
  "totalLinesRemoved": number,
  "commitMessage": "string",
  "branchName": "string"
}`);

    return [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: parts.join("\n\n") },
    ];
  }

  protected parseResponse(raw: string): ImplementationResult {
    const json = this.extractJson(raw);
    const validated = this.validate(ImplementationResultSchema, json);
    return validated as ImplementationResult;
  }
}
