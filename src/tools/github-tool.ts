// GitHub API wrapper (with mock fallback when no token provided)

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  head: string;
  base: string;
}

export interface GitHubToolOptions {
  token?: string;
  owner: string;
  repo: string;
  mock?: boolean;
}

export class GitHubTool {
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly mock: boolean;
  private readonly baseUrl = "https://api.github.com";

  constructor(opts: GitHubToolOptions) {
    this.token = opts.token ?? process.env["GITHUB_TOKEN"] ?? "";
    this.owner = opts.owner ?? process.env["GITHUB_OWNER"] ?? "owner";
    this.repo = opts.repo ?? process.env["GITHUB_REPO"] ?? "repo";
    this.mock = opts.mock ?? !this.token;
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    if (this.mock) {
      // Return mock data
      return this.mockResponse<T>(path, options);
    }

    const url = `${this.baseUrl}${path}`;
    const requestInit: RequestInit = {
      method: options.method ?? "GET",
      headers: {
        Authorization: "Bearer " + this.token,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
    };
    if (options.body !== undefined) {
      requestInit.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, requestInit);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  private mockResponse<T>(path: string, _options: unknown): T {
    if (path.includes("/pulls") && !path.match(/\/pulls\/\d+/)) {
      return [
        {
          number: 1,
          title: "Mock PR",
          url: `https://github.com/${this.owner}/${this.repo}/pull/1`,
          state: "open",
          head: "feat/mock",
          base: "main",
        },
      ] as unknown as T;
    }
    if (path.includes("/pulls")) {
      return {
        number: 42,
        title: "Mock PR",
        url: `https://github.com/${this.owner}/${this.repo}/pull/42`,
        state: "open",
        head: "feat/mock",
        base: "main",
      } as unknown as T;
    }
    return {} as T;
  }

  async createPullRequest(params: {
    title: string;
    body: string;
    head: string;
    base?: string;
  }): Promise<PullRequest> {
    return this.request<PullRequest>(
      `/repos/${this.owner}/${this.repo}/pulls`,
      {
        method: "POST",
        body: {
          title: params.title,
          body: params.body,
          head: params.head,
          base: params.base ?? "main",
        },
      }
    );
  }

  async getPullRequest(number: number): Promise<PullRequest> {
    return this.request<PullRequest>(
      `/repos/${this.owner}/${this.repo}/pulls/${number}`
    );
  }

  async listPullRequests(state: "open" | "closed" | "all" = "open"): Promise<PullRequest[]> {
    return this.request<PullRequest[]>(
      `/repos/${this.owner}/${this.repo}/pulls?state=${state}`
    );
  }

  async addComment(issueNumber: number, body: string): Promise<void> {
    await this.request(
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`,
      { method: "POST", body: { body } }
    );
  }
}
