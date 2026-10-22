---
id: 07-neural-engine
title: The Neural Engine and the other matrix units
minutes: 25
focus: ane
live: [power.aneW, power.cpuW, power.gpuW, cpu.cores, hardware.aneCores]
---
## In plain words

The Neural Engine is a specialist on the chip that does one kind of maths extremely well: the maths behind recognising faces, reading text in photos, and understanding speech. It can't do anything else, which is exactly why it's so fast and uses so little energy.

Apps don't get to command it directly. They hand a task to Apple's Core ML framework, which decides whether the specialist, the GPU painters or the Fast Workers should do each piece.

On this Mac, classifying pictures on the Neural Engine was about 4 times faster than on the Fast Workers and used about an eighth of the energy per picture.

In the app: the Neural Engine block glows with its power use. It sits dark most of the time.

## The idea

Most machine learning, from recognising text in a photo to running a language model, boils down to one operation repeated billions of times: multiply two matrices and add the result to a third. A general-purpose core can do it, but it spends most of its energy on fetching, decoding and scheduling instructions rather than on the multiplications. Hardware built only for matrix maths skips all that overhead.

Apple Silicon has four places that can do this work, and it helps to know all four:

1. The Neural Engine (ANE), a separate block on the SoC with 16 cores on every M-series chip.
2. The GPU, which is good at matrix maths anyway, and from the M5 on has a Neural Accelerator inside every GPU core.
3. A matrix unit attached to the CPU clusters. On M1 to M3 it's Apple's private AMX instructions; the M4 added Arm's standard Scalable Matrix Extension (SME). Apple's Accelerate framework uses it.
4. The plain CPU vector units, for anything else.

### What the Neural Engine is

The ANE first appeared in the A11 iPhone chip in 2017. Apple's machine-learning team wrote that it delivered 0.6 trillion FP16 operations per second then, and that the 16-core version of 2021 reached 15.8 trillion, 26 times more. Apple quotes ANE peak throughput in TOPS (trillions of operations per second): 11 for M1, 15.8 for M2, 18 for M3 and 38 for M4. Be careful with that jump: reporting at the time noted that the M4 figure counts INT8 operations while the earlier ones counted FP16, so the like-for-like gain is much smaller than it looks.

The ANE is a fixed-function engine. It doesn't run arbitrary programs. A model is compiled ahead of time into a graph of operations the ANE supports, chiefly convolutions, matrix multiplies, element-wise maths and common activation functions, in 16-bit floating point, and the ANE runs that whole graph as one job. Researchers who reverse-engineered it describe it as fundamentally a convolution engine with its own on-chip memory, where staying inside that memory is the difference between fast and slow.

### Why it's efficient

Fixed function plus local memory plus low precision. No instruction decoding per operation. Weights and activations stay close to the multipliers. FP16 needs half the memory traffic and far less silicon per multiply than FP32. Apple's 2022 paper on running transformers on the ANE measured a distilled BERT model on an iPhone 13 at 3.47 ms per inference while drawing 0.454 W.

### What it can't do

There is no public way to program it. Apple doesn't document the ANE's instruction set, and apps can't target it directly. They go through Core ML (or frameworks built on it, like Vision and Natural Language), which decides at load time whether each part of a model runs on the ANE, the GPU or the CPU. A model with an operation the ANE doesn't support, the wrong tensor layout, or dynamic shapes may run partly or wholly elsewhere. Apple's own guidance for the ANE asks for a specific data layout (4D, channels first, the last axis aligned to 64 bytes) to avoid heavy padding.

That's why local language model tools like Ollama, llama.cpp and MLX use the GPU, not the ANE: they need flexible operations and full control. The ANE shines at fixed, well-known models running all day at low power: Live Text, photo analysis, face recognition, voice isolation, dictation.

### What the app can and can't show

