import type {
  AgentResult,
  Budget,
  ModelTier,
  TokenUsage,
} from "../core/types.js";

// ──────────────────────────────────────────────
// LLM message / response primitives
// ──────────────────────────────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  tokenUsage: TokenUsage;
  model: string;
}

export interface LLMProvider {
  complete(messages: LLMMessage[], model: string): Promise<LLMResponse>;
}

// ──────────────────────────────────────────────
// Mock LLM provider (used when no API key present)
// ──────────────────────────────────────────────

export class MockLLMProvider implements LLMProvider {
  async complete(messages: LLMMessage[], model: string): Promise<LLMResponse> {
    const systemMsg = messages.find((m) => m.role === "system");
    const userMsg = messages.find((m) => m.role === "user");

    // Return a minimal valid JSON stub based on the system prompt
    let content = "{}";
    const systemContent = (systemMsg?.content ?? "").toLowerCase();
    const userContent = (userMsg?.content ?? "").toLowerCase();

    if (systemContent.includes("planner") || userContent.includes("## request")) {
      content = JSON.stringify({
        tickets: [
          {
            title: "Mock ticket",
            description: "Mock implementation task",
            priority: "medium",
            dependencies: [],
            filePaths: ["src/index.ts"],
            tags: ["mock"],
          },
        ],
        summary: "Mock plan",
        estimatedTotalTokens: 1000,
        estimatedCostUsd: 0.01,
      });
    } else if (
      systemContent.includes("merger") ||
      userContent.includes("prepare this implementation for merge")
    ) {
      content = JSON.stringify({
        branchName: "feat/mock-ticket",
        prTitle: "feat: mock implementation",
        prBody: "Mock PR body",
        mergeStatus: "ready",
      });
    } else if (
      systemContent.includes("reviewer") ||
      userContent.includes("review the implementation for correctness")
    ) {
      content = JSON.stringify({
        approved: true,
        score: 90,
        comments: [],
        requiresEscalation: false,
        summary: "Looks good",
      });
    } else if (
      systemContent.includes("implementer") ||
      userContent.includes("## ticket")
    ) {
      content = JSON.stringify({
        files: [
          {
            path: "src/index.ts",
            after: "export const hello = () => 'world';",
            linesAdded: 1,
            linesRemoved: 0,
          },
        ],
        totalLinesAdded: 1,
        totalLinesRemoved: 0,
        commitMessage: "feat: mock implementation",
        branchName: "feat/mock-ticket",
      });
    }

    return {
      content,
      tokenUsage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      model,
    };
  }
}

// ──────────────────────────────────────────────
// Abstract BaseAgent
// ──────────────────────────────────────────────

export abstract class BaseAgent<TInput, TOutput> {
  protected readonly tier: ModelTier;
  protected readonly budget: Budget;
  protected readonly llm: LLMProvider;
  private totalTokensUsed = 0;

  constructor(tier: ModelTier, budget: Budget, llm?: LLMProvider) {
    this.tier = tier;
    this.budget = budget;
    this.llm = llm ?? new MockLLMProvider();
  }

  // Subclasses build the prompt and parse the response
  protected abstract buildMessages(input: TInput): LLMMessage[];
  protected abstract parseResponse(raw: string): TOutput;
  protected abstract get agentName(): string;

  // Model name for this tier (can be overridden)
  protected modelForTier(tier: ModelTier): string {
    const models: Record<ModelTier, string> = {
      A: process.env["MODEL_TIER_A"] ?? "gpt-4-turbo",
      B: process.env["MODEL_TIER_B"] ?? "gpt-3.5-turbo",
      C: process.env["MODEL_TIER_C"] ?? "gpt-3.5-turbo",
    };
    return models[tier];
  }

  // ──────────────────────────────────────────────
  // Budget guard
  // ──────────────────────────────────────────────

  private checkBudget(usage: TokenUsage): void {
    const tierMax = this.budget.maxTokensPerTier[this.tier];
    this.totalTokensUsed += usage.totalTokens;
    if (this.totalTokensUsed > tierMax) {
      throw new Error(
        `Budget exceeded for tier ${this.tier}: used ${this.totalTokensUsed} / max ${tierMax}`
      );
    }
  }

  // ──────────────────────────────────────────────
  // JSON extraction helper
  // ──────────────────────────────────────────────

  protected extractJson(text: string): unknown {
    // Try direct parse first
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // Try to extract fenced JSON block
      const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch?.[1]) {
        return JSON.parse(fenceMatch[1].trim()) as unknown;
      }
      // Try to find first {...} block
      const braceStart = text.indexOf("{");
      const braceEnd = text.lastIndexOf("}");
      if (braceStart !== -1 && braceEnd > braceStart) {
        return JSON.parse(text.slice(braceStart, braceEnd + 1)) as unknown;
      }
      throw new Error(`Could not extract JSON from response: ${text.slice(0, 200)}`);
    }
  }

  // ──────────────────────────────────────────────
  // Schema validation helper (using Zod)
  // ──────────────────────────────────────────────

  protected validate<T>(
    schema: { parse: (data: unknown) => T },
    data: unknown
  ): T {
    return schema.parse(data);
  }

  // ──────────────────────────────────────────────
  // Core run method
  // ──────────────────────────────────────────────

  async run(input: TInput): Promise<AgentResult<TOutput>> {
    const start = Date.now();
    const messages = this.buildMessages(input);
    const model = this.modelForTier(this.tier);

    try {
      const response = await this.llm.complete(messages, model);
      this.checkBudget(response.tokenUsage);

      const parsed = this.parseResponse(response.content);

      return {
        success: true,
        data: parsed,
        tokenUsage: response.tokenUsage,
        tier: this.tier,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message,
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        tier: this.tier,
        durationMs: Date.now() - start,
      };
    }
  }

  get tokensUsed(): number {
    return this.totalTokensUsed;
  }
}
