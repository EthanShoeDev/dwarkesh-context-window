import { Link, createFileRoute } from '@tanstack/react-router';
import { allLlmPosts } from 'content-collections';

import { buttonVariants } from '@/components/ui/button';
import { pickDefaultModel } from '@/lib/model-priority';
import { loadPodcastMetadataMap } from '@/lib/podcast-metadata';

function encodeModelParam(model: string) {
  return encodeURIComponent(model);
}

export const Route = createFileRoute('/')({
  loader: () => {
    try {
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

      const podcasts = Array.from(groups.values())
        .sort((a, b) => Date.parse(b.latestCreatedAt) - Date.parse(a.latestCreatedAt))
        .slice(0, 5);

      return { podcasts };
    } catch (error) {
      console.warn('Loader error in prerender:', error);
      return { podcasts: [] };
    }
  },
  component: HomePage,
});

function HomePage() {
  const { podcasts } = Route.useLoaderData();

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
        {podcasts.length === 0 ? (
          <p className='text-base text-muted-foreground'>
            No generated posts yet. Run the LLM generation script to create one.
          </p>
        ) : (
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
                  <div className='font-medium leading-snug group-hover:underline group-hover:underline-offset-4'>
                    {podcast.videoTitle}
                  </div>
                  <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground'>
                    <span>
                      {podcast.models.length.toLocaleString()} model
                      {podcast.models.length === 1 ? '' : 's'}
                    </span>
                    <span>{new Date(podcast.latestCreatedAt).toLocaleString()}</span>
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
