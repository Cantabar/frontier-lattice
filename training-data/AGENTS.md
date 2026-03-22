# Training Data

This directory stores data used to fine-tune local LLMs for targeted behavior. Contents may include curated prompt-completion pairs, domain-specific corpora, and other artifacts needed for model tuning workflows.

## Structure

Data sources are organized into subdirectories by origin:

- `keep/` — Lore from Eve Frontier's The Keep (https://evefrontier.com/en/thekeep). Contains its own scraper, curation scripts, and training wrapper. See `README.md` for the full workflow.

## Conventions

- Replace "Organization" with "Tribe" in all training data to match Eve Frontier terminology.
- Generated artifacts (`raw/`, `datasets/`, `output/`) are gitignored and reproducible from source scripts.
- Training datasets use the ChatML JSONL schema for compatibility with common fine-tuning tools.
