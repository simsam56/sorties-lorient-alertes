const TOPIC_PATTERN = /^[-_A-Za-z0-9]{24,64}$/u;

export const SOURCE_REQUEST_HEADERS = Object.freeze({
  Accept: "text/html,application/xhtml+xml",
  "User-Agent": "sorties-lorient-alertes-live-audit/1.0",
});

export async function fetchSourceText(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      ...SOURCE_REQUEST_HEADERS,
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`Lecture de source refusée (HTTP ${response.status})`);
  return response.text();
}

export async function sendNtfy({ topic, notification, fetchImpl = fetch, timeoutMs = 15_000 }) {
  if (!TOPIC_PATTERN.test(topic ?? "")) throw new Error("Sujet ntfy absent ou invalide");

  let response;
  try {
    response = await fetchImpl(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
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
