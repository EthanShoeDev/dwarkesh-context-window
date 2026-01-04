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

export const Route = createFileRoute('/')({
  loader: () => {
    const meta = loadPodcastMetadataMap();
    const posts = allLlmPosts
      .slice()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 5)
      .map((post) => ({
        post,
        videoTitle: meta.get(post.youtubeVideoId)?.title ?? post.youtubeVideoId,
      }));
    return { posts };
  },
  component: HomePage,
});

function HomePage() {
  const { posts } = Route.useLoaderData();

  return (
    <div className='space-y-10'>
      <header className='space-y-3'>
        <h1 className='text-3xl font-semibold tracking-tight'>Dwarkesh Context Window</h1>
        <div className='space-y-3 text-base text-muted-foreground leading-relaxed'>
          <p>
            This project takes a full transcript from a Dwarkesh Patel podcast episode and prompts a
            frontier LLM to act as a <strong>third guest</strong>: summarizing, questioning, and
            extending the discussion into new directions for AI research.
          </p>
          <p>
            One motivating idea is that if models ever become genuinely great researchers, they
            should be able to follow (and contribute to) expert conversations. A long-form
            interview—dense with context, claims, and open questions—is a surprisingly strong “test
            harness” for that.
          </p>
          <p>
            Over time, the site can serve as a historical record of how well different models “think
            along” with top researchers, and maybe even evolve into a lightweight benchmark.
          </p>
          <p>
            Inspiration: Theo.gg’s “Skatebench” benchmark (naming skateboarding tricks from English
            descriptions). It’s a great reminder that weird, random benchmarks can be insightful:
            early on some Chinese models lagged behind American models, and later on some models
            regressed on Skatebench while improving on other benchmarks.
          </p>
          <p className='text-sm'>I am not affiliated with Dwarkesh Patel in any way.</p>
        </div>

        <div className='flex flex-wrap items-center gap-2 pt-2'>
          <Link to='/llm' className={buttonVariants({ variant: 'default' })}>
            Browse posts
          </Link>
          <a
            href='https://github.com/EthanShoeDev/dwarkesh-context-window'
            target='_blank'
            rel='noreferrer'
            className={buttonVariants({ variant: 'outline' })}
          >
            View source
          </a>
        </div>
      </header>

      <section className='space-y-4'>
        <div className='flex items-center justify-between gap-4'>
          <h2 className='text-lg font-semibold tracking-tight'>Recent posts</h2>
          <Link to='/llm' className={buttonVariants({ variant: 'ghost', size: 'default' })}>
            View all
          </Link>
        </div>
        {posts.length === 0 ? (
          <p className='text-base text-muted-foreground'>
            No generated posts yet. Run the LLM generation script to create one.
          </p>
        ) : (
          <ul className='grid gap-3 sm:grid-cols-2'>
            {posts.map(({ post, videoTitle }) => (
              <li key={`${post.youtubeVideoId}--${post.llmModel}`}>
                <Link
                  to='/llm/$videoId/$model'
                  params={{ videoId: post.youtubeVideoId, model: post.llmModel }}
                  className='group block rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-muted/50'
                >
                  <div className='font-medium leading-snug group-hover:underline group-hover:underline-offset-4'>
                    {videoTitle}
                  </div>
                  <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground'>
                    <span>Model: {post.llmModel}</span>
                    {post.createdAt ? (
                      <span>{new Date(post.createdAt).toLocaleString()}</span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
