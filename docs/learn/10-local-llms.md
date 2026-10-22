---
id: 10-local-llms
title: Local language models and why bandwidth sets their speed
minutes: 40
focus: memory
live: [llm, memory.bandwidthGBs, memory.appBytes, memory.wiredBytes, memory.pressure, gpu.usage, gpu.freqMHz, power.gpuW, hardware.chip, hardware.memBytes]
---
## In plain words

A language model like Llama or Qwen is a huge list of numbers, its "weights": billions of them, several gigabytes. To run one on your Mac, the whole list has to fit on the Desk (memory).

To write each word, the Mac has to read every one of those numbers once, from the Desk to the GPU painters, along the Highway. The maths on each number is tiny. So the speed of writing is set almost entirely by Highway Speed: how many gigabytes a second the road carries, divided by how many gigabytes the model is. On this Mac that's about 153 ÷ 4.7, or roughly 33 words a second at the very best, for a typical small model.

Two tricks help. Squashing the numbers to fewer bits ("quantization") makes the model smaller, so each word needs less traffic. And reading your question at the start is a different job: the Mac reads all your words at once, which is limited by how fast the painters work, not by the Highway.

In the app: when Ollama or LM Studio is generating, the "What's happening" card does this sum with your numbers.

## The idea

### What's in a model

A large language model (LLM) is a neural network with billions of parameters, the weights. A model described as "8B" has about 8 billion. Running it means taking the text so far, turning it into tokens (pieces of words, roughly three-quarters of a word each for English), and pushing them through dozens of layers of matrix multiplications. The output is a probability for every possible next token. The runtime picks one, appends it, and goes again.

### Quantization: fewer bytes per weight

Weights are trained in 16-bit floating point, 2 bytes each, so an 8B model is about 16 GB. That doesn't fit comfortably in a 16 GB Mac. Quantization stores each weight in fewer bits, with a small scale factor shared by each block of weights. The llama.cpp project publishes measurements for Llama 3.1 8B:

| Format | Bits per weight | Size |
|---|---|---|
| F16 | 16.0 | 14.96 GiB |
| Q8_0 | 8.5 | 7.95 GiB |
| Q6_K | 6.6 | 6.14 GiB |
| Q4_K_M | 4.9 | 4.58 GiB |

