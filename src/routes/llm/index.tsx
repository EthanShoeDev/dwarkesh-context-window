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
    <div className='max-w-4xl mx-auto py-12 px-4'>
      <h1 className='text-3xl font-bold mb-8'>AI Guest Posts</h1>
      <ul className='space-y-4'>
        {posts.map((post) => (
          <li key={`${post.youtubeVideoId}--${post.llmModel}`}>
            <Link
              to='/llm/$videoId/$model'
              params={{ videoId: post.youtubeVideoId, model: post.llmModel }}
              className='block p-4 border rounded hover:bg-gray-50 dark:hover:bg-gray-800'
            >
              <h2 className='font-semibold'>{post.videoTitle}</h2>
              <p className='text-sm text-gray-500'>Model: {post.llmModel}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
