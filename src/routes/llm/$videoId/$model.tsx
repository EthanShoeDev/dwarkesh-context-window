import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { allLlmPosts } from 'content-collections';
import * as React from 'react';

import { Markdown } from '@/components/Markdown';
import { ModelCombobox } from '@/components/model-combobox';
import { getSystemPromptByRevision } from '@/llm-prompts';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DrawerClose,
} from '@/components/ui/drawer';
import { sortModelsByPriority } from '@/lib/model-priority';
import { loadPodcastMetadata } from '@/lib/podcast-metadata';
import { Brain, Cpu, Clock, Hash, FileText, X, ExternalLink, Copy } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableRow, TableCell } from '@/components/ui/table';

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeModelParam(model: string) {
  return encodeURIComponent(model);
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
    const requestedModel = safeDecodeURIComponent(params.model);
    const post = allLlmPosts.find(
      (p) => p.youtubeVideoId === params.videoId && p.llmModel === requestedModel,
    );
    if (!post) throw notFound();
    const meta = await loadPodcastMetadata(params.videoId);
    const availableModels = sortModelsByPriority(
      Array.from(
        new Set(
          allLlmPosts.filter((p) => p.youtubeVideoId === params.videoId).map((p) => p.llmModel),
        ),
      ),
    );
    return {
      post,
      videoTitle: typeof meta?.title === 'string' ? meta.title : params.videoId,
      availableModels,
    };
  },
  head: ({ params, loaderData }) => {
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
  const { post, videoTitle, availableModels } = Route.useLoaderData();
  const navigate = useNavigate();
  const resolvedSystemPrompt =
    post.systemPrompt ??
    getSystemPromptByRevision((post as { systemPromptRevision?: number }).systemPromptRevision);

  const systemPromptRevision = (post as { systemPromptRevision?: number }).systemPromptRevision;
  const transcriptWordCount = (post as { transcriptWordCount?: number }).transcriptWordCount;
  const model = (post as { model?: any }).model as
    | {
        providerName?: string;
        reasoning?: boolean;
        tool_call?: boolean;
        limit?: { context?: number };
        cost?: { input?: number; output?: number };
        last_updated?: string;
      }
    | undefined;
  const { title: llmPostTitle, body: llmPostBody } = extractLeadingH1(post.content);

  const [copyStatus, setCopyStatus] = React.useState<'idle' | 'copied' | 'error'>('idle');
  const [systemPromptDrawerOpen, setSystemPromptDrawerOpen] = React.useState(false);
  const copyResetTimeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(post.content);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }

    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }

    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopyStatus('idle');
    }, 1200);
  };

  return (
    <article className='space-y-8'>
      <header className='border-b pb-6'>
        <div className='grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6'>
          <div className='space-y-6'>
            <h1 className='text-lg sm:text-xl font-semibold tracking-tight text-balance'>
              {videoTitle}
            </h1>

            <div className='mx-auto max-w-3xl overflow-hidden rounded-xl border bg-card shadow-sm'>
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

            <section className='text-pretty'>
              <div className='mx-auto max-w-prose'>
                <p className='text-base text-muted-foreground leading-relaxed'>
                  A model-generated "third guest" response to the episode. This is separate from the
                  YouTube video and is meant to explore additional threads, counterarguments, and
                  research directions — like a thoughtful follow-up guest.
                </p>
                {llmPostTitle ? (
                  <>
                    <div className='mt-8 flex items-center gap-4'>
                      <div className='h-px flex-1 bg-border/70' />
                      <span className='inline-flex items-center rounded-full border border-border bg-muted/30 px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground'>
                        LLM response
                      </span>
                      <div className='h-px flex-1 bg-border/70' />
                    </div>

                    <h2 className='mt-6 text-center text-2xl sm:text-3xl font-semibold tracking-tight text-balance text-foreground'>
                      {llmPostTitle}
                    </h2>
                  </>
                ) : null}
              </div>
            </section>

            <aside className='xl:hidden'>
              <Card className='mx-auto max-w-md sm:max-w-lg'>
                <CardContent className='space-y-4 pt-5'>
                  <div>
                    <label className='text-sm font-medium text-foreground mb-2 block'>Model</label>
                    <ModelCombobox
                      models={availableModels.length ? availableModels : [post.llmModel]}
                      value={post.llmModel}
                      onValueChange={(value) => {
                        if (value) {
                          void navigate({
                            to: '/llm/$videoId/$model',
                            params: {
                              videoId: post.youtubeVideoId,
                              model: encodeModelParam(value),
                            },
                          });
                        }
                      }}
                      disabled={availableModels.length <= 1}
                    />
                  </div>

                  {model && (
                    <div className='flex flex-wrap gap-1.5'>
                      {typeof model.limit?.context === 'number' && (
                        <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/60 text-sm text-muted-foreground'>
                          <Hash className='h-3.5 w-3.5' />
                          {model.limit.context.toLocaleString()}
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-sm ${
                          model.reasoning
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-muted/60 text-muted-foreground'
                        }`}
                      >
                        <Brain className='h-3.5 w-3.5' />
                        {model.reasoning ? 'reasoning' : 'no reasoning'}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-sm ${
                          model.tool_call
                            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            : 'bg-muted/60 text-muted-foreground'
                        }`}
                      >
                        <Cpu className='h-3.5 w-3.5' />
                        {model.tool_call ? 'tools' : 'no tools'}
                      </span>
                      {typeof model.last_updated === 'string' && (
                        <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/60 text-sm text-muted-foreground'>
                          <Clock className='h-3.5 w-3.5' />
                          {model.last_updated}
                        </span>
                      )}
                    </div>
                  )}

                  <Table>
                    <TableBody>
                      <TableRow>
                        <TableCell className='py-2 text-sm text-muted-foreground'>
                          Generated
                        </TableCell>
                        <TableCell className='py-2 text-sm text-right tabular-nums font-medium'>
                          {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className='py-2 text-sm text-muted-foreground'>
                          Response
                        </TableCell>
                        <TableCell className='py-2 text-sm text-right tabular-nums font-medium'>
                          {(post.responseTimeMs / 1000).toFixed(1)}s
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className='py-2 text-sm text-muted-foreground'>Total</TableCell>
                        <TableCell className='py-2 text-sm text-right tabular-nums font-medium'>
                          {post.totalTokens.toLocaleString()}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className='py-2 text-sm text-muted-foreground'>In/Out</TableCell>
                        <TableCell className='py-2 text-sm text-right tabular-nums font-medium'>
                          {post.inputTokens.toLocaleString()} / {post.outputTokens.toLocaleString()}
                        </TableCell>
                      </TableRow>
                      {typeof model?.cost?.input === 'number' &&
                        typeof model?.cost?.output === 'number' && (
                          <TableRow>
                            <TableCell className='py-2 text-sm text-muted-foreground'>
                              Cost
                            </TableCell>
                            <TableCell className='py-2 text-sm text-right tabular-nums font-medium'>
                              ${model.cost.input}/${model.cost.output} per 1M
                            </TableCell>
                          </TableRow>
                        )}
                      {typeof post.reasoningTokens === 'number' && (
                        <TableRow>
                          <TableCell className='py-2 text-sm text-muted-foreground'>
                            Reasoning
                          </TableCell>
                          <TableCell className='py-2 text-sm text-right tabular-nums font-medium'>
                            {post.reasoningTokens.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      )}
                      {typeof transcriptWordCount === 'number' && (
                        <TableRow>
                          <TableCell className='py-2 text-sm text-muted-foreground'>
                            Transcript
                          </TableCell>
                          <TableCell className='py-2 text-sm text-right tabular-nums font-medium'>
                            {transcriptWordCount.toLocaleString()} words
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>

                  <div className='flex gap-2 pt-3 border-t'>
                    <Drawer
                      direction='right'
                      open={systemPromptDrawerOpen}
                      onOpenChange={setSystemPromptDrawerOpen}
                    >
                      <DrawerTrigger asChild>
                        <Button variant='outline' size='sm' className='flex-1'>
                          <FileText className='h-4 w-4 mr-1.5' />
                          System
                        </Button>
                      </DrawerTrigger>
                      <DrawerContent
                        vaul-drawer-direction='right'
                        className='h-full w-full max-w-sm ml-auto rounded-l-xl'
                      >
                        <DrawerHeader className='flex flex-row items-center justify-between pb-2'>
                          <DrawerTitle className='flex items-center gap-2 text-sm'>
                            <FileText className='h-4 w-4' />
                            System Prompt
                            {typeof systemPromptRevision === 'number' && (
                              <span className='text-muted-foreground text-xs font-normal'>
                                (rev {systemPromptRevision})
                              </span>
                            )}
                          </DrawerTitle>
                          <DrawerClose>
                            <Button variant='ghost' size='icon-sm'>
                              <X className='h-4 w-4' />
                            </Button>
                          </DrawerClose>
                        </DrawerHeader>
                        <div className='flex-1 overflow-y-auto px-4 pb-4'>
                          <pre className='text-xs bg-muted/40 p-3 rounded-lg whitespace-pre-wrap font-mono leading-relaxed'>
                            {resolvedSystemPrompt ??
                              'No system prompt available for this post (missing systemPromptRevision and systemPrompt).'}
                          </pre>
                        </div>
                      </DrawerContent>
                    </Drawer>

                    <a
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      href={youtubeUrl(post.youtubeVideoId)}
                      target='_blank'
                      rel='noreferrer'
                    >
                      <ExternalLink className='h-4 w-4 mr-1.5' />
                      YouTube
                    </a>

                    <Button variant='secondary' size='sm' onClick={handleCopy} className='flex-1'>
                      <Copy className='h-4 w-4 mr-1.5' />
                      {copyStatus === 'copied' ? 'Copied!' : 'Copy'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </aside>

            <div className='mx-auto max-w-prose'>
              <Markdown
                content={llmPostBody}
                className='prose prose-lg dark:prose-invert text-pretty'
              />
            </div>
          </div>

          <aside className='hidden xl:block xl:sticky xl:top-4 xl:h-fit xl:max-h-[calc(100vh-2rem)] xl:overflow-visible'>
            <Card>
              <CardContent className='space-y-4 pt-5'>
                <div>
                  <label className='text-sm font-medium text-foreground mb-2 block'>Model</label>
                  <ModelCombobox
                    models={availableModels.length ? availableModels : [post.llmModel]}
                    value={post.llmModel}
                    onValueChange={(value) => {
                      if (value) {
                        void navigate({
                          to: '/llm/$videoId/$model',
                          params: {
                            videoId: post.youtubeVideoId,
                            model: encodeModelParam(value),
                          },
                        });
                      }
                    }}
                    disabled={availableModels.length <= 1}
                  />
                </div>

                {model && (
                  <div className='flex flex-wrap gap-1.5'>
                    {typeof model.limit?.context === 'number' && (
                      <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/60 text-sm text-muted-foreground'>
                        <Hash className='h-3.5 w-3.5' />
                        {model.limit.context.toLocaleString()}
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-sm ${
                        model.reasoning
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-muted/60 text-muted-foreground'
                      }`}
                    >
                      <Brain className='h-3.5 w-3.5' />
                      {model.reasoning ? 'reasoning' : 'no reasoning'}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-sm ${
                        model.tool_call
                          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : 'bg-muted/60 text-muted-foreground'
                      }`}
                    >
                      <Cpu className='h-3.5 w-3.5' />
                      {model.tool_call ? 'tools' : 'no tools'}
                    </span>
                    {typeof model.last_updated === 'string' && (
                      <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/60 text-sm text-muted-foreground'>
                        <Clock className='h-3.5 w-3.5' />
                        {model.last_updated}
                      </span>
                    )}
                  </div>
                )}

                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell className='py-2 text-sm text-muted-foreground'>
                        Generated
                      </TableCell>
                      <TableCell className='py-2 text-sm text-right tabular-nums font-medium'>
                        {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className='py-2 text-sm text-muted-foreground'>Response</TableCell>
                      <TableCell className='py-2 text-sm text-right tabular-nums font-medium'>
                        {(post.responseTimeMs / 1000).toFixed(1)}s
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className='py-2 text-sm text-muted-foreground'>Total</TableCell>
                      <TableCell className='py-2 text-sm text-right tabular-nums font-medium'>
                        {post.totalTokens.toLocaleString()}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className='py-2 text-sm text-muted-foreground'>In/Out</TableCell>
                      <TableCell className='py-2 text-sm text-right tabular-nums font-medium'>
                        {post.inputTokens.toLocaleString()} / {post.outputTokens.toLocaleString()}
                      </TableCell>
                    </TableRow>
                    {typeof model?.cost?.input === 'number' &&
                      typeof model?.cost?.output === 'number' && (
                        <TableRow>
                          <TableCell className='py-2 text-sm text-muted-foreground'>Cost</TableCell>
                          <TableCell className='py-2 text-sm text-right tabular-nums font-medium'>
                            ${model.cost.input}/${model.cost.output} per 1M
                          </TableCell>
                        </TableRow>
                      )}
                    {typeof post.reasoningTokens === 'number' && (
                      <TableRow>
                        <TableCell className='py-2 text-sm text-muted-foreground'>
                          Reasoning
                        </TableCell>
                        <TableCell className='py-2 text-sm text-right tabular-nums font-medium'>
                          {post.reasoningTokens.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    )}
                    {typeof transcriptWordCount === 'number' && (
                      <TableRow>
                        <TableCell className='py-2 text-sm text-muted-foreground'>
                          Transcript
                        </TableCell>
                        <TableCell className='py-2 text-sm text-right tabular-nums font-medium'>
                          {transcriptWordCount.toLocaleString()} words
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>

                <div className='flex gap-2 pt-3 border-t'>
                  <Drawer
                    direction='right'
                    open={systemPromptDrawerOpen}
                    onOpenChange={setSystemPromptDrawerOpen}
                  >
                    <DrawerTrigger asChild>
                      <Button variant='outline' size='sm' className='flex-1'>
                        <FileText className='h-4 w-4 mr-1.5' />
                        System
                      </Button>
                    </DrawerTrigger>
                    <DrawerContent
                      vaul-drawer-direction='right'
                      className='h-full w-full max-w-sm ml-auto rounded-l-xl'
                    >
                      <DrawerHeader className='flex flex-row items-center justify-between pb-2'>
                        <DrawerTitle className='flex items-center gap-2 text-sm'>
                          <FileText className='h-4 w-4' />
                          System Prompt
                          {typeof systemPromptRevision === 'number' && (
                            <span className='text-muted-foreground text-xs font-normal'>
                              (rev {systemPromptRevision})
                            </span>
                          )}
                        </DrawerTitle>
                        <DrawerClose>
                          <Button variant='ghost' size='icon-sm'>
                            <X className='h-4 w-4' />
                          </Button>
                        </DrawerClose>
                      </DrawerHeader>
                      <div className='flex-1 overflow-y-auto px-4 pb-4'>
                        <pre className='text-xs bg-muted/40 p-3 rounded-lg whitespace-pre-wrap font-mono leading-relaxed'>
                          {resolvedSystemPrompt ??
                            'No system prompt available for this post (missing systemPromptRevision and systemPrompt).'}
                        </pre>
                      </div>
                    </DrawerContent>
                  </Drawer>

                  <a
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    href={youtubeUrl(post.youtubeVideoId)}
                    target='_blank'
                    rel='noreferrer'
                  >
                    <ExternalLink className='h-4 w-4 mr-1.5' />
                    YouTube
                  </a>

                  <Button variant='secondary' size='sm' onClick={handleCopy} className='flex-1'>
                    <Copy className='h-4 w-4 mr-1.5' />
                    {copyStatus === 'copied' ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </header>
    </article>
  );
}
