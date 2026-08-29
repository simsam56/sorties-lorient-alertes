const TOPIC_PATTERN = /^[-_A-Za-z0-9]{24,64}$/u;

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
