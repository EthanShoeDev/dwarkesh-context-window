---
schemaVersion: 0.0.1
youtubeVideoId: aR20FWCCjAs
llmModel: moonshotai/kimi-k2-thinking
createdAt: '2026-01-08T09:34:15.203Z'
responseTimeMs: 41802
inputTokens: 18396
outputTokens: 3347
totalTokens: 21743
estimatedCostCents: 2
systemPromptRevision: 1
reasoningTokens: 1052
transcriptWordCount: 15463
model:
  id: moonshotai/kimi-k2-thinking
  name: Kimi K2 Thinking
  providerId: moonshotai
  providerName: Moonshot AI
  attachment: false
  reasoning: true
  tool_call: true
  cost:
    input: 0.6
    output: 2.5
    cache_read: 0.15
  limit:
    context: 262144
    output: 262144
  modalities:
    input:
      - text
    output:
      - text
  release_date: '2025-11-06'
  last_updated: '2025-11-06'
  open_weights: true
---
# Beyond Scaling: The Unsolved Mysteries of Generalization and the Path to Truly Human-like AI

After listening to Ilya and Dwarkesh dance around the edges of AI's biggest open questions, I found myself both exhilarated and frustrated. Exhilarated because they're asking the right questions about the chasm between eval performance and real economic impact. Frustrated because the conversation kept circling what I think is the central mystery without quite landing on it. Let me try to pick up where they left off.

What struck me most wasn't the discussion about scaling laws or the "age of research"—it was this recurring pattern where Ilya would gesture toward some deeper principle behind human-like generalization, then demur with "circumstances make it hard to discuss." That reticence itself is telling. It suggests we're not just missing compute or data, but missing a conceptual framework entirely. Here are the threads I'd pull on if I had been at that table.

## 1. The Evals Mirage: Why We're Measuring Intelligence Backwards

Ilya's competitive programmer analogy is brilliant but points to a deeper pathology: **we're not just overfitting to evals, we're overfitting to our own understanding of what intelligence looks like**. When he describes the student who memorizes 10,000 competition problems versus the one who practices 100 hours and "gets it," he's describing something fundamental about **transfer depth** versus **transfer breadth**.

The RL eval-hacking problem isn't just about researchers cherry-picking environments—it's that **our entire eval suite is built on verifiable tasks**. We can automatically grade Codeforces problems or MATH dataset questions. We can't automatically grade "maintaining a legacy codebase without introducing regressions" or "mentoring a junior researcher to think differently." The moment you try to automate reward for these, you collapse them into something verifiable and lose the essence.

**Concrete research direction: Adversarial Task Generation.** Instead of building evals, we should be building **task adversaries**—systems whose sole purpose is to generate problems where current SOTA models fail in ways that humans don't. Not just harder versions of existing tasks, but genuinely novel task *structures*. The adversary gets rewarded for finding regions of task-space where model performance drops off a cliff while human performance remains stable. This is the opposite of curriculum learning—call it **anti-curriculum learning**.

