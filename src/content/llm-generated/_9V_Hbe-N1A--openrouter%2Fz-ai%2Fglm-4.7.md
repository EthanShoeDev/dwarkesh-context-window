---
schemaVersion: 0.0.1
youtubeVideoId: _9V_Hbe-N1A
llmModel: openrouter/z-ai/glm-4.7
createdAt: '2026-01-04T09:39:52.745Z'
responseTimeMs: 108907
inputTokens: 24890
outputTokens: 4143
totalTokens: 29033
estimatedCostCents: 3
systemPromptRevision: 1
reasoningTokens: 2389
transcriptWordCount: 21061
model:
  id: openrouter/z-ai/glm-4.7
  name: GLM-4.7
  providerId: openrouter
  providerName: OpenRouter
  attachment: false
  reasoning: true
  tool_call: true
  cost:
    input: 0.6
    output: 2.2
    cache_read: 0.11
  limit:
    context: 204800
    output: 131072
  modalities:
    input:
      - text
    output:
      - text
  release_date: '2025-12-22'
  last_updated: '2025-12-22'
  open_weights: true
---

# Beyond the "Python Code" Genome: Why AI Needs Active Inference and Synthetic Steering Subsystems

I just finished listening to Dwarkesh’s conversation with Adam Marblestone, and I have to say—it’s one of the most refreshing takes on the neuro-AI connection in a while. Adam correctly identifies that we’ve been obsessing over the architecture (the "universal learning machine" of the cortex) while neglecting the curriculum and the loss functions (the "steering subsystem").

However, as a researcher working at the intersection of mechanistic interpretability and cognitive neuroscience, I think Adam’s view is slightly incomplete. He frames the genome as a kind of pre-compiled Python script of "innate reward functions." I’d argue that the genome is actually specifying a _meta-learning objective_ that allows the brain to generate its own reward functions on the fly.

If I were sitting at that table, I’d want to push the conversation in three specific directions: the role of **Predictive Coding** (not just backprop) as the fundamental algorithm, the limitations of **Connectomics** without mapping plasticity, and how **OpenAI’s o1** (and similar reasoning models) validates his "amortized vs. interactive inference" distinction in ways we didn't expect.

Here is what I think is missing, and where we should go next.

---

## 1. The Steering Subsystem is Not Static Code—It’s Homeostatic Prediction

Adam and Steven Byrnes propose this beautiful model: a learning subsystem (cortex) predicts the state of a steering subsystem (hypothalamus/brainstem). The cortex learns what "spiders" are because the steering subsystem already knows how to flinch.

I agree with the mechanism, but I disagree with the framing that the genome encodes the "reward functions" directly like a programmer writing `if spider then scream`. This implies the genome needs to anticipate the specific "spider" concept. I think the evidence points to something more fundamental: **Homeostasis.**

The genome doesn't encode "spiders are bad." It encodes "surprise is metabolically expensive" and "safety is good." The "steering subsystem" isn't a lookup table of hardcoded fears; it is a biological regulator (heart rate, hormone levels, etc.) constantly trying to minimize prediction error regarding its own internal state.

### The Research Direction: Active Inference

We should stop looking at the brain as minimizing a scalar reward loss and start viewing it through the lens of the **Free Energy Principle** (Karl Friston). The brain isn't just "predicting" the sensory inputs; it is actively acting to make its predictions true. If I predict I am safe, I move to verify that. If I see a spider, my prediction of safety is violated (high free energy). The "steering signal" is actually the gradient of free energy reduction.

**Proposed Experiment:**
We should train an AI agent using **Active Inference** rather than standard RL.

1.  Give the model a set of "homeostatic variables" (e.g., a simulated "energy tank" and "safety level").
2.  The loss function is not "maximize reward," but "minimize the prediction error of these homeostatic variables."
3.  Does this naturally induce a "steering subsystem" where the model develops complex, abstract fears (like social embarrassment) without us ever explicitly coding them as negative rewards?

I suspect this would solve Ilya’s question more elegantly than the "thought assessor" hypothesis, because the genome only needs to define the _homeostatic setpoints_, not the infinite list of things in the world that threaten them.

---

## 2. Omnidirectional Inference and the Rise of "System 2" Models

Adam makes a compelling distinction between "amortized inference" (what LLMs do—fast, one-shot answers) and "omnidirectional" or "probabilistic" inference (what the brain allegedly does—slow, sampling, considering alternatives).

