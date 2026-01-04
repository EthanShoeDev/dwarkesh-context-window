import { createFileRoute, notFound } from '@tanstack/react-router';
import { allLlmPosts } from 'content-collections';

import { Markdown } from '@/components/Markdown';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
import { Link } from '@tanstack/react-router';

async function loadPodcastMetadata(videoId: string) {
  const glob = import.meta.glob('/src/content/podcasts-metadata/*.json', { eager: true });
  const key = `/src/content/podcasts-metadata/${videoId}.json`;
  const mod = glob[key] as { default?: unknown } | undefined;
  if (!mod) return null;
  return (mod as any).default ?? mod;
}

function youtubeUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function youtubeEmbedUrl(videoId: string) {
  return `https://www.youtube.com/embed/${videoId}`;
}

export const Route = createFileRoute('/llm/$videoId/$model')({
  loader: async ({ params }) => {
    const post = allLlmPosts.find((p) => p.slug === `${params.videoId}--${params.model}`);
    if (!post) throw notFound();
    const meta = await loadPodcastMetadata(params.videoId);
    return {
      post,
      videoTitle: typeof meta?.title === 'string' ? meta.title : params.videoId,
    };
  },
  head: ({ params, loaderData }) => {
    // `head` can run before `loaderData` is available during navigation/SSR.
    const videoId = loaderData?.post?.youtubeVideoId ?? params.videoId;
    const model = loaderData?.post?.llmModel ?? params.model;
    const title = loaderData?.videoTitle ?? videoId;
    return {
      meta: [
        { title: `AI Guest: ${title} (${model}) | Dwarkesh Context Window` },
        {
          name: 'description',
          content: `LLM-generated insights for ${title} using ${model}`,
        },
      ],
    };
  },
  component: LlmContentPage,
});

function LlmContentPage() {
  const { post, videoTitle } = Route.useLoaderData();
  return (
    <article className='space-y-8'>
      <header className='space-y-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='space-y-2'>
            <Link to='/llm' className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Back to posts
            </Link>
            <h1 className='text-2xl font-semibold tracking-tight'>{videoTitle}</h1>
            <div className='flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
              <span>
                Model: <span className='text-foreground'>{post.llmModel}</span>
              </span>
              <span className='tabular-nums'>Generated: {new Date(post.createdAt).toLocaleString()}</span>
              <span className='tabular-nums'>Response: {(post.responseTimeMs / 1000).toFixed(1)}s</span>
              <span className='tabular-nums'>
                Tokens: {post.totalTokens} (in {post.inputTokens}, out {post.outputTokens}
                {typeof post.reasoningTokens === 'number'
                  ? `, reasoning ${post.reasoningTokens}`
                  : ''}
                )
              </span>
            </div>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <a
              className={buttonVariants({ variant: 'outline' })}
              href={youtubeUrl(post.youtubeVideoId)}
              target='_blank'
              rel='noreferrer'
            >
              Open on YouTube
            </a>
            <Button
              type='button'
              variant='secondary'
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(post.content);
                } catch {
                  // ignore
                }
              }}
            >
              Copy raw markdown
            </Button>
          </div>
        </div>

        <div className='overflow-hidden rounded-xl border bg-card shadow-sm'>
          <div className='relative w-full bg-muted pb-[56.25%]'>
            <iframe
              title='YouTube player'
              className='absolute inset-0 h-full w-full'
              src={youtubeEmbedUrl(post.youtubeVideoId)}
              allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
              allowFullScreen
            />
          </div>
        </div>

        <details className='rounded-xl border bg-card p-4 text-card-foreground shadow-sm'>
          <summary className='cursor-pointer text-sm font-medium'>
            System prompt <span className='text-muted-foreground'>(click to expand)</span>
          </summary>
          <pre className='mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap'>
            {post.systemPrompt ?? 'No system prompt stored for this post.'}
          </pre>
        </details>
      </header>

      <Markdown content={post.content} className='prose prose-lg max-w-none dark:prose-invert' />
    </article>
  );
}