Q4_K_M is a popular choice for local use (I didn't confirm which quantization each runtime picks by default): less than a third of the size, with a small loss in quality that llama.cpp measures as a change in perplexity.

### Why generation is bandwidth-bound

To produce one token, a dense model has to use every weight once. For each weight, the GPU does one multiply and one add. Lesson 9 showed what happens when the work per byte is that small: the GPU spends its time waiting for memory. So the speed limit is roughly:

```
tokens per second ≈ memory bandwidth ÷ bytes read per token
                  ≈ memory bandwidth ÷ model size
```

On this M5 with 153 GB/s and a 4.7 GB model, the ceiling is 153 ÷ 4.7 ≈ 33 tokens a second. The GPU's cores don't appear in the formula at all.

The best evidence comes from the llama.cpp project's long-running community benchmark, which runs the same model (Llama 7B at Q4_0, 3.56 GiB) on every Apple chip. Some rows, as of August 2026:

| Chip | Bandwidth | Generation (tokens/s) | Ceiling (bandwidth ÷ 3.82 GB) | Share of ceiling |
|---|---|---|---|---|
| M1 | 68 GB/s | 14.2 | 17.8 | 80% |
| M2 | 100 GB/s | 21.9 | 26.2 | 84% |
| M4 | 120 GB/s | 24.1 | 31.4 | 77% |
| M5 (10-core GPU) | 154 GB/s | 18.4 | 40.3 | 46% |
| M4 Pro | 273 GB/s | 50.7 | 71.5 | 71% |
| M4 Max | 546 GB/s | 83.1 | 143 | 58% |
| M5 Max | 614 GB/s | 119.9 | 161 | 75% |

(3.56 GiB is 3.82 GB. The table lists the base M5 at 154 GB/s; Apple says 153.) Generation tracks bandwidth closely across six years of chips, landing at 58 to 84% of the ceiling for most. The base M5 row is an outlier at 46%: the table marks it with a warning, and I couldn't find out why, so don't read much into it.

### Prompt processing is different

Before the first new token, the model has to read your whole prompt. All the prompt's tokens can go through each layer together, so each weight fetched from memory is used hundreds of times. That's high arithmetic intensity, and the GPU's compute becomes the limit instead. The same benchmark shows it plainly: going from M4 Pro to M5 Pro (similar bandwidth, 273 to 307 GB/s), prompt processing went from 440 to 1621 tokens a second, 3.7 times faster, thanks to the M5's Neural Accelerators, while generation went from 51 to 66 tokens a second, only 1.3 times faster, about the bandwidth gain. Apple's own MLX measurements on the base M5 say the same: time to first token 3.3 to 4 times faster than M4, generation 19 to 27% faster, tracking the bandwidth increase from 120 to 153 GB/s.

### The KV cache

Attention needs, for every earlier token, two vectors per layer, the keys and the values. Recomputing them for each new token would be wasteful, so runtimes keep them in memory: the KV cache. Its size is:

```
2 × layers × KV heads × head size × bytes per value × tokens of context
```

For Llama 3.1 8B (32 layers, 8 KV heads, head size 128, FP16) that's 128 KB per token, so 512 MB at Ollama's default 4096-token context and 4 GB at 32,000 tokens. It also has to be read for every new token, so long conversations get slower: the bytes per token are the weights plus the whole KV cache so far. Ollama can store the cache at 8-bit (`OLLAMA_KV_CACHE_TYPE=q8_0`), about half the memory.

### Mixture of experts

Some models, like Qwen 30B-A3B or gpt-oss-20B, are mixture-of-experts (MoE): many sets of weights, of which only a few are used per token. They need memory for all the weights, but each token reads only the active ones, so they generate much faster than their total size suggests. The simple formula underestimates them.

### Will it fit?

macOS doesn't let the GPU take all of memory. Metal reports a "recommended maximum working set" that's commonly around 75% of RAM on Macs with more memory; llama.cpp prints it at start-up. On a 16 GB Mac, an 8B model at Q4 (about 5 GB) plus its KV cache fits comfortably. A 14B model at Q4 (about 9 GB) fits but pushes memory pressure up. Anything bigger means heavy swapping, and at that point generation speed falls off a cliff, because the weights are now coming from the SSD.

### An analogy

Generating text is like a librarian who must read an entire encyclopedia, every page, to write each word of an answer. Reading a page takes a glance, so how fast the answer comes depends on how fast pages arrive from the stacks, the Highway, not on how fast the librarian thinks. A pocket edition (quantization) arrives faster. Reading your question at the start is different: the librarian can read the whole question against each page in one go, so a faster brain helps there.

## Watch it live

The reader looks for Ollama on 127.0.0.1:11434 and LM Studio on 127.0.0.1:1234, read-only, every two seconds. When a model is generating, the "What's happening" card switches to the local LLM story and shows the sum: your chip's peak bandwidth divided by the largest loaded model's size, labelled as a ceiling. The memory bandwidth reading should climb toward your peak, the particles should run at full flow, GPU usage should be high while GPU power stays moderate, and app or wired memory should be up by the model's size.

The app shows a ceiling, not a measured speed: neither runtime reports a live token rate without the app sitting in the middle of your requests, which it doesn't do. The "Measured" line only appears in demo mode. Ollama's size figure includes the KV cache, so the estimate comes out a little low.

## Try it

### 1. Work out your own ceiling (no install needed)

```bash
sysctl -n machdep.cpu.brand_string
```

Look up its bandwidth in the lesson 1 table (or Apple's tech specs), then try a few model sizes:

```bash
python3 -c 'bw=153; [print(f"{gb:>5} GB model: at most {bw/gb:5.1f} tokens/s") for gb in (2.0, 4.7, 9.0, 18.0)]'
```

Change `bw` to your chip's figure. Then measure how much of that peak your Mac actually reaches with the lesson 9 lab, `swift docs/learn/lab/bandwidth.swift gpu 10`. On this M5 it was about 125 GB/s, 82% of peak, so a realistic ceiling for a 4.7 GB model is nearer 125 ÷ 4.7 ≈ 27 tokens a second.

### 2. Run a model and watch (optional, needs Ollama, downloads about 5 GB, uses battery)

I didn't run this on the test machine because Ollama isn't installed there; the commands come from Ollama's documentation. If you have Ollama:

```bash
ollama run llama3.1:8b --verbose "Explain unified memory in three sentences."
ollama ps
ollama stop llama3.1:8b
```

`--verbose` prints the prompt evaluation rate and the eval (generation) rate in tokens per second. Compare the generation rate with your ceiling. `ollama ps` shows the loaded size and whether it's on the GPU ("100% GPU"). Models stay loaded for 5 minutes by default; `ollama stop` unloads it. While it generates, watch the card, the bandwidth reading and the memory map.

### 3. Prompt versus generation (optional, needs Ollama)

Paste a long prompt (a few pages of text) and ask for a one-line summary with `--verbose`. The prompt rate will be many times the generation rate. That gap is compute-bound work versus bandwidth-bound work, on the same model and the same chip.

## Check yourself

Q: Why doesn't a GPU with more cores generate text faster on the same chip?
A: Generation is limited by how fast weights arrive from memory, not by compute.

Q: A 9 GB model on a 153 GB/s chip. What's the ceiling?
A: About 17 tokens a second; expect roughly 60 to 80% of that.

Q: Why is prompt processing so much faster than generation?
A: All prompt tokens use each weight together, so each byte fetched does hundreds of operations. That's compute-bound.

Q: Why does a conversation slow down as it gets longer?
A: Each new token also reads the whole KV cache, which grows with the context.

Q: Why does a mixture-of-experts model beat the formula?
A: Each token reads only the active experts' weights, not the whole model.

## Go deeper

- [llama.cpp discussion 4167, Apple Silicon performance](https://github.com/ggml-org/llama.cpp/discussions/4167): the community table of prompt and generation speed for every chip.
- [Apple Machine Learning Research, LLMs with MLX and the M5 Neural Accelerators](https://machinelearning.apple.com/research/exploring-llms-mlx-m5): Apple's own statement that generation is bandwidth-bound and time to first token compute-bound.
- [llama.cpp quantize README](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md): sizes, bits per weight and speed for each quantization type.
- [Ollama FAQ](https://docs.ollama.com/faq): context length, keep-alive and KV cache quantization.
- [How the app works out the ceiling](../how-it-works.md#why-local-llms-are-bandwidth-bound): the formula as the card uses it, with every caveat.
