# AI/ML Infrastructure — HPC, Training, and Inference

## The MIT CSAIL / Stanford / UC Berkeley Lineage

MIT CSAIL's parallel computing tradition (Arvind, Charles Leiserson) and Stanford's data management expertise (Matei Zaharia — Spark, Christopher Ré — Snorkel) converge in modern AI infrastructure. UC Berkeley's AMPLab and RISELab birthed Spark, Ray, and MLflow. The key insight: AI infrastructure is a systems problem, not an ML problem.

---

## GPU Architecture for Engineers

### NVIDIA GPU Memory Hierarchy (H100 as reference)
```
L1 Cache:     256KB per SM          (bandwidth: ~20 TB/s, latency: ~30 cycles)
Shared Memory: 228KB per SM (configurable)  (bandwidth: ~20 TB/s)
L2 Cache:     50MB                   (bandwidth: ~7 TB/s)
HBM3:         80GB                   (bandwidth: 3.35 TB/s)
NVLink:       900 GB/s bidirectional  (GPU-to-GPU)
PCIe 5.0:     128 GB/s               (host-to-GPU)
```

**The bottleneck is always memory bandwidth, not compute.** Moving data from HBM to compute units dominates runtime. Matrix multiply is compute-bound only at very large dimensions.

### Tensor Core Programming
```
FMA: A[N,K] × B[K,M] + C[N,M] in a single instruction
FP16: 312 TFLOPS (H100)
FP8:  750 TFLOPS (H100, with Transformer Engine)
INT8: 750 TOPS

But: utilization is rarely > 50-70% in practice.
```

### Multi-GPU Topologies
```
NVSwitch (DGX H100): 8 GPUs, all-to-all 900 GB/s
Ring: GPUs in a ring, each connected to neighbors
Mesh: 2D grid, nearest-neighbor communication
```

**All-reduce bandwidth:** NVSwitch > Mesh > Ring. For collective operations in distributed training, topology matters enormously.

---

## Training Infrastructure

### Distributed Training Strategies

**Data Parallelism (DP):**
```
Each GPU has a full model copy.
Different batch on each GPU.
Gradients synchronized via all-reduce (NCCL/NVLink).
```
**When:** Model fits on single GPU. Large datasets.
**Bottleneck:** Gradient synchronization. All-reduce bandwidth.

**Tensor Parallelism (TP):**
```
Split weight matrices across GPUs.
Each GPU holds part of each layer.
Intermediate activations communicated between layers.
```
**When:** Single layer too large for one GPU.
**Cost:** High communication (every forward/backward pass). Requires high bandwidth (NVLink, not PCIe).

**Pipeline Parallelism (PP):**
```
Divide model layers across GPUs.
GPU 1: layers 1-10, GPU 2: layers 11-20, etc.
Micro-batching to keep all GPUs busy.
```
**When:** Model too deep for one GPU.
**Cost:** Pipeline bubbles (GPUs idle at batch boundaries). GPipe reduces bubbles with micro-batches.

**3D Parallelism (DP + TP + PP):**
Large-scale training (GPT-4, Llama 3, Claude) combines all three. Typically: TP within node (NVLink), PP across nodes within rack, DP across racks.

### ZeRO (Rajbhandari et al., 2020 — DeepSpeed / Microsoft)
Eliminates memory redundancy in data-parallel training.

| Stage | What's sharded | Memory reduction |
|-------|---------------|-----------------|
| ZeRO-1 | Optimizer states | 4× |
| ZeRO-2 | + Gradients | 8× |
| ZeRO-3 | + Parameters | Linear with N GPUs |

**ZeRO-3 + CPU offload:** Parameters offloaded to CPU RAM when not in use. Training Llama 70B on a single GPU possible (slow, but possible).

### Checkpointing and Fault Tolerance
**Training can fail at any time.** Recovery must be automatic:
- Checkpoint every N steps (configurable — trade off checkpoint cost vs. re-computation cost)
- Async checkpointing: write to CPU in background, don't block training
- Hydra: resume from checkpoint, re-initialize NCCL, continue

---

## Inference Serving

### The vLLM Approach (Kwon et al., 2023 — UC Berkeley)
**PagedAttention:** KV cache managed like virtual memory — blocks, not contiguous allocation. Eliminates KV cache fragmentation.

```
Traditional: Pre-allocate max KV cache per sequence → 80%+ wasted for variable-length generation
vLLM: Dynamic block allocation → nearly 100% KV cache utilization
→ 2-4× throughput improvement
```

### Continuous Batching
Don't wait for all sequences in a batch to finish. As each sequence completes, slot in a new request. Keeps GPU saturated.