macOS has no public utilisation counter for the ANE and doesn't report its core count, so the app draws the Neural Engine as one block and lights it by ANE power, from the same CLPC energy counters as CPU and GPU watts. Watts are a fair proxy for activity: the ANE draws next to nothing when idle.

### An analogy

The CPU is a skilled chef who can cook anything from a recipe. The ANE is a commercial dough sheeter: you can't cook a curry in it, but if you need a thousand identical sheets of pasta it does them faster than any chef, with a fraction of the effort, and it never reads a recipe. Core ML is the kitchen manager who looks at an order and decides which parts go to the machine and which to a person.

## Watch it live

Open the power panel and the chip panel. The Neural Engine block sits beside the GPU and CPU clusters. When you're idle, ANE power reads 0 or a few hundredths of a watt.

Things that are likely to wake it (Apple doesn't say which hardware each feature uses, so these are candidates to test, not facts): selecting text in a photo in Preview or Photos (Live Text), Photos analysing a new import, dictation, Voice Isolation on a video call, background removal in Keynote or Preview. Try one and watch for the ANE number to jump to a few tenths of a watt and fall back.

## Try it

### 1. Make the Neural Engine work

The course ships a small Swift program that runs Apple's built-in Vision image classifier on a generated test picture, over and over. No model download, no camera. From the repository root:

```bash
swift docs/learn/lab/ane.swift 20
```

It prints images per second for 20 seconds. On this M5 Air it classified about 125 images a second. ANE power rose to about 0.8 W, CPU power was about 4.6 W (the loop itself, image preparation and Vision's bookkeeping on one thread), and the GPU stayed idle.

### 2. The same job without the Neural Engine

The same program can tell Vision to use only the CPU:

```bash
swift docs/learn/lab/ane.swift 20 cpu
```

Here it managed about 33 images a second, ANE power stayed at 0, and CPU power rose to about 12 W. So roughly 4 times slower for more than twice the power: per image, the CPU-only path used about 8 times the energy (12 W ÷ 33 against about 5.4 W ÷ 125). Your numbers will differ; the ratio is the lesson. This one warms the Mac a little.

### 3. Live Text by hand

Take a screenshot of this page (Shift-Command-4), open it in Preview, and drag across the text to select it. Watch ANE power during the first selection. If it stays at 0, the work ran on the GPU or CPU instead, or finished between two samples; Core ML decides, and the app can only report what happened.

## Check yourself

Q: Why can't Ollama or llama.cpp just run on the Neural Engine?
A: There's no public interface to program it; only Core ML can schedule work there, and LLM runtimes need flexible operations and control that Core ML's ANE path doesn't give them, so they use the GPU.

Q: Why is ANE power a reasonable stand-in for ANE activity in the app?
A: macOS exposes no ANE utilisation counter, and the ANE draws almost nothing when idle, so its power tracks how much it's doing.

Q: What precision does the ANE mainly work in?
A: 16-bit floating point (FP16).

Q: Why is the M4's 38 TOPS not directly comparable with the M3's 18 TOPS?
A: The M4 figure is quoted for INT8 operations, the M3 figure for FP16.

## Go deeper

- [Apple Machine Learning Research, Deploying transformers on the Apple Neural Engine (2022)](https://machinelearning.apple.com/research/neural-engine-transformers): Apple's own ANE history and layout rules.
- [Matthijs Hollemans, The Neural Engine: what do we know about it?](https://github.com/hollance/neural-engine): the classic community FAQ on what runs on the ANE and why.
- [Bryngelson, Apple Neural Engine: architecture, programming and performance (arXiv, 2026)](https://arxiv.org/abs/2606.22283): a large reverse-engineering study that measured M1 and M5 directly.
- [corsix/amx](https://github.com/corsix/amx): documentation of Apple's undocumented CPU matrix instructions.
- [Apple Machine Learning Research, LLMs with MLX and the M5 Neural Accelerators](https://machinelearning.apple.com/research/exploring-llms-mlx-m5): matrix units in the GPU, the M5's newest addition.
