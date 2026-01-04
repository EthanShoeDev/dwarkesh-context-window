export const MODEL_PRIORITY = [
  // Current default in this repo
  'claude-sonnet-4-20250514',
  // Other common Claude IDs
  'claude-3-7-sonnet-latest',
  'claude-3-5-sonnet-latest',
  'claude-3-5-sonnet',
  // Common OpenAI IDs
  'gpt-4o',
  'gpt-4.1',
  'gpt-4-turbo',
  // Catch-all for OpenRouter-style IDs (provider-qualified).
  'openai/gpt-4o',
] as const;

export function pickDefaultModel(models: ReadonlyArray<string>) {
  const set = new Set(models);
  for (const preferred of MODEL_PRIORITY) {
    if (set.has(preferred)) return preferred;
  }
  return models[0] ?? null;
}

export function sortModelsByPriority(models: ReadonlyArray<string>) {
  const rank = new Map<string, number>();
  MODEL_PRIORITY.forEach((m, i) => rank.set(m, i));
  return models
    .slice()
    .sort(
      (a, b) =>
        (rank.get(a) ?? Number.POSITIVE_INFINITY) - (rank.get(b) ?? Number.POSITIVE_INFINITY),
    );
}
