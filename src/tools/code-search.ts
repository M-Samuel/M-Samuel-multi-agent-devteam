import { readdir, readFile, stat } from "fs/promises";
import { join, extname } from "path";

export interface CodeSearchResult {
  file: string;
  line: number;
  column: number;
  match: string;
  context: string;
}

export interface CodeSearchOptions {
  pattern: string;
  directory?: string;
  extensions?: string[];
  maxResults?: number;
  caseSensitive?: boolean;
}

export class CodeSearch {
  private readonly cwd: string;

  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
  }

  async search(options: CodeSearchOptions): Promise<CodeSearchResult[]> {
    const {
      pattern,
      directory,
      extensions = [".ts", ".js", ".tsx", ".jsx", ".json"],
      maxResults = 50,
      caseSensitive = false,
    } = options;

    const searchDir = directory ? join(this.cwd, directory) : this.cwd;
    const files = await this.collectFiles(searchDir, extensions);

    const regex = new RegExp(
      pattern,
      caseSensitive ? "g" : "gi"
    );

    const results: CodeSearchResult[] = [];

    for (const file of files) {
      if (results.length >= maxResults) break;

      try {
        const content = await readFile(file, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          regex.lastIndex = 0;
          const match = regex.exec(line);
          if (match) {
            results.push({
              file,
              line: i + 1,
              column: match.index + 1,
              match: match[0],
              context: [
                lines[i - 1] ? `  ${i}: ${lines[i - 1]}` : "",
                `→ ${i + 1}: ${line}`,
                lines[i + 1] ? `  ${i + 2}: ${lines[i + 1]}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            });
            if (results.length >= maxResults) break;
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return results;
  }

  private async collectFiles(
    directory: string,
    extensions: string[]
  ): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await readdir(directory, { withFileTypes: true });

      await Promise.all(
        entries.map(async (entry) => {
          const fullPath = join(directory, entry.name);

          // Skip node_modules and .git
          if (
            entry.name === "node_modules" ||
            entry.name === ".git" ||
            entry.name === "dist"
          ) {
            return;
          }

          if (entry.isDirectory()) {
            const sub = await this.collectFiles(fullPath, extensions);
            files.push(...sub);
          } else if (
            entry.isFile() &&
            extensions.includes(extname(entry.name))
          ) {
            files.push(fullPath);
          }
        })
      );
    } catch {
      // Directory not accessible
    }

    return files;
  }

  async findSymbol(name: string): Promise<CodeSearchResult[]> {
    return this.search({
      pattern: `\\b${name}\\b`,
      maxResults: 20,
    });
  }

  async findImports(moduleName: string): Promise<CodeSearchResult[]> {
    return this.search({
      pattern: `from ['"]${moduleName}['"]|require\\(['"]${moduleName}['"]\\)`,
      maxResults: 20,
    });
  }
}
