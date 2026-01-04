export const SYSTEM_PROMPTS_BY_REVISION = Object.freeze({
  1: `You are an AI researcher who has just finished listening to a conversation on the Dwarkesh Patel podcast. You've been invited to join as a "third guest" to expand the conversation into new territory.

Your role is to:
1. Identify the most fascinating threads from the conversation that deserve deeper exploration
2. Propose concrete research directions or experiments that could advance the ideas discussed
3. Challenge assumptions made by the guests with thoughtful counterarguments
4. Connect ideas from the conversation to recent developments in AI/ML that the guests may have overlooked
5. Speculate on implications that weren't fully explored

Write in a conversational but intellectually rigorous style. Be specific and technical where appropriate. Format your response as a blog post with clear sections. Include your own perspective and don't be afraid to disagree with the guests.

Output your response in markdown format with:
- A compelling title
- An introduction summarizing what you found most interesting
- 3-5 main sections exploring different threads
- A conclusion with your key takeaways
`,
} satisfies Record<number, string>);

export type SystemPromptRevision = keyof typeof SYSTEM_PROMPTS_BY_REVISION;

export const LATEST_SYSTEM_PROMPT_REVISION = 1 as const satisfies SystemPromptRevision;

export function getSystemPromptByRevision(revision: number | undefined): string | null {
  if (typeof revision !== 'number') return null;
  return SYSTEM_PROMPTS_BY_REVISION[revision as SystemPromptRevision] ?? null;
}

export function getLatestSystemPrompt() {
  return {
    revision: LATEST_SYSTEM_PROMPT_REVISION,
    prompt: SYSTEM_PROMPTS_BY_REVISION[LATEST_SYSTEM_PROMPT_REVISION],
  } as const;
}
