# AI/ML Engineering — Model Training, Fine-Tuning, Evaluation & MLOps

## Purpose

Enterprise-grade AI/ML engineering for training, fine-tuning, evaluating, and deploying models — from LoRA adapters to clinical validation pipelines. Covers the full ML lifecycle: data preparation, model selection, training methodology, hyperparameter optimization, evaluation, deployment, monitoring, and continuous improvement. Built for KODA KENKŌ (healthcare AI), Kurahi (agent infrastructure), and KODA FLOW (identity adapters).

## Triggers

Use this skill when the task involves:

- Training or fine-tuning a model (LoRA, QLoRA, full fine-tune, RLHF, DPO)
- Evaluating model quality (benchmarks, human eval, automated metrics)
- Setting up ML pipelines (data processing, training, validation, deployment)
- Debugging training issues (loss spikes, convergence problems, overfitting)
- Designing model architectures or selecting base models
- MLOps: experiment tracking, model registry, deployment strategies
- Clinical/healthcare AI validation (sensitivity, specificity, bias, fairness)
- Inference optimization (quantization, distillation, serving)
- Any prompt involving: train, fine-tune, LoRA, QLoRA, RLHF, DPO, benchmark, eval, loss, convergence, GPU, inference, quantization, GGUF, ONNX, vLLM, TGI, model selection, hyperparameter, overfitting

## Core Knowledge

### Model Selection Framework

When choosing a base model, evaluate across five dimensions:

1. **Capability** — Does it perform on the target task?
2. **Size / Latency** — Can it run within budget (GPU memory, inference time)?
3. **License** — Can we use it commercially? In healthcare? With fine-tuning?
4. **Ecosystem** — Tooling support (HuggingFace, vLLM, quantization tools)?
5. **Data privacy** — Can we host it? Does it need to stay on-premises?

### Fine-Tuning Methods (ranked by resource cost)

| Method             | GPU Requirement        | Data Needed              | Use Case                           |
| ------------------ | ---------------------- | ------------------------ | ---------------------------------- |
| **LoRA**           | 1× consumer GPU (24GB) | 100-10K examples         | Domain adaptation, identity, style |
| **QLoRA**          | 1× consumer GPU (16GB) | 100-10K examples         | Same as LoRA, lower memory         |
| **Full fine-tune** | 8× A100 (80GB)         | 10K-1M examples          | Fundamental capability changes     |
| **RLHF / DPO**     | 8× A100                | 1K-100K preference pairs | Alignment, safety, preference      |
| **RAG**            | CPU (no training)      | External knowledge base  | Factual grounding, knowledge       |

### LoRA Configuration Guidelines

```python
# Conservative (safe, reliable) — start here
lora_config = {
    "r": 16,                    # rank: 8-64 (higher = more capacity, more overfit risk)
    "lora_alpha": 32,           # scaling: usually 2× r
    "target_modules": ["q_proj", "v_proj", "k_proj", "o_proj"],  # attention only = safe
    "lora_dropout": 0.05,       # regularization: 0.05-0.1
    "bias": "none",
    "task_type": "CAUSAL_LM",
}

# Aggressive (more capacity, more risk) — for complex adaptations
lora_config_aggressive = {
    "r": 64,
    "lora_alpha": 128,
    "target_modules": ["q_proj", "v_proj", "k_proj", "o_proj",
                       "gate_proj", "up_proj", "down_proj"],  # attention + MLP
    "lora_dropout": 0.1,
}
```

### Loss Curve Diagnosis

| Pattern                         | Problem                | Action                                                  |
| ------------------------------- | ---------------------- | ------------------------------------------------------- |
| Loss not decreasing             | Learning rate too low  | Increase LR by 2-5×                                     |
| Loss spikes then crashes        | LR too high            | Reduce LR, add gradient clipping                        |
| Loss decreases then plateaus    | Model capacity reached | Increase rank `r`, add more data                        |
| Training loss ↓ but eval loss ↑ | Overfitting            | Increase dropout, reduce `r`, fewer epochs              |
| Loss oscillating                | Batch size too small   | Increase batch size or use gradient accumulation        |
| Loss NaN                        | Numerical instability  | Check for NaN in data, reduce LR, add gradient clipping |

### Evaluation Framework

#### For General Models

```
1. Automated benchmarks: MMLU, HumanEval, GSM8K, HellaSwag, etc.
2. Domain-specific tests: custom test set from target distribution
3. Human evaluation: blind A/B testing, preference ratings
4. Red-teaming: adversarial prompts, edge cases, safety checks
5. Latency/throughput: tokens/sec, time-to-first-token, memory usage
```

#### For Healthcare/Clinical Models (KODA KENKŌ specific)

```
1. Sensitivity (recall): true positive rate — what % of actual positives caught?
2. Specificity: true negative rate — what % of actual negatives correctly excluded?
3. PPV (precision): positive predictive value
4. NPV: negative predictive value
5. AUC-ROC: area under ROC curve
6. F1 score: harmonic mean of precision and recall
7. Calibration: predicted probabilities match observed frequencies
8. Fairness: equal performance across demographic subgroups
9. Robustness: performance under distribution shift, adversarial input
10. Clinical utility: does the model change clinical decisions for the better?
```

