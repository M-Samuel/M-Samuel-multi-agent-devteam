import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { Task, Ticket, TicketStatus } from "../core/types.js";

// ──────────────────────────────────────────────
// TaskStore — persists Task state to JSON files
// ──────────────────────────────────────────────

export class TaskStore {
  private readonly storageDir: string;
  private tasks: Map<string, Task> = new Map();
  private initialized = false;

  constructor(storageDir = join(process.cwd(), ".task-store")) {
    this.storageDir = storageDir;
  }

  private async ensureDir(): Promise<void> {
    if (!this.initialized) {
      await mkdir(this.storageDir, { recursive: true });
      await this.load();
      this.initialized = true;
    }
  }

  // ──────────────────────────────────────────────
  // Persistence
  // ──────────────────────────────────────────────

  private async load(): Promise<void> {
    try {
      const indexPath = join(this.storageDir, "index.json");
      const raw = await readFile(indexPath, "utf8");
      const data = JSON.parse(raw) as Record<string, Task>;
      this.tasks = new Map(Object.entries(data));
    } catch {
      // Fresh store
      this.tasks = new Map();
    }
  }

  private async persist(): Promise<void> {
    const indexPath = join(this.storageDir, "index.json");
    const data = Object.fromEntries(this.tasks.entries());
    await writeFile(indexPath, JSON.stringify(data, null, 2), "utf8");
  }

  // ──────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────

  async save(task: Task): Promise<void> {
    await this.ensureDir();
    this.tasks.set(task.ticket.id, task);
    await this.persist();
  }

  async get(ticketId: string): Promise<Task | undefined> {
    await this.ensureDir();
    return this.tasks.get(ticketId);
  }

  async list(): Promise<Task[]> {
    await this.ensureDir();
    return Array.from(this.tasks.values());
  }

  async listByStatus(status: TicketStatus): Promise<Task[]> {
    const all = await this.list();
    return all.filter((t) => t.ticket.status === status);
  }

  async delete(ticketId: string): Promise<boolean> {
    await this.ensureDir();
    const existed = this.tasks.delete(ticketId);
    if (existed) await this.persist();
    return existed;
  }

  async updateTicketStatus(
    ticketId: string,
    status: TicketStatus
  ): Promise<void> {
    await this.ensureDir();
    const task = this.tasks.get(ticketId);
    if (!task) throw new Error(`Task not found: ${ticketId}`);
    task.ticket.status = status;
    task.ticket.updatedAt = new Date().toISOString();
    await this.persist();
  }

  // ──────────────────────────────────────────────
  // Factory helper
  // ──────────────────────────────────────────────

  static createTask(ticket: Ticket): Task {
    return {
      ticket,
      tokenUsageByStage: {},
      costUsd: 0,
    };
  }
}
