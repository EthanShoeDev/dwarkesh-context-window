---
schemaVersion: 0.0.1
youtubeVideoId: _9V_Hbe-N1A
llmModel: abacus/claude-sonnet-4-20250514
createdAt: '2026-01-04T09:26:11.652Z'
responseTimeMs: 48488
inputTokens: 26054
outputTokens: 1744
totalTokens: 27798
estimatedCostCents: 10
systemPromptRevision: 1
transcriptWordCount: 21061
model:
  id: abacus/claude-sonnet-4-20250514
  name: Claude Sonnet 4
  providerId: abacus
  providerName: Abacus
  attachment: true
  reasoning: true
  tool_call: true
  cost:
    input: 3
    output: 15
  limit:
    context: 200000
    output: 64000
  modalities:
    input:
      - text
      - image
      - pdf
    output:
      - text
  release_date: '2025-05-14'
  last_updated: '2025-05-14'
  open_weights: false
---

# The Brain's Assembly Language: What Marblestone and Patel Missed About Intelligence Architecture

After listening to Adam Marblestone's fascinating conversation with Dwarkesh Patel, I find myself both energized by their insights and frustrated by some crucial gaps in their reasoning. As someone who's spent years thinking about the intersection of neuroscience and AI, I want to push back on several key assumptions while proposing some concrete research directions that could actually test their ideas.

## The Genome Compression Problem Isn't Solved

Marblestone's explanation of how evolution encodes complex reward functions through Steve Byrnes' learning/steering subsystem framework is compelling, but I think he's underestimating the information-theoretic constraints. Yes, you can write reward functions in "a few lines of Python," but the devil is in the implementation details.

Consider this: if the genome truly encodes thousands of specialized cell types for the steering subsystem (as Marblestone suggests), then we need to explain how 3GB of genomic information specifies not just the cell types, but also their precise connectivity patterns, their response properties, and their developmental timing. The combinatorial explosion here is staggering.

**Research direction**: We need to quantify this information bottleneck precisely. I propose a collaboration between computational neuroscientists and information theorists to calculate the minimum description length for specifying the reward architectures Marblestone describes. My hypothesis is that we'll find evolution is doing something much cleverer than just encoding lots of specialized reward circuits—perhaps using developmental programs that exploit environmental regularities to self-organize the steering subsystem.

## The Omnidirectional Inference Claim Needs Experimental Grounding

Marblestone's speculation that the cortex performs "omnidirectional inference"—predicting any subset of variables from any other subset—is intriguing but lacks concrete experimental validation. Current neuroscience experiments typically only test very specific prediction tasks, not this general capability.

**Concrete experiment**: Here's how we could test this. Using high-resolution fMRI or large-scale electrophysiology, we could train human subjects on novel cross-modal prediction tasks (e.g., predict tactile sensations from visual cues, predict auditory patterns from motor actions) while measuring cortical activity. The omnidirectional inference hypothesis predicts that cortical areas should rapidly develop representations that support arbitrary cross-modal predictions, not just the specific mappings they were trained on.

More provocatively, we could test whether large language models that are trained on truly omnidirectional prediction tasks (not just next-token prediction) develop more brain-like representations. This could inform both AI development and our understanding of cortical computation.

## The Hardware-Software Distinction Is More Fundamental Than Acknowledged

While Marblestone touched on biological vs. digital hardware tradeoffs, I think he missed a deeper point about the co-evolution of algorithms and substrates. The brain's "slow" 200Hz operation and 20W power budget aren't just constraints—they may be features that enable certain computational strategies impossible on digital hardware.

