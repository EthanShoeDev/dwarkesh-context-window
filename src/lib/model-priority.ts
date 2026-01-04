import { allLlmPosts } from 'content-collections';

export function pickDefaultModel(models: ReadonlyArray<string>) {
  const sorted = sortModelsByPriority(models);
  return sorted[0] ?? null;
}

export function sortModelsByPriority(models: ReadonlyArray<string>) {
  // Build a lookup of model -> last_updated seen in our existing content.
  // This keeps `model-priority` purely content-collections based (no models.dev import on web).
  const lastUpdatedByModel = new Map<string, string>();

  for (const post of allLlmPosts) {
    const lastUpdated = post.model?.last_updated ?? null;
    if (!lastUpdated) continue;

    const existing = lastUpdatedByModel.get(post.llmModel);
    if (!existing || lastUpdated > existing) {
      lastUpdatedByModel.set(post.llmModel, lastUpdated);
    }
  }

  return models.slice().sort((a: string, b: string) => {
    const aLast = lastUpdatedByModel.get(a);
    const bLast = lastUpdatedByModel.get(b);

    // Prefer models with metadata
    if (aLast && !bLast) return -1;
    if (!aLast && bLast) return 1;

    // Prefer more recently updated models (lexicographic works for YYYY-MM or YYYY-MM-DD)
    if (aLast && bLast && aLast !== bLast) return bLast.localeCompare(aLast);

    // Stable fallback
    return a.localeCompare(b);
  });
}
