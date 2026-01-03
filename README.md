> I am not affiliated with dwarkesh patel in any way.

# Why this exists

I really love the podcaster dwarkesh patel. He interviews Ai scientists and then allows really pushes the layman toward where agi might be hiding. I am thinking of building a small blog ish site where the whole idea is that I will take the entire transcript from a dwarkesh podcast and then feed that into one of the leading llms and ask it to act as a third guest and see if it can expand the conversation into even more fruitful areas for llm research.

I guess the idea is that famous one that llms could eventually get so good that they could become the best AI researchers in the world. I believe if you wanted to build something like that, you would need a really great prompt to ask the model. What better prompt is there than the entire podcast context? (with some system prompt ofc)

And the website could sort of act as a historical record at how well the llms know themselfs in a more blog/podcast style. It could eventually even become a benchmark of sorts :P

The mvp of the site will pretty much just be a blog site with markdown content but in the future I could imagine making a little like auto player that could have ai insights running along side the user while they watch dwarkesh podcast or a feature where every user gets a different ai blog post and then they could rank them on how insightful they are. Theoretically you could use that feedback to make the ai an ever better dwarkesh patel podcast guest.

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
- [ ] Write a script that will prompt an llm with the script and output markdown.
- [ ] Render the md content
- [ ] Style the site

# Potential Future Features

- [ ] Multiple tabs with different models or prompts.
- [ ] Add metadata around how long and how much it cost to generate the content.
- [ ] Add a rating system.
- [ ] Add a benchmark based on ratings.
