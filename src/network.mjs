const TOPIC_PATTERN = /^[-_A-Za-z0-9]{24,64}$/u;

export const SOURCE_REQUEST_HEADERS = Object.freeze({
  Accept: "text/html,application/xhtml+xml",
  "User-Agent": "sorties-lorient-alertes-live-audit/1.0",
});

const TRANSIENT_STATUSES = new Set([404, 429, 500, 502, 503, 504]);

export async function fetchSourceText(url, options = {}, fetchImpl = fetch) {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 800;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchImpl(url, {
        ...options,
        headers: {
          ...SOURCE_REQUEST_HEADERS,
          ...(options.headers ?? {}),
        },
      });
      if (response.ok) return response.text();

      const message = `Lecture de source refusée (HTTP ${response.status})`;
      lastError = new Error(message);
      if (!TRANSIENT_STATUSES.has(response.status)) throw lastError;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Ne pas retenter les erreurs non-transitoires déjà levées explicitement
      if (lastError.message.startsWith("Lecture de source refusée") && !TRANSIENT_STATUSES.has(Number(lastError.message.match(/HTTP (\d+)/)?.[1]))) {
        throw lastError;
      }
    }

    if (attempt < maxAttempts) {
      const delay = baseDelayMs * attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error("Lecture de source impossible");
}

export async function sendNtfy({ topic, notification, fetchImpl = fetch, timeoutMs = 15_000 }) {
  if (!TOPIC_PATTERN.test(topic ?? "")) throw new Error("Sujet ntfy absent ou invalide");

  let response;
  try {
    response = await fetchImpl("https://ntfy.sh/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        topic,
        title: notification.title,
        message: notification.message,
        click: notification.clickUrl,
        priority: notification.priority,
        tags: notification.tags,
        markdown: notification.markdown,
      }),
    });
  } catch {
    throw new Error("Publication ntfy impossible");
  }
  if (!response.ok) throw new Error(`Notification ntfy refusée (HTTP ${response.status})`);
}
