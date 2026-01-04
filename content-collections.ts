import { defineCollection, defineConfig } from '@content-collections/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Either, ParseResult, Schema } from 'effect';

import { LlmGeneratedFrontmatterSchema } from '@/lib/schemas/llm-generated';

function standardSchemaFromEffect<A, I>(
  schema: Schema.Schema<A, I, never>,
): StandardSchemaV1<unknown, A> {
  return {
    '~standard': {
      version: 1,
      vendor: 'effect',
      validate: (value: unknown) => {
        const decoded = Schema.decodeUnknownEither(schema)(value);
        if (Either.isRight(decoded)) {
          return { value: decoded.right };
        }

        const issues = ParseResult.ArrayFormatter.formatErrorSync(decoded.left).map((i) => ({
          message: i.message,
          path: i.path,
        }));
        return { issues };
      },
    },
  };
}

const llmPosts = defineCollection({
  name: 'llmPosts',
  directory: './src/content/llm-generated',
  include: '*.md',
  schema: standardSchemaFromEffect(LlmGeneratedFrontmatterSchema),
  transform: (post) => ({
    ...post,
    slug: post._meta.path,
  }),
});

export default defineConfig({
  collections: [llmPosts],
});
