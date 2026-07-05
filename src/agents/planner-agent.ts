import { readFileSync } from "fs";
import { join } from "path";
import { BaseAgent, type LLMMessage, type LLMProvider } from "./base-agent.js";
import type { Budget, ModelTier, PlannerOutput } from "../core/types.js";
import { PlannerOutputSchema } from "../core/types.js";

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

export interface PlannerInput {
  request: string;
  context?: string;
}

export class PlannerAgent extends BaseAgent<PlannerInput, PlannerOutput> {
  private readonly systemPrompt: string;

  constructor(tier: ModelTier, budget: Budget, llm?: LLMProvider) {
    super(tier, budget, llm);
    this.systemPrompt = loadPrompt("planner");
  }

  protected get agentName(): string {
    return "planner";
  }

  protected buildMessages(input: PlannerInput): LLMMessage[] {
    const messages: LLMMessage[] = [
      { role: "system", content: this.systemPrompt },
      {
        role: "user",
        content: [
          `## Request\n${input.request}`,
          input.context ? `## Context\n${input.context}` : "",
          `\nRespond with a JSON object matching this schema:
{
  "tickets": [{ "title", "description", "priority", "dependencies", "filePaths", "tags" }],
  "summary": "string",
  "estimatedTotalTokens": number,
  "estimatedCostUsd": number
}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ];
    return messages;
  }

  protected parseResponse(raw: string): PlannerOutput {
    const json = this.extractJson(raw);
    return this.validate(PlannerOutputSchema, json);
  }
}
