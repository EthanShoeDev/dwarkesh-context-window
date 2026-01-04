import { Link, createFileRoute } from '@tanstack/react-router';
import { allLlmPosts } from 'content-collections';

import { buttonVariants } from '@/components/ui/button';

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
    const posts = allLlmPosts
      .slice()
      .map((p) => ({
        ...p,
        videoTitle: meta.get(p.youtubeVideoId)?.title ?? p.youtubeVideoId,
      }))
      .sort((a, b) => {
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });

    return posts;
  },
  component: LlmIndex,
});

function LlmIndex() {
  const posts = Route.useLoaderData();
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
        {posts.map((post) => (
          <li key={`${post.youtubeVideoId}--${post.llmModel}`}>
            <Link
              to='/llm/$videoId/$model'
              params={{ videoId: post.youtubeVideoId, model: post.llmModel }}
              className='group block rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-muted/50'
            >
              <h2 className='font-medium leading-snug group-hover:underline group-hover:underline-offset-4'>
                {post.videoTitle}
              </h2>
              <p className='mt-1 text-sm text-muted-foreground'>Model: {post.llmModel}</p>
              <p className='mt-1 text-sm text-muted-foreground'>
                {new Date(post.createdAt).toLocaleString()}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
