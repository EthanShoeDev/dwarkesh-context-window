// This module provides SSR-friendly access to podcast metadata
// The glob is evaluated at the module level (not inside a function)
// which allows Vite to properly transform it during build

const metadataGlob = import.meta.glob('/src/content/podcasts-metadata/*.json', { eager: true });

export function loadPodcastMetadataMap(): Map<string, { title: string }> {
  const map = new Map<string, { title: string }>();

  try {
    for (const [path, mod] of Object.entries(metadataGlob)) {
      const filename = path.split('/').pop()?.replace('.json', '') ?? '';
      const data = (mod as any).default ?? mod;
      if (typeof data?.title === 'string') {
        map.set(filename, { title: data.title });
      }
    }
  } catch (error) {
    console.error('Error loading podcast metadata:', error);
    // Return empty map on error to allow build to continue
  }

  return map;
}

export async function loadPodcastMetadata(videoId: string) {
  try {
    const key = `/src/content/podcasts-metadata/${videoId}.json`;
    const mod = metadataGlob[key] as { default?: unknown } | undefined;
    if (!mod) return null;
    return (mod as any).default ?? mod;
  } catch (error) {
    console.error(`Error loading metadata for video ${videoId}:`, error);
    return null;
  }
}
