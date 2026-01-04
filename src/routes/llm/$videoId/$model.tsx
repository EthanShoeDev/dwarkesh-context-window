import { createFileRoute, notFound } from '@tanstack/react-router';
import { allLlmPosts } from 'content-collections';
import * as React from 'react';

import { Markdown } from '@/components/Markdown';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getSystemPromptByRevision } from '@/llm-prompts';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';

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

function extractLeadingH1(markdown: string): { title: string | null; body: string } {
  const lines = markdown.split(/\r?\n/);

  let i = 0;
  while (i < lines.length && lines[i]?.trim() === '') i++;

  const first = lines[i] ?? '';
  if (!first.startsWith('# ')) return { title: null, body: markdown };

  const title = first.slice(2).trim() || null;
  let j = i + 1;
  while (j < lines.length && lines[j]?.trim() === '') j++;

  const body = [...lines.slice(0, i), ...lines.slice(j)].join('\n');
  return { title, body };
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
  const resolvedSystemPrompt =
    post.systemPrompt ??
    getSystemPromptByRevision((post as { systemPromptRevision?: number }).systemPromptRevision);

  const systemPromptRevision = (post as { systemPromptRevision?: number }).systemPromptRevision;
  const { title: llmPostTitle, body: llmPostBody } = extractLeadingH1(post.content);

  const [copyStatus, setCopyStatus] = React.useState<'idle' | 'copied' | 'error'>('idle');
  const [copyTooltipOpen, setCopyTooltipOpen] = React.useState(false);
  const copyResetTimeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  return (
    <article className='space-y-8'>
      <header className='-mx-6 px-6 pb-6 border-b space-y-5'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='space-y-2'>
            <h1 className='text-lg sm:text-xl font-semibold tracking-tight text-balance'>
              {videoTitle}
            </h1>
            <div className='flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground'>
              <span>
                Model: <span className='text-foreground'>{post.llmModel}</span>
              </span>
              <span className='tabular-nums'>
                Generated: {new Date(post.createdAt).toLocaleString()}
              </span>
              <span className='tabular-nums'>
                Response: {(post.responseTimeMs / 1000).toFixed(1)}s
              </span>
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
            <Tooltip open={copyTooltipOpen} onOpenChange={setCopyTooltipOpen}>
              <TooltipTrigger
                render={<Button type='button' variant='secondary' />}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(post.content);
                    setCopyStatus('copied');
                    setCopyTooltipOpen(true);
                  } catch {
                    setCopyStatus('error');
                    setCopyTooltipOpen(true);
                  }

                  if (copyResetTimeoutRef.current !== null) {
                    window.clearTimeout(copyResetTimeoutRef.current);
                  }

                  copyResetTimeoutRef.current = window.setTimeout(() => {
                    setCopyStatus('idle');
                    setCopyTooltipOpen(false);
                  }, 1200);
                }}
              >
                Copy raw markdown
              </TooltipTrigger>
              <TooltipContent>
                {copyStatus === 'copied'
                  ? 'Copied'
                  : copyStatus === 'error'
                    ? 'Copy failed'
                    : 'Copy raw markdown'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className='mx-auto max-w-4xl overflow-hidden rounded-xl border bg-card shadow-sm'>
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

        <section className='text-pretty pt-2'>
          <div className='mx-auto max-w-prose'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='inline-flex items-center rounded-full border border-border bg-muted/30 px-2.5 py-1 text-sm font-medium text-foreground'>
                AI Guest Post
              </span>
              <span className='text-sm text-muted-foreground'>
                A model-generated “third guest” response to the episode.
              </span>
            </div>

            <p className='mt-3 text-base text-muted-foreground leading-relaxed'>
              This is separate from the YouTube video and is meant to explore additional threads,
              counterarguments, and research directions — like a thoughtful follow-up guest.
            </p>
          </div>

          {llmPostTitle ? (
            <>
              <div className='mt-10 flex items-center gap-4'>
                <div className='h-px flex-1 bg-border/70' />
                <span className='inline-flex items-center rounded-full border border-border bg-muted/30 px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground'>
                  LLM response
                </span>
                <div className='h-px flex-1 bg-border/70' />
              </div>

              <h2 className='mt-8 text-center text-3xl sm:text-4xl font-semibold tracking-tight text-balance text-foreground'>
                {llmPostTitle}
              </h2>
            </>
          ) : null}
        </section>
      </header>

      <Markdown
        content={llmPostBody}
        className='prose prose-lg dark:prose-invert text-pretty mx-auto max-w-prose'
      />

      <details className='mx-auto max-w-prose text-pretty border-t border-border pt-6'>
        <summary className='cursor-pointer text-base font-medium text-foreground'>
          About this post <span className='text-muted-foreground'>(system prompt + metadata)</span>
        </summary>
        <div className='mt-3 grid gap-2 text-base text-muted-foreground'>
          <div className='flex flex-wrap gap-x-4 gap-y-1'>
            <span>
              Prompt revision:{' '}
              <span className='text-foreground tabular-nums'>
                {typeof systemPromptRevision === 'number' ? systemPromptRevision : 'unknown'}
              </span>
            </span>
            <span>
              Model: <span className='text-foreground'>{post.llmModel}</span>
            </span>
          </div>
        </div>
        <pre className='mt-3 overflow-x-auto rounded-lg border border-border bg-muted/30 p-4 text-xs leading-relaxed whitespace-pre-wrap text-foreground'>
          {resolvedSystemPrompt ??
            'No system prompt available for this post (missing systemPromptRevision and systemPrompt).'}
        </pre>
      </details>
    </article>
  );
}
