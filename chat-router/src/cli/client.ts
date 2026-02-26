// ---------------------------------------------------------------------------
// ChatRouterClient — HTTP client for the chat-router daemon REST API
// ---------------------------------------------------------------------------

/**
 * Talks to the running chat-router daemon over HTTP.
 * All methods return the parsed JSON response or throw on HTTP errors.
 */
export class ChatRouterClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    // Remove trailing slash if present
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const opts: RequestInit = { method, headers: {} };

    if (body !== undefined) {
      (opts.headers as Record<string, string>)["Content-Type"] =
        "application/json";
      opts.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, opts);
    } catch (err: any) {
      throw new Error(
        `Could not connect to chat-router at ${this.baseUrl}: ${err.message}`,
      );
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Chat router returned ${res.status}: ${text}`);
    }

    return res.json();
  }

  private qs(params: Record<string, string | number | undefined>): string {
    const parts: string[] = [];
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
      }
    }
    return parts.length > 0 ? `?${parts.join("&")}` : "";
  }

  // -------------------------------------------------------------------------
  // Endpoints
  // -------------------------------------------------------------------------

  /** GET /api/health */
  async health(): Promise<unknown> {
    return this.request("GET", "/api/health");
  }

  /** GET /api/conversations */
  async conversations(params?: {
    platform?: string;
    limit?: number;
  }): Promise<unknown> {
    const query = this.qs({
      platform: params?.platform,
      limit: params?.limit,
    });
    return this.request("GET", `/api/conversations${query}`);
  }

  /** GET /api/timeline/:platform/:chatId */
  async timeline(
    platform: string,
    chatId: string,
    params?: { after?: number; before?: number; limit?: number },
  ): Promise<unknown> {
    const query = this.qs({
      after: params?.after,
      before: params?.before,
      limit: params?.limit,
    });
    return this.request(
      "GET",
      `/api/timeline/${encodeURIComponent(platform)}/${encodeURIComponent(chatId)}${query}`,
    );
  }

  /** GET /api/timeline (unified) */
  async unifiedTimeline(params?: {
    after?: number;
    before?: number;
    limit?: number;
  }): Promise<unknown> {
    const query = this.qs({
      after: params?.after,
      before: params?.before,
      limit: params?.limit,
    });
    return this.request("GET", `/api/timeline${query}`);
  }

  /** POST /api/messages */
  async ingest(body: unknown): Promise<unknown> {
    return this.request("POST", "/api/messages", body);
  }

  /** POST /api/responses */
  async respond(body: unknown): Promise<unknown> {
    return this.request("POST", "/api/responses", body);
  }
}
