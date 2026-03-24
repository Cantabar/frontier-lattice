# Corm Brain — DGX Spark Implementation

See Warp plan "Corm Brain — DGX Spark Implementation" for the canonical version of this document.

This file is kept in the repo for reference. The Warp plan is the source of truth and contains the full implementation details including:

- Dual-model strategy: Nemotron 3 Super (120B-A12B) as primary + Nemotron 3 Nano (30B-A3B) as fast fallback
- Inference server setup via Ollama (stable), community vLLM Docker (NVFP4), and TRT-LLM Config C (future)
- Corm-brain service architecture with phase-based model routing
- Docker Compose for DGX Spark deployment
- Resource budget (~111 GB for both models loaded)
- Lore integration via 1M context system prompt injection
