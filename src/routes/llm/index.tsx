import { Link, createFileRoute } from '@tanstack/react-router';
import { allLlmPosts } from 'content-collections';

import { buttonVariants } from '@/components/ui/button';
import { pickDefaultModel } from '@/lib/model-priority';

function encodeModelParam(model: string) {
  return encodeURIComponent(model);
}

function loadPodcastMetadataMap() {
  const glob = import.meta.glob('/src/content/podcasts-metadata/*.json', { eager: true });
  const map = new Map<string, { title: string }>();
  for (const [path, mod] of Object.entries(glob)) {
    const filename = path.split('/').pop()?.replace('.json', '') ?? '';
    const data = (mod as any).default ?? mod;
    if (typeof data?.title === 'string') {
      map.set(filename, { title: data.title });
    }
  }
  return map;
}

export const Route = createFileRoute('/llm/')({
  loader: () => {
    const meta = loadPodcastMetadataMap();
    const groups = new Map<
      string,
      {
        youtubeVideoId: string;
        videoTitle: string;
        models: string[];
        latestCreatedAt: string;
        defaultModel: string;
      }
    >();

    for (const post of allLlmPosts) {
      const g = groups.get(post.youtubeVideoId);
      const createdAt = post.createdAt;
      const videoTitle = meta.get(post.youtubeVideoId)?.title ?? post.youtubeVideoId;
      if (!g) {
        groups.set(post.youtubeVideoId, {
          youtubeVideoId: post.youtubeVideoId,
          videoTitle,
          models: [post.llmModel],
          latestCreatedAt: createdAt,
          defaultModel: post.llmModel,
        });
      } else {
        if (!g.models.includes(post.llmModel)) g.models.push(post.llmModel);
        if (Date.parse(createdAt) > Date.parse(g.latestCreatedAt)) g.latestCreatedAt = createdAt;
      }
    }

    for (const g of groups.values()) {
      const chosen = pickDefaultModel(g.models);
      g.defaultModel = chosen ?? g.models[0]!;
    }

    return Array.from(groups.values()).sort(
      (a, b) => Date.parse(b.latestCreatedAt) - Date.parse(a.latestCreatedAt),
    );
  },
  component: LlmIndex,
});

function LlmIndex() {
  const podcasts = Route.useLoaderData();
  return (
    <div className='space-y-6'>
      <header className='space-y-2'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <h1 className='text-3xl font-semibold tracking-tight'>AI Guest Posts</h1>
          <Link to='/' className={buttonVariants({ variant: 'ghost', size: 'default' })}>
            Back home
          </Link>
        </div>
        <p className='text-base text-muted-foreground'>
          LLM-generated “third guest” expansions of Dwarkesh podcast transcripts.
        </p>
      </header>

      <ul className='grid gap-3 sm:grid-cols-2'>
        {podcasts.map((podcast) => (
          <li key={podcast.youtubeVideoId}>
            <Link
              to='/llm/$videoId/$model'
              params={{
                videoId: podcast.youtubeVideoId,
                model: encodeModelParam(podcast.defaultModel),
              }}
              className='group block rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-muted/50'
            >
              <h2 className='font-medium leading-snug group-hover:underline group-hover:underline-offset-4'>
                {podcast.videoTitle}
              </h2>
              <p className='mt-1 text-sm text-muted-foreground'>
                {podcast.models.length.toLocaleString()} model
                {podcast.models.length === 1 ? '' : 's'}
              </p>
              <p className='mt-1 text-sm text-muted-foreground'>
                Latest: {new Date(podcast.latestCreatedAt).toLocaleString()}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
