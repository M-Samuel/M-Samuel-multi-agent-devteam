import { readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import type { ModelTier, Ticket } from "../core/types.js";

// ──────────────────────────────────────────────
// Config types
// ──────────────────────────────────────────────

interface TierConfig {
  model: string;
  maxTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
}

interface ModelsConfig {
  tiers: Record<ModelTier, TierConfig>;
}

interface PoliciesConfig {
  protectedPaths: string[];
  locThresholdForEscalation: number;
  maxRepairLoops: number;
  globPatternsForTierC: string[];
}

// ──────────────────────────────────────────────
// Glob-matching helper (no external dep)
// ──────────────────────────────────────────────

function globMatch(pattern: string, filePath: string): boolean {
  // Convert glob pattern to regex safely — escape all special regex chars,
  // then replace glob wildcards.
  // Step 1: protect ** with a unique marker before escaping
  const withMarker = pattern.replace(/\*\*/g, "\x00DOUBLESTAR\x00");
  // Step 2: escape all regex metacharacters (backslash first, then others)
  const regexEscaped = withMarker
    .replace(/\\/g, "\\\\")
    .replace(/[.+?^${}()|[\]]/g, "\\$&");
  // Step 3: single * (not yet converted) → [^/]*
  const withSingleStar = regexEscaped.replace(/\*/g, "[^/]*");
  // Step 4: restore ** marker → .*
  const safePattern = withSingleStar.replace(/\x00DOUBLESTAR\x00/g, ".*");

  const regex = new RegExp(`^${safePattern}$`);
  return regex.test(filePath);
}

// ──────────────────────────────────────────────
// Config loader (falls back to defaults)
// ──────────────────────────────────────────────

function loadModelsConfig(): ModelsConfig {
  try {
    const configPath = join(process.cwd(), "config", "models.yaml");
    const raw = readFileSync(configPath, "utf8");
    return parseYaml(raw) as ModelsConfig;
  } catch {
    return {
      tiers: {
        A: {
          model: process.env["MODEL_TIER_A"] ?? "gpt-4-turbo",
          maxTokens: 100_000,
          costPer1kInput: 0.01,
          costPer1kOutput: 0.03,
        },
        B: {
          model: process.env["MODEL_TIER_B"] ?? "gpt-3.5-turbo",
          maxTokens: 50_000,
          costPer1kInput: 0.001,
          costPer1kOutput: 0.002,
        },
        C: {
          model: process.env["MODEL_TIER_C"] ?? "gpt-3.5-turbo",
          maxTokens: 20_000,
          costPer1kInput: 0.0005,
          costPer1kOutput: 0.0015,
        },
      },
    };
  }
}

function loadPoliciesConfig(): PoliciesConfig {
  try {
    const configPath = join(process.cwd(), "config", "policies.yaml");
    const raw = readFileSync(configPath, "utf8");
    return parseYaml(raw) as PoliciesConfig;
  } catch {
    return {
      protectedPaths: [
        "src/auth/**",
        "src/payments/**",
        "migrations/**",
        "**/*.secret.*",
        "**/.env*",
      ],
      locThresholdForEscalation: 400,
      maxRepairLoops: 3,
      globPatternsForTierC: [
        "**/*.md",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/fixtures/**",
        "**/mocks/**",
      ],
    };
  }
}

// ──────────────────────────────────────────────
// Router
// ──────────────────────────────────────────────

export interface TierSelectionResult {
  tier: ModelTier;
  reason: string;
}

export class Router {
  private readonly modelsConfig: ModelsConfig;
  private readonly policies: PoliciesConfig;

  constructor() {
    this.modelsConfig = loadModelsConfig();
    this.policies = loadPoliciesConfig();
  }

  // Select the initial tier for a ticket
  selectTier(ticket: Ticket): TierSelectionResult {
    // Always use Tier A for planning (handled outside this router)
    // Check for protected paths → Tier A
    const hasProtectedPath = ticket.filePaths.some((fp) =>
      this.policies.protectedPaths.some((pattern) => globMatch(pattern, fp))
    );
    if (hasProtectedPath) {
      return {
        tier: "A",
        reason: `Ticket touches protected path(s): ${ticket.filePaths.join(", ")}`,
      };
    }

    // Tier C: documentation, tests, boilerplate
    const allTierC = ticket.filePaths.every((fp) =>
      this.policies.globPatternsForTierC.some((pattern) =>
        globMatch(pattern, fp)
      )
    );
    if (allTierC && ticket.filePaths.length > 0) {
      return { tier: "C", reason: "All files match Tier C (docs/tests/boilerplate)" };
    }

    // Default: start on Tier C, escalate on failure
    return { tier: "C", reason: "Default starting tier" };
  }

  // Determine if escalation is needed and to which tier
  escalate(current: ModelTier): ModelTier | null {
    if (current === "C") return "B";
    if (current === "B") return "A";
    return null; // Already at top
  }

  // Whether a path is protected
  isProtectedPath(filePath: string): boolean {
    return this.policies.protectedPaths.some((pattern) =>
      globMatch(pattern, filePath)
    );
  }

  get locThreshold(): number {
    return this.policies.locThresholdForEscalation;
  }

  get maxRepairLoops(): number {
    return this.policies.maxRepairLoops;
  }

  getTierConfig(tier: ModelTier): TierConfig {
    return this.modelsConfig.tiers[tier];
  }
}
