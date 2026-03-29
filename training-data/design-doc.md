# Training Data

## Overview

The training-data directory contains tools and data for fine-tuning local LLMs on Eve Frontier domain knowledge. It scrapes lore from The Keep (evefrontier.com), curates it into training datasets, and provides scripts to fine-tune models via Unsloth (GPU) or llama.cpp (CPU). The resulting models power the corm-brain's contextual understanding of Eve Frontier lore.

## Architecture

```
The Keep (evefrontier.com/en/thekeep)
    │  Playwright headless browser
    ▼
keep/raw/               One markdown file per lore entry (YAML frontmatter)
    │  curate.py
    ▼
keep/datasets/
    ├─ lore-qa.jsonl          Template-generated Q&A pairs (2-3 per entry)
    └─ lore-instruct.jsonl    Full lore as instruct-tuning pairs
    │  train.sh
    ▼
keep/output/
    ├─ lora-adapter/     LoRA weights (Unsloth)
    └─ model.gguf        Merged GGUF (optional)
```

### Components

- **Scraper** (`keep/scraper/`) — Playwright-based Node.js scraper for The Keep SPA. Reads URLs from `keep-urls.json` manifest, outputs one markdown file per lore entry in `keep/raw/` with YAML frontmatter (title, slug, category, source URL, timestamp).
- **Curation** (`keep/scripts/curate.py`) — Python script that transforms raw markdown into two JSONL datasets using ChatML schema (`{messages: [{role, content}]}`). Generates category-aware Q&A pairs and instruct-tuning pairs. Automatically replaces "Organization" → "Tribe" to match Eve Frontier terminology.
- **Training** (`keep/scripts/train.sh`) — wrapper script supporting two backends:
  - **Unsloth** (GPU, recommended) — fast QLoRA fine-tuning. Default base model: Phi-3.5 Mini Instruct.
  - **llama.cpp** (CPU) — LoRA training on GGUF models for machines without a GPU.

## Tech Stack

- **Scraping:** Node.js, Playwright (Chromium)
- **Curation:** Python 3
- **Training:** Unsloth (Python, CUDA) or llama.cpp (C++)
- **Dataset Format:** ChatML JSONL

## Configuration

No environment variables. Paths are relative within the directory. The scraper reads `keep-urls.json` for the list of lore entries to scrape.

## Data Model

- **Raw lore** (`keep/raw/*.md`) — markdown with YAML frontmatter: title, slug, category (Keepedia/Stories/Fragments), source URL, scrape timestamp
- **lore-qa.jsonl** — Q&A pairs varying by category (Keepedia → "Explain the concept of…", Stories → "Tell me the story of…", Fragments → "What does the fragment reveal…")
- **lore-instruct.jsonl** — full lore text as instruct-tuning pairs with an Eve Frontier lore expert system prompt

## Recommended Base Models

- Best quality (GPU): Llama 3 8B Instruct (~4.5 GB 4-bit)
- Fast iteration (GPU): Phi-3.5 Mini Instruct (~2.4 GB 4-bit)
- CPU-only: Phi-3.5 Mini GGUF Q4_K_M (~2.4 GB)
- Minimal resources: Qwen2.5 1.5B Instruct (~1 GB 4-bit)

## Deployment

Not deployed — training runs locally. Output artifacts (LoRA adapters, merged GGUF) are consumed by corm-brain's LLM inference stack. The `raw/`, `datasets/`, and `output/` directories contain generated artifacts and are gitignored.

## Features

- Playwright-based headless scraper for The Keep SPA (evefrontier.com)
- YAML-frontmatter markdown output per lore entry (title, slug, category, source URL, timestamp)
- Category-aware Q&A pair generation (Keepedia/Stories/Fragments templates)
- Instruct-tuning dataset generation with Eve Frontier lore expert system prompt
- Automatic “Organization” → “Tribe” terminology replacement
- Two training backends: Unsloth (GPU, QLoRA) and llama.cpp (CPU, LoRA)
- Multiple recommended base models from 1B to 8B parameters

## Open Questions / Future Work

- Automated re-scraping when new Keep entries are published
- Integration with corm-brain's retrieval-augmented generation (RAG) as an alternative to fine-tuning
- Evaluation benchmarks for lore accuracy
- Multi-language lore support
