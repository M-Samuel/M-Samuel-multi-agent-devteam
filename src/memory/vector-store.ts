import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";

// ──────────────────────────────────────────────
// Vector Store — stores decision records / ADRs
// Uses simple cosine-similarity over TF-IDF vectors
// (no external vector DB required)
// ──────────────────────────────────────────────

export interface VectorEntry {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding: number[]; // TF-IDF vector (sparse)
  createdAt: string;
}

export interface SearchResult {
  entry: VectorEntry;
  score: number;
}

// ──────────────────────────────────────────────
// Simple TF-IDF-like tokenizer
// ──────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function buildVector(tokens: string[], vocabulary: string[]): number[] {
  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return vocabulary.map((word) => freq.get(word) ?? 0);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

// ──────────────────────────────────────────────
// VectorStore
// ──────────────────────────────────────────────

export class VectorStore {
  private readonly storageDir: string;
  private entries: VectorEntry[] = [];
  private vocabulary: string[] = [];
  private initialized = false;

  constructor(storageDir = join(process.cwd(), ".vector-store")) {
    this.storageDir = storageDir;
  }

  private async ensureDir(): Promise<void> {
    if (!this.initialized) {
      await mkdir(this.storageDir, { recursive: true });
      await this.load();
      this.initialized = true;
    }
  }

  private async load(): Promise<void> {
    try {
      const storePath = join(this.storageDir, "store.json");
      const raw = await readFile(storePath, "utf8");
      const data = JSON.parse(raw) as {
        entries: VectorEntry[];
        vocabulary: string[];
      };
      this.entries = data.entries;
      this.vocabulary = data.vocabulary;
    } catch {
      this.entries = [];
      this.vocabulary = [];
    }
  }

  private async persist(): Promise<void> {
    const storePath = join(this.storageDir, "store.json");
    await writeFile(
      storePath,
      JSON.stringify({ entries: this.entries, vocabulary: this.vocabulary }, null, 2),
      "utf8"
    );
  }

  private rebuildVocabulary(): void {
    const wordSet = new Set<string>();
    for (const entry of this.entries) {
      for (const token of tokenize(entry.content)) {
        wordSet.add(token);
      }
    }
    this.vocabulary = Array.from(wordSet).sort();
  }

  private rebuildEmbeddings(): void {
    for (const entry of this.entries) {
      entry.embedding = buildVector(tokenize(entry.content), this.vocabulary);
    }
  }

  // ──────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────

  async add(
    content: string,
    metadata: Record<string, unknown> = {}
  ): Promise<VectorEntry> {
    await this.ensureDir();

    const id = createHash("sha256")
      .update(content + Date.now())
      .digest("hex")
      .slice(0, 16);

    // Push entry first so its tokens are included in vocabulary rebuild
    const entry: VectorEntry = {
      id,
      content,
      metadata,
      embedding: [],
      createdAt: new Date().toISOString(),
    };

    this.entries.push(entry);
    this.rebuildVocabulary();
    this.rebuildEmbeddings();

    await this.persist();
    return entry;
  }

  async search(query: string, topK = 5): Promise<SearchResult[]> {
    await this.ensureDir();

    if (this.entries.length === 0) return [];

    const queryTokens = tokenize(query);
    const queryVector = buildVector(queryTokens, this.vocabulary);

    const scored = this.entries.map((entry) => ({
      entry,
      score: cosineSimilarity(queryVector, entry.embedding),
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter((r) => r.score > 0);
  }

  async getById(id: string): Promise<VectorEntry | undefined> {
    await this.ensureDir();
    return this.entries.find((e) => e.id === id);
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureDir();
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) {
      this.rebuildVocabulary();
      this.rebuildEmbeddings();
      await this.persist();
      return true;
    }
    return false;
  }

  async list(): Promise<VectorEntry[]> {
    await this.ensureDir();
    return [...this.entries];
  }
}