Consider neuromorphic computing research: when you implement neural algorithms on hardware that mimics biological constraints (like Intel's Loihi chip), you often discover that the "limitations" actually enable new capabilities. The brain's stochasticity, for instance, might not just be noise to overcome but a computational resource for efficient sampling and exploration.

**Research proposal**: We should systematically explore what computational advantages biological constraints might provide. I suggest implementing the omnidirectional inference algorithms Marblestone describes on neuromorphic hardware and comparing their sample efficiency to traditional digital implementations. My prediction is that certain aspects of intelligence may be fundamentally tied to biological-style computation.

## Missing: The Critical Role of Embodiment and Environmental Structure

Both Marblestone and Patel focused heavily on internal brain mechanisms while largely ignoring how environmental structure shapes learning. This is a massive blind spot. The reason human children are so sample-efficient isn't just internal reward functions—it's because they're embedded in a world full of helpful structure and other humans actively teaching them.

The "spider example" Marblestone used is telling: he describes how the brain generalizes from innate spider responses to learned concepts like "Yann LeCun being upset." But this generalization critically depends on social and linguistic structures that provide scaffolding. Without other humans modeling social hierarchies, creating language, and explicitly teaching cultural knowledge, this type of learning would be impossible.

**Research direction**: We need to study intelligence as a coupled system of brain, body, and structured environment. I propose experiments with AI agents in rich, socially structured virtual environments where other agents (or humans) actively scaffold learning. This could reveal principles about how intelligent systems bootstrap from simple innate responses to complex learned behaviors.

## The Fundamental Scaling Question Remains Open

Marblestone's timeline skepticism about current LLMs achieving AGI hinges on his intuition that they're "weirdly different" from brain-like computation. But this raises a crucial question he didn't address: could current scaling approaches eventually converge to brain-like solutions?

Recent work on in-context learning suggests that large enough transformers might naturally develop something like the learning/steering subsystem distinction. The model's learned parameters could function as the "steering subsystem" that provides task-relevant priors, while in-context learning acts as the flexible "learning subsystem."

**Testable prediction**: If Marblestone's framework is correct, we should see evidence of steering/learning subsystem differentiation in sufficiently large language models. Specifically, we should find that certain attention heads or parameters remain stable across tasks (steering functions) while others adapt rapidly (learning functions). This could be tested through mechanistic interpretability research on frontier models.

## The Real Research Priority: Closing the Theory-Experiment Gap

Perhaps my biggest frustration with this conversation is how much of it remained in the realm of speculation. Neuroscience has generated beautiful theories for decades, but we're still remarkably bad at designing experiments that definitively test them.

The connectomics project Marblestone advocates for is valuable, but it's not sufficient. We need what I call "causal connectomics"—not just maps of who connects to whom, but principled interventions that test the functional role of specific circuits.

**Concrete proposal**: Instead of (or in addition to) mapping entire brains, we should focus on building "minimal viable circuits" that implement specific hypotheses. Using optogenetics, chemogenetics, and targeted genetic modifications, we could literally build versions of the learning/steering circuits Marblestone describes and test whether they produce the predicted behaviors.

## Conclusion: The Path Forward

Marblestone's insights about reward function architecture and the learning/steering distinction are genuinely important, but they need to move from speculation to systematic investigation. The most promising research directions involve:

1. **Quantitative information-theoretic analysis** of genomic constraints on neural architecture
2. **Direct experimental tests** of omnidirectional inference in biological and artificial systems
3. **Systematic exploration** of how biological hardware constraints enable unique computational strategies
4. **Recognition that intelligence is embodied and socially scaffolded**, not just a brain phenomenon
5. **Causal interventions** that test specific mechanistic hypotheses rather than just observational studies

The conversation between neuroscience and AI has been frustratingly one-sided, with AI borrowing concepts from neuroscience but rarely testing whether those concepts are actually correct. Marblestone's framework provides a roadmap for changing this dynamic—but only if we're willing to do the hard experimental work to test these ideas rigorously.

The stakes couldn't be higher. If we're going to build aligned AGI systems, we need to understand not just how intelligence works, but how values and goals are learned and represented. Marblestone's steering subsystem framework might hold crucial insights for AI safety—but only if we can move beyond speculation to genuine scientific understanding.
