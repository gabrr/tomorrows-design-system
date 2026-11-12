/** Keep the complete new request; older conversational context is expendable. */
export function buildPrompt(
  intent: string,
  thread: Array<{ role: string; text: string }>,
) {
  if (!intent.trim() || intent.length >= 10000)
    throw new Error("Enter a request shorter than 10,000 characters.");
  const prefix = "Earlier design conversation (context only):\n",
    separator = "\n\nCurrent request:\n";
  const budget = 9999 - intent.length - prefix.length - separator.length;
  const previous = thread
    .slice(-4)
    .map((m) => `${m.role}: ${m.text.slice(0, 400)}`)
    .join("\n");
  return budget > 0 && previous
    ? prefix + previous.slice(-Math.min(1600, budget)) + separator + intent
    : intent;
}
