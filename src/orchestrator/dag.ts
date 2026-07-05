import type { DagNode } from "../core/types.js";

// ──────────────────────────────────────────────
// DAG execution engine
// ──────────────────────────────────────────────

export type NodeRunner<T> = (id: string) => Promise<T>;

export interface DagResult<T> {
  results: Map<string, T>;
  errors: Map<string, Error>;
  executionOrder: string[];
}

export class DagEngine<T = unknown> {
  private nodes: Map<string, DagNode>;

  constructor(nodes: DagNode[]) {
    this.nodes = new Map(nodes.map((n) => [n.id, { ...n }]));
    this.validate();
  }

  // ──────────────────────────────────────────────
  // Validation (cycle detection via DFS)
  // ──────────────────────────────────────────────

  private validate(): void {
    const visited = new Set<string>();
    const stack = new Set<string>();

    const dfs = (id: string): void => {
      if (stack.has(id)) {
        throw new Error(`Cycle detected in DAG at node: ${id}`);
      }
      if (visited.has(id)) return;

      visited.add(id);
      stack.add(id);

      const node = this.nodes.get(id);
      if (!node) throw new Error(`Node not found: ${id}`);

      for (const dep of node.dependencies) {
        if (!this.nodes.has(dep)) {
          throw new Error(`Node ${id} depends on unknown node: ${dep}`);
        }
        dfs(dep);
      }

      stack.delete(id);
    };

    for (const id of this.nodes.keys()) {
      dfs(id);
    }
  }

  // ──────────────────────────────────────────────
  // Topological sort
  // ──────────────────────────────────────────────

  private topoSort(): string[] {
    const result: string[] = [];
    const visited = new Set<string>();

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);

      const node = this.nodes.get(id);
      if (!node) throw new Error(`Node not found: ${id}`);

      for (const dep of node.dependencies) {
        visit(dep);
      }

      result.push(id);
    };

    for (const id of this.nodes.keys()) {
      visit(id);
    }

    return result;
  }

  // ──────────────────────────────────────────────
  // Execute with parallel independent nodes
  // ──────────────────────────────────────────────

  async execute(runner: NodeRunner<T>): Promise<DagResult<T>> {
    const results = new Map<string, T>();
    const errors = new Map<string, Error>();
    const executionOrder: string[] = [];

    // Work through levels of the topological ordering
    const completed = new Set<string>();
    const failed = new Set<string>();
    const allNodes = Array.from(this.nodes.keys());

    while (completed.size + failed.size < allNodes.length) {
      // Find nodes whose dependencies are all satisfied
      const ready = allNodes.filter((id) => {
        if (completed.has(id) || failed.has(id)) return false;
        const node = this.nodes.get(id);
        if (!node) return false;
        return node.dependencies.every(
          (dep) => completed.has(dep) || failed.has(dep)
        );
      });

      if (ready.length === 0) {
        // No progress possible (shouldn't happen after validation)
        break;
      }

      // Filter out nodes whose dependencies failed
      const runnable = ready.filter((id) => {
        const node = this.nodes.get(id);
        if (!node) return false;
        return !node.dependencies.some((dep) => failed.has(dep));
      });

      // Mark failed nodes (deps failed)
      for (const id of ready) {
        if (!runnable.includes(id)) {
          failed.add(id);
          errors.set(id, new Error(`Skipped: dependency failed`));
        }
      }

      if (runnable.length === 0) continue;

      // Run in parallel
      const batch = runnable.map(async (id) => {
        const node = this.nodes.get(id);
        if (node) node.status = "running";
        try {
          const result = await runner(id);
          results.set(id, result);
          completed.add(id);
          executionOrder.push(id);
          if (node) node.status = "done";
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          errors.set(id, error);
          failed.add(id);
          if (node) node.status = "failed";
        }
      });

      await Promise.all(batch);
    }

    return { results, errors, executionOrder };
  }

  // ──────────────────────────────────────────────
  // Build from ticket dependencies
  // ──────────────────────────────────────────────

  static fromTicketDependencies(
    tickets: Array<{ id: string; dependencies: string[] }>
  ): DagEngine<unknown> {
    const nodes: DagNode[] = tickets.map((t) => ({
      id: t.id,
      dependencies: t.dependencies,
      status: "pending",
    }));
    return new DagEngine(nodes);
  }

  getExecutionPlan(): string[] {
    return this.topoSort();
  }
}