**Recent work they're missing:** The [SWE-bench](https://www.swebench.com/) paper is a step in this direction, but it's still verifiable. More interesting is the [CRINGE](https://arxiv.org/abs/2405.14865) loss work, which shows models optimizing for "not being cringe" in ways that can't be reduced to correctness. The evals problem is that we're measuring **local capability** when we should be measuring **global coherence**—the ability to maintain a consistent, useful model of the world across episodes.

## 2. The Generalization Mystery: It's Not Just Evolutionary Priors

Ilya's right that humans have something models don't, but I think the "evolutionary prior" explanation is a lazy default. Yes, evolution gave us good vision priors. But here's what's more interesting: **a five-year-old can learn to recognize cars with maybe 10,000 car images. A modern vision model needs 10 million.** That's not just a prior—it's a **different learning algorithm**.

The key difference? **Humans learn in the forward direction, models learn in the backward direction.** When a child sees a car, they're predicting what they'll see next—tires rotate, drivers emerge, doors open. Their learning is **generative and predictive** at multiple timescales. The supervision signal isn't "is this a car?"—it's "did my sensory predictions hold up for the next 5 seconds?" This creates a dense, self-supervised reward signal that *densifies* the learning problem.

**Concrete research direction: Predictive Coding RL.** Instead of training models to solve tasks, train them to **predict the consequences of their own actions across multiple timescales**. The reward isn't "did you solve the problem?" but "how surprised were you by what happened?" This is different from curiosity-driven exploration—it's about building a **hierarchical predictive model** where high-level abstractions are validated by low-level sensory prediction. The math looks like this: instead of P(task_success | action), you optimize Σₜ λᵗ * -log P(sₜ₊₁ | sₜ, aₜ) for multiple λ (timescales).

**Recent development they missed:** The [DreamerV3](https://arxiv.org/abs/2301.04104) architecture is doing something adjacent, but it's still optimizing for task reward. What's missing is the **unsupervised predictive hierarchy** that lets a system learn *what matters* before it learns *what to do*.

## 3. The Value Function Problem: Emotions as Compressed Multi-Objective RL

Ilya's brain-damage patient story is fascinating but points to a deeper principle: **emotions are compressed value functions that operate at different timescales and granularity**. The reason the patient couldn't choose socks isn't because they lost "emotion"—it's because they lost **hierarchical arbitration between competing values**.

Consider: Dopamine isn't a reward signal—it's a **reward prediction error** that shapes *how* we value, not *what* we value. Serotonin modulates timescale discounting. Oxytocin shapes the *granularity* of social value representation. This is a **learned compression** of a massively multi-objective RL problem into actionable heuristics.

**Concrete experiment: Intrinsic Drive Modulation.** Train a base model with multiple "drive networks"—hunger (energy efficiency), curiosity (prediction error), social approval (agreement with simulated agents), competence (skill acquisition). Each drive outputs a scalar. The key is to make these drives **learn to modulate each other**—the "social approval" drive should suppress "hunger" when in a dinner party, but not when alone. The emergent behavior should be **situationally appropriate drive arbitration**. This is fundamentally different from Constitutional AI or RLHF—it's not about following rules, but about **learning a control system for your own values**.

**Technical detail:** This requires a **gating network** that learns to weight drive contributions based on context, trained with meta-gradients that propagate back through the arbitration decisions themselves. The loss isn't "was this correct?"—it's "did this decision make future drive satisfaction easier?"

**Recent work they missed:** The [Voyager](https://arxiv.org/abs/2305.16291) paper uses skill libraries, but they're static. What's needed is **dynamic drive modulation** where the agent *learns what to care about* in each context.

## 4. The Parallelization Paradox: Why Copies Won't Work

Ilya pushes back on Dwarkesh's intuition that the first company to crack human-like learning will dominate, and I think he's right for subtle reasons they didn't explore. The "million Ilyas" scenario fails because **parallelization of identical agents doesn't create diversity of thought—it creates redundancy of bias**.

Human teams work because each member has a **different cognitive architecture** shaped by different experiences. Not just different knowledge—different *ways of knowing*. My neuroscience colleagues see problems as circuits. My physics friends see them as energy landscapes. The magic isn't in the individual genius, but in the **diversity of mental representations**.

**Research direction: Cognitive Architecture Evolution.** Instead of training one model, train a **population of models with architectural variations**—different attention patterns, different capacity allocations, different inductive biases. Then subject them to a **shared problem-solving environment** where they must collaborate. The reward is collective, but communication is expensive. This creates evolutionary pressure for **complementarity**, not just competence. You get emergent specialization without explicit architectural design.

**Technical implementation:** Use **neuroevolution of augmenting topologies (NEAT)** principles but at the module level. Start with a base transformer, but allow modules to have different gating patterns, different recurrent depths, different local learning rules. The "innovation" is measuring not individual loss but **team regret**—how much worse the team does when this agent is removed.

**Recent work they missed:** [AutoML-Zero](https://arxiv.org/abs/2003.03384) evolves learning algorithms, but it's still single-agent. The multi-agent version is unexplored.

## 5. The Evolutionary Encoding Mystery: How Do Genes Hard-Code Social Desires?

This is the most underexplored thread. Ilya's right—it's mysterious how evolution encodes "care about social status" when there's no sensory receptor for it. I think they're missing a key insight: **evolution doesn't encode the desire—it encodes a learning rule that reliably *discovers* the desire in any normal social environment.**

Here's the mechanism: The genome specifies **predictive learning rules** that operate on social data streams. When you're a child observing social interactions, you're constantly predicting others' reactions. The learning rule says: **minimize prediction error, but weight social prediction errors higher.** This causes you to build rich models of social hierarchy, reputation, and affiliation. Once these models exist, the **value function is derived from the model's own uncertainty**—you're driven to reduce social uncertainty, which manifests as "caring what others think."

**Concrete research direction: Meta-Learned Value Discovery.** Instead of hand-coding reward functions, specify a **meta-objective: maximize the rate at which your world model becomes predictable**. In a social environment, this automatically discovers social values. In a tool-using environment, it discovers instrumental values. The genome-equivalent is the **meta-learning rate schedule**—how much to care about different types of prediction errors.

**Experiment:** Take a model with this meta-objective. Put it in a simulated environment with other agents. Give it rich social cues (other agents have visible internal states it can predict). The model should **spontaneously develop social drives**—not because they're programmed, but because they make the world more predictable. This is the "mirror neuron" phenomenon Ilya mentioned, but **learned rather than hard-coded**.

**Recent work they missed:** The [MAML](https://arxiv.org/abs/1703.03400) framework learns initialization, but not value discovery. The closest is [World Models](https://arxiv.org/abs/1803.10122), but it doesn't have the meta-learning component.

## Conclusion: The Uncomfortable Truth About Generalization

The thread running through all these points is that **we're mistaking the absence of bugs for the presence of understanding**. Ilya's right that we're entering an "age of research," but it's not because scaling is exhausted—it's because **scaling taught us what we don't know**.

The uncomfortable truth is that generalization isn't about more data or better architectures. It's about **learning to learn in ways that make your own learning process more efficient**. Humans do this automatically—we build hierarchical predictive models, we modulate our own values, we seek out complementary collaborators. Models don't, because we haven't given them the right meta-objectives.

The companies that crack this won't start with "how do we build AGI?" They'll start with "how do we make an agent that gets bored?" Boredom isn't a failure—it's **intelligence learning to be curious about its own limitations**. That is the research direction I'd bet on: not bigger models, but **models that are better at being models**.

And if I had to predict where the breakthrough comes from? Not from the labs with the most compute, but from the ones with the patience to **train agents that are allowed to fail in unverifiable ways**. Because that's what humans do—we spend 15 years being economically useless, building a world model. The moment we try to skip that phase, we get the jaggedness Ilya described. Maybe the real lesson is: **you can't straight-shot superintelligence because intelligence is the straight shot through childhood.**
