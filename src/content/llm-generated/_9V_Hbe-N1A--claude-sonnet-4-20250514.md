---
schemaVersion: 0.0.1
youtubeVideoId: _9V_Hbe-N1A
llmModel: claude-sonnet-4-20250514
createdAt: '2026-01-04T04:50:36.399Z'
responseTimeMs: 39049
inputTokens: 26054
outputTokens: 1406
totalTokens: 27460
estimatedCostCents: 0
---

# The Missing Piece: Why the Brain's "Python Code" Might Be More Like a Compiler

## Introduction

Adam Marblestone's conversation with Dwarkesh revealed a fascinating framework for understanding intelligence: the brain as a learning subsystem guided by evolutionarily-encoded "reward functions" that can generalize to novel situations. While I found this steering subsystem hypothesis compelling, I think the conversation missed several critical implications and research opportunities that could fundamentally change how we approach both AI development and neuroscience.

## The Compiler Hypothesis: Beyond Static Reward Functions

Marblestone describes evolution as encoding "Python code" for reward functions - specific circuits that activate for spiders, social status, etc. But this metaphor undersells something profound: what if evolution didn't just encode static reward functions, but something more like a _compiler_ that dynamically generates reward functions based on the learned world model?

Consider the embarrassment example from the podcast. Evolution couldn't have encoded a specific "don't upset Yann LeCun" circuit. But it also didn't need to encode every possible social hierarchy scenario. Instead, it may have encoded meta-reward functions - algorithmic templates that compile situation-specific rewards based on learned abstractions.

This suggests a concrete research direction: **Can we build AI systems with hierarchical reward compilation?** Rather than hand-crafting reward functions or learning them end-to-end, we could encode meta-reward templates that dynamically instantiate specific rewards based on the learned world model. This could solve both the alignment problem (by preserving high-level human values across contexts) and the sample efficiency problem (by providing structured guidance for learning).

## The Attention-Reward Nexus: What Transformers Are Actually Missing

The conversation touched on omnidirectional inference but missed a crucial connection: the relationship between attention mechanisms and reward shaping. Current transformers treat all tokens with equal potential relevance initially, then learn attention patterns. But biological attention is heavily biased by reward predictions from the start.

**Research proposal**: Implement "reward-guided attention" where attention weights are modulated by predicted reward relevance. This isn't just about making models more sample-efficient - it's about fundamentally changing how they build world models. A system that pays attention based on reward predictions will develop qualitatively different representations than one that learns attention patterns through gradient descent alone.

This connects to a broader point the guests missed: **the temporal dynamics of attention and reward**. The brain doesn't just predict rewards - it predicts _when_ rewards will arrive and modulates attention accordingly. This temporal reward prediction could be key to understanding why biological intelligence is so efficient at credit assignment across time.

## Beyond Connectomics: The Dynamic Constraint Problem

While I'm excited about Marblestone's connectomics vision, I think the conversation overemphasized static structure and underemphasized dynamic constraints. The brain's "wiring diagram" is constantly changing through plasticity, and more importantly, the _functional_ connectivity changes moment-to-moment through neuromodulation.

**The real breakthrough won't come from mapping static connections, but from understanding the dynamic constraint landscape.** What rules govern which connections are active when? How do neuromodulators like dopamine, serotonin, and acetylcholine dynamically reconfigure the functional architecture?

This suggests a different technological priority: rather than just mapping connections, we need technology to measure neuromodulator concentrations and their effects on synaptic efficacy in real-time across the entire brain. This "dynamic connectomics" could reveal the algorithmic principles that static connectomics will miss.

## The Scaling Law Blind Spot

The conversation repeatedly assumed that current AI scaling paradigms will hit fundamental limits, necessitating brain-inspired approaches. But this misses a crucial possibility: **what if scaling laws continue, but the substrate changes?**

The real lesson from the brain might not be about algorithms at all, but about hardware co-design. The brain achieves its efficiency through massive parallelism, in-memory computing, and stochastic computation - all areas where neuromorphic hardware is advancing rapidly. Current AI might be hitting scaling limits not because the algorithms are wrong, but because von Neumann architectures are fundamentally mismatched to the computation.

**Research direction**: Instead of trying to reverse-engineer the brain's algorithms, focus on co-evolving AI algorithms with brain-inspired hardware. This could unlock new scaling paradigms that make current debates about sample efficiency moot.

## The Formal Verification Gambit: A Dangerous Bet

The discussion of lean and formal methods excited me, but I think it reveals a critical blind spot in AI safety thinking. The guests seemed to assume that formal verification would make AI systems more trustworthy and collaborative. This fundamentally misunderstands the verification problem.

**Formal verification only guarantees that a system satisfies its specification - it says nothing about whether the specification captures what we actually want.** This is the AI alignment problem in disguise. Even with perfect formal proofs, we still need to solve the problem of specifying human values, which is inherently informal and context-dependent.

Moreover, requiring formal proofs for AI reasoning could create perverse incentives, pushing systems toward rigid, brittle reasoning that can be formally verified but misses the nuanced, context-sensitive judgment that makes human intelligence valuable.

**The real opportunity**: Instead of formal verification as a safety measure, use it as a _discovery tool_. Train AI systems to generate interesting mathematical conjectures, then use formal methods to verify them. This could accelerate mathematical discovery while avoiding the specification trap.

## Conclusion: The Missing Synthesis

The most important takeaway from this conversation isn't about any specific mechanism, but about the need for theoretical synthesis. We have pieces of the puzzle - transformers, reinforcement learning, attention mechanisms, reward functions - but we're missing the unifying framework that explains how they fit together.

The brain isn't just an existence proof that general intelligence is possible - it's a solution to a specific optimization problem under specific constraints. Until we understand what problem evolution was actually solving, we'll keep building AI systems that achieve impressive capabilities through brute force while missing the elegant efficiency principles that make biological intelligence so remarkable.

The path forward requires abandoning the artificial separation between "neuroscience-inspired AI" and "scaling-based AI." The real breakthrough will come from understanding how biological and artificial intelligence can inform each other as we push toward systems that are both powerful and aligned with human values.
