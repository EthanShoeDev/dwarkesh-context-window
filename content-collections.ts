import { defineCollection, defineConfig } from '@content-collections/core';
import { Schema } from 'effect';

import { LlmGeneratedFrontmatterSchema } from '@/lib/schemas/llm-generated';

const llmPosts = defineCollection({
  name: 'llmPosts',
  directory: './src/content/llm-generated',
  include: '*.md',
  schema: Schema.standardSchemaV1(LlmGeneratedFrontmatterSchema),
  transform: (post) => ({
    ...post,
    slug: post._meta.path,
  }),
});

export default defineConfig({
  collections: [llmPosts],
});
