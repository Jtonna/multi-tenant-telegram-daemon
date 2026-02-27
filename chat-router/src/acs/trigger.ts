import type { TimelineEntry } from "../types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AcsTriggerConfig {
  acsBaseUrl: string;
  jobName: string;
  routerUrl: string;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export function buildPrompt(entry: TimelineEntry, routerUrl: string): string {
  let prompt = `[ROUTER=${routerUrl}]`;
  prompt += ` [PLATFORM=${entry.platform}]`;
  prompt += ` [CHAT_ID=${entry.platformChatId}]`;
  prompt += ` [IN_REPLY_TO=${entry.id}]`;
  prompt += ` User message: ${entry.text}`;
  return prompt;
}

// ---------------------------------------------------------------------------
// Trigger function
// ---------------------------------------------------------------------------

export async function triggerAcsJob(
  config: AcsTriggerConfig,
  entry: TimelineEntry,
): Promise<boolean> {
  if (entry.direction !== "in") return false;
  if (!entry.text) return false;

  const prompt = buildPrompt(entry, config.routerUrl);
  const url = `${config.acsBaseUrl}/api/jobs/${config.jobName}/trigger`;

  // Escape double quotes inside the prompt for the shell argument
  const escaped = prompt.replace(/"/g, '\\"');
  const body = JSON.stringify({ args: `-p "${escaped}"` });

  console.log(`[acs] Triggering ${config.jobName} for entry ${entry.id}...`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[acs] Trigger failed (${res.status}): ${text}`);
      return false;
    }

    const data = (await res.json()) as { run_id?: string };
    console.log(`[acs] Triggered run_id=${data.run_id}`);
    return true;
  } catch (err) {
    console.error(`[acs] Trigger error:`, err instanceof Error ? err.message : err);
    return false;
  }
}
