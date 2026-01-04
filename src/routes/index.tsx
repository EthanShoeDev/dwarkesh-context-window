import { Link, createFileRoute } from '@tanstack/react-router';
import { allLlmPosts } from 'content-collections';

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
    <main className='max-w-5xl mx-auto px-6 py-10'>
      <p className='text-sm text-gray-600 dark:text-gray-400'>
        I am not affiliated with Dwarkesh Patel in any way.
      </p>

      <h1 className='text-3xl font-semibold mt-4'>Dwarkesh Context Window</h1>

      <p className='mt-4'>
        This is a small “blog-ish” site where I take the full transcript of a Dwarkesh Patel podcast
        episode and ask an LLM to act as a <strong>third guest</strong>—expanding the conversation
        into new research directions for AI.
      </p>

      <p className='mt-3'>
        The goal is to create a historical record of how well LLMs can “think along” with top AI
        researchers in a podcast format, and eventually maybe even a benchmark.
      </p>

      <p className='mt-3'>
        Source code:{' '}
        <a
          href='https://github.com/EthanShoeDev/dwarkesh-context-window'
          target='_blank'
          rel='noreferrer'
        >
          https://github.com/EthanShoeDev/dwarkesh-context-window
        </a>
      </p>

      <section className='mt-10'>
        <h2 className='text-xl font-semibold'>Recent posts</h2>
        {posts.length === 0 ? (
          <p className='mt-3 text-sm text-gray-600 dark:text-gray-400'>
            No generated posts yet. Run the LLM generation script to create one.
          </p>
        ) : (
          <ul className='mt-3 space-y-2'>
            {posts.map(({ post, videoTitle }) => (
              <li key={`${post.youtubeVideoId}--${post.llmModel}`}>
                <Link
                  to='/llm/$videoId/$model'
                  params={{ videoId: post.youtubeVideoId, model: post.llmModel }}
                >
                  {videoTitle} ({post.llmModel})
                </Link>
                {post.createdAt ? (
                  <div className='text-xs text-gray-600 dark:text-gray-400'>
                    {new Date(post.createdAt).toLocaleString()}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className='mt-4'>
          <Link to='/llm'>View all posts</Link>
        </div>
      </section>
    </main>
  );
}
