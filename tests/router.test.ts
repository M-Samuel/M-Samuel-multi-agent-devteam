import { describe, it, expect, beforeEach } from "vitest";
import { Router } from "../src/orchestrator/router.js";
import type { Ticket } from "../src/core/types.js";

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  const now = new Date().toISOString();
  return {
    id: "test-1",
    title: "Test ticket",
    description: "A test ticket",
    priority: "medium",
    status: "pending",
    tier: "C",
    repairCount: 0,
    createdAt: now,
    updatedAt: now,
    dependencies: [],
    filePaths: [],
    tags: [],
    ...overrides,
  };
}

describe("Router", () => {
  let router: Router;

  beforeEach(() => {
    router = new Router();
  });

  describe("selectTier", () => {
    it("returns Tier A for protected auth paths", () => {
      const ticket = makeTicket({ filePaths: ["src/auth/jwt.ts"] });
      const result = router.selectTier(ticket);
      expect(result.tier).toBe("A");
      expect(result.reason).toMatch(/protected/i);
    });

    it("returns Tier A for payment paths", () => {
      const ticket = makeTicket({ filePaths: ["src/payments/stripe.ts"] });
      const result = router.selectTier(ticket);
      expect(result.tier).toBe("A");
    });

    it("returns Tier A for migration paths", () => {
      const ticket = makeTicket({ filePaths: ["migrations/001_add_users.sql"] });
      const result = router.selectTier(ticket);
      expect(result.tier).toBe("A");
    });

    it("returns Tier C for markdown files", () => {
      const ticket = makeTicket({ filePaths: ["README.md", "docs/guide.md"] });
      const result = router.selectTier(ticket);
      expect(result.tier).toBe("C");
    });

    it("returns Tier C for test files", () => {
      const ticket = makeTicket({ filePaths: ["tests/auth.test.ts"] });
      const result = router.selectTier(ticket);
      expect(result.tier).toBe("C");
    });

    it("returns Tier C by default for regular source files", () => {
      const ticket = makeTicket({ filePaths: ["src/utils/helpers.ts"] });
      const result = router.selectTier(ticket);
      expect(result.tier).toBe("C");
    });

    it("returns Tier C for empty filePaths", () => {
      const ticket = makeTicket({ filePaths: [] });
      const result = router.selectTier(ticket);
      expect(result.tier).toBe("C");
    });

    it("returns Tier A if any file is protected (mixed list)", () => {
      const ticket = makeTicket({
        filePaths: ["src/utils/helper.ts", "src/auth/middleware.ts"],
      });
      const result = router.selectTier(ticket);
      expect(result.tier).toBe("A");
    });
  });

  describe("escalate", () => {
    it("escalates C → B", () => {
      expect(router.escalate("C")).toBe("B");
    });

    it("escalates B → A", () => {
      expect(router.escalate("B")).toBe("A");
    });

    it("returns null at Tier A (top)", () => {
      expect(router.escalate("A")).toBeNull();
    });
  });

  describe("isProtectedPath", () => {
    it("identifies auth paths as protected", () => {
      expect(router.isProtectedPath("src/auth/jwt.ts")).toBe(true);
    });

    it("identifies payment paths as protected", () => {
      expect(router.isProtectedPath("src/payments/billing.ts")).toBe(true);
    });

    it("identifies migration paths as protected", () => {
      expect(router.isProtectedPath("migrations/002_add_roles.sql")).toBe(true);
    });

    it("does not flag normal source files as protected", () => {
      expect(router.isProtectedPath("src/utils/format.ts")).toBe(false);
    });
  });

  describe("config properties", () => {
    it("exposes locThreshold", () => {
      expect(typeof router.locThreshold).toBe("number");
      expect(router.locThreshold).toBeGreaterThan(0);
    });

    it("exposes maxRepairLoops", () => {
      expect(typeof router.maxRepairLoops).toBe("number");
      expect(router.maxRepairLoops).toBeGreaterThan(0);
    });
  });
});
