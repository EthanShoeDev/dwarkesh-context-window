import { createFileRoute, notFound } from '@tanstack/react-router';
import { allLlmPosts } from 'content-collections';

import { Markdown } from '@/components/Markdown';

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
    <article className='max-w-3xl mx-auto py-12 px-4'>
      <header className='mb-8'>
        <h1 className='text-2xl font-semibold'>{videoTitle}</h1>
        <div className='mt-2 text-sm text-gray-500 space-y-1'>
          <div>Model: {post.llmModel}</div>
          <div>
            Tokens: {post.totalTokens} (in {post.inputTokens}, out {post.outputTokens}
            {typeof post.reasoningTokens === 'number' ? `, reasoning ${post.reasoningTokens}` : ''})
          </div>
          <div>Response time: {(post.responseTimeMs / 1000).toFixed(1)}s</div>
          <div>Generated: {new Date(post.createdAt).toLocaleString()}</div>
        </div>

        <div className='mt-4'>
          <a
            className='text-sm underline'
            href={youtubeUrl(post.youtubeVideoId)}
            target='_blank'
            rel='noreferrer'
          >
            Open on YouTube
          </a>
          <div className='mt-3'>
            <iframe
              title='YouTube player'
              width='100%'
              height='360'
              src={youtubeEmbedUrl(post.youtubeVideoId)}
              allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
              allowFullScreen
            />
          </div>
        </div>

        <div className='mt-4 flex gap-3'>
          <button
            type='button'
            className='text-sm underline'
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(post.content);
              } catch {
                // ignore
              }
            }}
          >
            Copy raw markdown
          </button>
        </div>

        <details className='mt-4'>
          <summary className='text-sm underline cursor-pointer'>Show system prompt</summary>
          <pre className='mt-2 text-xs whitespace-pre-wrap'>
            {post.systemPrompt ?? 'No system prompt stored for this post.'}
          </pre>
        </details>
      </header>
      <Markdown content={post.content} className='prose prose-lg dark:prose-invert' />
    </article>
  );
}