### Model Quantization
```
FP32 → FP16: 2× smaller, minimal quality loss (mainstream)
FP16 → INT8: 2× smaller, <1% quality loss with calibration
INT8 → INT4: 2× smaller, measurable quality loss (needs GPTQ/AWQ)
```

**For us (KODA KENKŌ medical AI):** Model quantization must be validated against clinical accuracy metrics, not just perplexity. An INT4 model with 95% perplexity retention may have 80% accuracy on the specific medical task that matters.

### Speculative Decoding (Leviathan et al., 2023 — Google)
Use a small, fast "draft" model to generate candidate tokens. Verify with the large model in parallel. Accept correct tokens, discard incorrect ones.
```
Draft model (1M params, 0.5ms) → predicts 5 tokens
Main model (70B params, 50ms) → verifies all 5 in parallel (still 50ms)
Net: 2-3× speedup if draft model is accurate enough
```

---

## MLOps — Production ML

### Model Registry
```
Model: medical-bert-finetuned
  Version 1: trained 2026-01-15, accuracy 0.94, deployed to staging
  Version 2: trained 2026-03-01, accuracy 0.96, deployed to production
  Version 3: trained 2026-05-10, accuracy 0.97, in evaluation
```

### Feature Store (Feast, Tecton)
**Offline:** Feature computation for training. Spark/Dataflow on data warehouse. Point-in-time correct joins.
**Online:** Low-latency feature serving for inference. Redis/DynamoDB. Must match offline computation exactly.

**The training-serving skew problem:** Features computed differently in training vs. serving → model behaves differently in production. Feature stores solve this by using the same transformation logic in both paths.

### Model Monitoring
Not just "is the API up?" but "is the model still working?"
- **Data drift:** Has the input distribution changed? (patient demographics shifting)
- **Concept drift:** Has the relationship between inputs and outputs changed? (new disease variant)
- **Prediction drift:** Is the model output distribution changing unexpectedly?
- **Accuracy monitoring:** If ground truth arrives later (diagnosis confirmed), compare against prediction

### A/B Testing for Models
```
90% traffic → model_v2 (current production)
10% traffic → model_v3 (candidate)
Monitor: accuracy, latency, error rate, user satisfaction
After statistical significance → promote or rollback
```

---

## HPC Architecture for Training Clusters

### InfiniBand vs. RoCE
| | InfiniBand | RoCE (RDMA over Converged Ethernet) |
|---|---|---|
| Latency | ~1μs | ~2-5μs |
| Throughput | 400 Gb/s (NDR) | 400 Gb/s |
| Cost | Higher | Lower (uses Ethernet switches) |
| Ecosystem | Purpose-built | Ethernet-compatible |

**Training clusters:** InfiniBand for GPU clusters (lower tail latency). RoCE acceptable for smaller clusters.

### Storage for AI Workloads
```
Checkpointing: High write throughput, sequential I/O (Lustre, GPFS, Weka)
Dataset storage: High read throughput, random access (object storage + cache)
Inference: Low latency (local NVMe, distributed cache)
```

**For us (KoLo HPC):** The storage architecture must handle both training (write-heavy checkpointing) and inference (read-heavy, low-latency). Tiered storage: NVMe → SSD pool → object storage (S3-compatible).

### Slurm (Workload Manager)
Still the standard in HPC. Key concepts:
- **Partition:** Group of nodes (GPU partition, CPU partition, high-memory partition)
- **QoS:** Quality of Service — priority levels, resource limits
- **Job:** salloc (interactive) or sbatch (batch)
- **Job array:** Parameter sweep (same job, different parameters)

**Slurm for ML:** Integrate with PyTorch distributed (`torchrun` + Slurm environment variables for rendezvous).

---

## Inference Optimization Pipeline

```
PyTorch model
  ↓ TorchScript / torch.compile() (graph optimization, operator fusion)
ONNX export (framework-independent IR)
  ↓ ONNX Runtime / TensorRT (platform-specific optimization)
Optimized model (.engine for TensorRT, .onnx for ONNX Runtime)
  ↓ Quantization (FP16 → INT8, calibration dataset required)
Deployment-ready model
```

**TensorRT (NVIDIA):** Aggressive optimization for NVIDIA GPUs. Layer fusion, kernel auto-tuning, precision calibration. Can 5-10× improve inference latency vs. raw PyTorch.

**ONNX Runtime (Microsoft):** Multi-platform. Supports CPU (OpenVINO), GPU (CUDA, TensorRT EP), and specialized hardware. Good for deployment flexibility.