He worries that LLMs are just forward predictors. But recent developments in AI are already bridging this gap. We are seeing the emergence of "System 2" architectures (like OpenAI’s o1 or the "Tree of Thoughts" framework) that explicitly utilize test-time compute to search, backtrack, and verify.

Adam asked, _"Why can't we achieve omnidirectional inference by removing the masks?"_ My answer: We can, but we haven't wanted to because it's expensive. However, the cost-benefit analysis is flipping.

### The Research Direction: Diffusion-Based Reasoning

The brain likely doesn't use a simple forward pass, but neither does it do pure MCMC sampling (which is too slow). The closest analog we have in modern AI that mimics the brain's flexibility (filling in blanks, reverse prediction, denoising) is **Diffusion Models**.

**Proposed Experiment:**
Let's move beyond Transformers for reasoning and train a **Discrete Diffusion Model** on mathematical proofs or code.

- Instead of predicting the next token, the model learns to denoise a full block of code or a proof state.
- This allows for _omnidirectional editing_. You can clamp the end of the proof and ask it to generate the beginning (reverse inference), or clamp a variable in the middle and ask it to fix the rest.
- If this approach yields significantly better data efficiency than next-token prediction, it validates the hypothesis that the cortex is an energy-based denoiser, not just a next-token predictor.

---

## 3. Connectomics is Useless Without "Plasticity-omics"

Adam’s big push is for Connectomics (mapping the wiring diagram). He compares it to the Human Genome Project. I think this is a dangerous category error.

Mapping the connectome is like having the weights of a randomly initialized neural network without the training code or the backpropagation algorithm. You have the structure, but you don't know the _rules_ that made it functional. A static map of synapses tells you _what_ is connected, but not _how_ those connections change during the "spider" learning event Adam described.

### The Research Direction: Mapping the Learning Rule, Not the Weights

Instead of spending billions mapping static connections, we should focus on mapping _synaptic plasticity_ in vivo.

**Proposed Experiment:**
We need longitudinal connectomics—imaging the _same_ neuron synapses over days while the animal learns a new task.

- Which synapses grow?
- Which ones shrink?
- Crucially, what is the _local rule_ determining this? Is it purely Hebbian (fire together, wire together), or is there a third factor (neuromodulators like dopamine) that gates the plasticity?
- If we can extract the "local learning rule" from biological data, we can implement that in silicon. The architecture might matter less than the _update rule_. If the brain uses a variant of predictive coding with local error signals, that is the missing piece, not the wiring diagram.

---

## 4. RLHF is a Primitive Attempt at the "Thought Assessor"

Adam mentions that the brain has a "thought assessor"—a mechanism that looks at the cortex's activity and predicts the steering subsystem's response.

We actually already have a primitive version of this in AI: **RLHF (Reinforcement Learning from Human Feedback).** When we label a model's output as "good" or "bad," we are essentially acting as the steering subsystem. The model (cortex) then learns to predict which internal states (outputs) will trigger a positive signal from us.

But Adam implies the biological steering subsystem is much richer—predicting _future_ internal states (e.g., "If I insult Jan LeCun, I will feel shame in 10 minutes").

### The Research Direction: Synthetic Steering Subsystems

Current RLHF is reactive (reward comes after the action). We need **proactive internal modeling**.

**Proposed Experiment:**
Let's build a "Synthetic Amygdala" module.

- Train a base model (Cortex) to be a competent agent.
- Train a separate, smaller model (Steering Subsystem) to predict physiological states (heart rate, stress) from text/video inputs.
- Connect the two. The Cortex is trained not just to maximize external rewards, but to _minimize the prediction error_ of the Steering Subsystem regarding future states.
- This might solve the alignment issue better than constitutional AI, because the "fear" is rooted in a simulation of the human condition, not just a list of rules.

---

## Conclusion: Don't Just Map the Brain; Emulate Its Constraints

Adam Marblestone is right that we are missing the "steering" component of intelligence. But I worry that the focus on Connectomics is a distraction—it’s a map of the territory, but not the laws of physics that govern the territory.

The brain’s efficiency comes not from its specific wiring (which varies wildly between humans and mice) but from the _constraints_ under which it operates: energy minimization, sparse predictive coding, and homeostatic regulation.

If we want to build AI that learns from "little data," we shouldn't just look for the right loss function. We should look for the right _environment_—a constrained environment where the agent is forced to model its own internal state. That is the "missing something fundamental" Adam is looking for. The secret sauce isn't in the genome’s "Python code"; it’s in the fact that the brain is a survival machine that had to learn to predict itself to stay alive.