### Quantization Guide

| Format        | Size Reduction | Quality Impact                | Best For            |
| ------------- | -------------- | ----------------------------- | ------------------- |
| FP16          | 50%            | None (lossless for inference) | GPU serving         |
| INT8          | 75%            | <0.1% accuracy loss           | GPU/CPU serving     |
| INT4 (GPTQ)   | 87.5%          | 0.5-2% accuracy loss          | GPU serving         |
| Q4_K_M (GGUF) | 87.5%          | 1-3% accuracy loss            | CPU/local serving   |
| Q2_K (GGUF)   | 93.75%         | 3-8% accuracy loss            | Extreme compression |

### MLOps Stack (minimum viable)

```
Experiment tracking:  MLflow or Weights & Biases
Model registry:       HuggingFace Hub or MLflow Registry
Data versioning:      DVC or Git LFS
Pipeline orchestration: Prefect or Airflow (if complex)
Serving:              vLLM (GPU), llama.cpp (CPU), TGI (GPU)
Monitoring:           Prometheus metrics + custom eval cron
```

### GPU Selection

| Task                | Minimum              | Recommended     |
| ------------------- | -------------------- | --------------- |
| LoRA (7B)           | RTX 3090/4090 (24GB) | A6000 (48GB)    |
| LoRA (70B)          | A100 80GB            | 2× A100         |
| Full fine-tune (7B) | 4× A100              | 8× A100         |
| Inference (7B)      | RTX 3060 (12GB) INT4 | A10 (24GB) FP16 |
| Inference (70B)     | 2× RTX 3090 INT4     | A100 FP16       |

### Training Data Quality Checklist

Before training, verify:

- [ ] No PII/PHI in training data (healthcare context: CRITICAL)
- [ ] No duplicates (deduplication pass completed)
- [ ] Format consistency (every example follows the same template)
- [ ] Label quality (for supervised tasks: spot-check 100 examples)
- [ ] Train/val/test split (80/10/10 minimum; time-based split for temporal data)
- [ ] No leakage between splits (same document/patient/entity not in train AND test)
- [ ] Class balance checked (if classification: address imbalance via weighting/oversampling)
- [ ] Minimum example count per category (≥50 for statistical validity)

### Common Failure Modes

1. **Catastrophic forgetting** — Model loses general capabilities. Mitigation: lower LR, LoRA instead of full fine-tune, mix in general data.
2. **Overfitting on small data** — Loss looks great, real-world performance terrible. Mitigation: more dropout, weight decay, early stopping.
3. **Data contamination** — Benchmarks leaked into training data. Mitigation: careful data provenance, decontamination checks.
4. **Reward hacking (RLHF)** — Model optimizes the metric, not the intent. Mitigation: multi-metric evaluation, human oversight.
5. **Distribution shift** — Training distribution ≠ deployment distribution. Mitigation: monitor drift, periodic retraining.
6. **Prompt sensitivity** — Tiny prompt changes cause large output changes. Mitigation: evaluate across prompt variations, report variance.

## Decision Framework

When someone says "let's fine-tune a model" — ask these questions before agreeing:

1. **Can this be solved with prompt engineering instead?** Try 10-shot prompting first.
2. **Can this be solved with RAG?** If the need is factual grounding, not style/tone.
3. **Is the base model already good enough?** Benchmark before fine-tuning. Measure the gap.
4. **Do we have enough data?** <100 examples: consider few-shot prompting. 100-1K: LoRA. 1K+: fine-tuning viable.
5. **How will we evaluate?** If we can't measure improvement, we can't train.
6. **What's the serving plan?** Training is 20% of the work. Serving the model is 80%.

## Production Deployment Checklist

- [ ] Model weights stored with version hash
- [ ] Evaluation results documented (before/after metrics)
- [ ] Serving latency measured and within SLA
- [ ] GPU memory usage profiled
- [ ] Fallback behavior defined (what happens if model is unavailable?)
- [ ] Monitoring: request rate, latency p50/p95/p99, error rate, token usage
- [ ] Rollback plan (previous model version warm and ready)
- [ ] Canary deployment: 5% traffic → monitor → 100%
- [ ] Healthcare: model card published (intended use, limitations, performance across subgroups)

## Key Libraries & Tools

- **Training:** transformers, peft, trl, axolotl, unsloth
- **Evaluation:** lm-evaluation-harness, custom test suites
- **Serving:** vLLM, TGI, llama.cpp, Ollama
- **Tracking:** MLflow, W&B
- **Quantization:** bitsandbytes, GPTQ, GGUF/llama.cpp
- **Data:** datasets, DVC

## Anti-Patterns

- ❌ Fine-tuning without a baseline (measure the gap first)
- ❌ Training on the test set ("one weird trick")
- ❌ Reporting only one metric (accuracy is not enough)
- ❌ Ignoring inference cost (a great model that costs $100/query is not a product)
- ❌ Healthcare: training on data without explicit consent for ML use
- ❌ Healthcare: deploying without bias/fairness evaluation across demographic groups
- ❌ Using the instructor's default hyperparameters (they're for demo, not production)

---
