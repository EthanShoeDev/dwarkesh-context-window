# Dwarkesh Context Window

> I am not affiliated with Dwarkesh Patel in any way.

## Why this exists

This project takes a full transcript from a Dwarkesh Patel podcast episode and prompts a frontier
LLM to act as a **third guest**—summarizing, questioning, and extending the conversation into new
directions for AI research.

One motivating idea is: if models ever become genuinely great researchers, they should be able to
follow (and contribute to) expert conversations. A long-form interview—dense with context, claims,
and open questions—acts like a surprisingly strong “test harness” for that capability.

Over time, this site can serve as a historical record of how well different models “think along”
with top researchers, and potentially evolve into a lightweight benchmark.

## What’s here today

- A small, static “blog-ish” site rendering LLM-generated markdown posts
- Per-post metadata (model, token counts, runtime)
- Scripts to fetch transcripts and generate posts

## Ideas for the future

- Multiple prompts/models per episode, with side-by-side comparisons
- An “assistant alongside the podcast” experience (timestamped insights while you watch)
- Reader feedback/rating to identify which prompts produce the most useful research directions
  and iterate toward better “third guest” behavior

# Tech Stack

### Tanstack Start

We should be able to prerender everything for mvp.
Later on we could add variations from different models, or add comments.

### Effect-ts for scripts and anything server side

Because its awesome.

### Oxlint/Oxfmt

I wanted to give it a shot.

## Notes

- I would love to use tsgo, but it currently conflicts with the effect-ts ts plugin.

# MVP Features TODO

- [x] Get all software tools installed and configured correctly.
- [x] Write a script that can get the transcript from a podcast episode.
- [x] Write a script that will prompt an llm with the script and output markdown.
- [x] Render the md content
- [ ] Style the site

# Potential Future Features

- [ ] Multiple tabs with different models or prompts.
- [ ] Add metadata around how long and how much it cost to generate the content.
- [ ] Add a rating system.
- [ ] Add a benchmark based on ratings.
