/**
 * Context Optimizer - Pre-Reasoning Hook System
 * 
 * Optimizes context before LLM processing to reduce token usage
 * and improve reasoning quality by prioritizing relevant information.
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

interface OptimizerConfig {
  maxTokens: number;              // Maximum token budget
  compactionThreshold: number;    // Trigger compaction at this % of max (0-1)
  preserveRecent: number;         // Always keep N most recent items
  logPath?: string;               // Path for metrics logging
  verbose?: boolean;              // Enable console logging
}

interface ToolResult {
  id: string;
  tool: string;
  timestamp: number;
  content: string;
  tokens?: number;
}

interface MemoryEntry {
  id: string;
  date: string;
  content: string;
  importance: 'critical' | 'high' | 'medium' | 'low';
  tokens?: number;
}

interface ContextBlock {
  type: 'system' | 'tool_result' | 'memory' | 'user' | 'assistant';
  content: string;
  metadata?: Record<string, unknown>;
  tokens?: number;
}

interface OptimizationResult {
  originalTokens: number;
  optimizedTokens: number;
  ratio: number;
  itemsRemoved: number;
  itemsPreserved: number;
  timeMs: number;
  actions: string[];
}

interface Metrics {
  timestamp: string;
  operation: string;
  result: OptimizationResult;
}

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Fast token estimation using character count heuristics.
 * Rule of thumb: ~4 characters per token for English text.
 * Adjusts for code (more tokens) and whitespace (fewer tokens).
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  
  // Base estimation: 4 chars per token
  let estimate = Math.ceil(text.length / 4);
  
  // Adjust for code-heavy content (more tokens due to symbols)
  const codeIndicators = /[{}()\[\];=<>]/g;
  const codeMatches = text.match(codeIndicators)?.length || 0;
  if (codeMatches > text.length * 0.05) {
    estimate = Math.ceil(estimate * 1.2);
  }
  
  // Adjust for heavy whitespace (fewer tokens)
  const whitespaceRatio = (text.match(/\s/g)?.length || 0) / text.length;
  if (whitespaceRatio > 0.3) {
    estimate = Math.ceil(estimate * 0.9);
  }
  
  return estimate;
}

// ============================================================================
// Content Compaction Strategies
// ============================================================================

/**
 * Compact tool result by extracting key information.
 * Preserves: first line, errors, key data points, summary.
 */
function compactToolResult(result: ToolResult, maxTokens: number = 500): ToolResult {
  const content = result.content;
  const currentTokens = estimateTokens(content);
  
  if (currentTokens <= maxTokens) {
    return { ...result, tokens: currentTokens };
  }
  
  const lines = content.split('\n');
  const compacted: string[] = [];
  let tokenBudget = maxTokens;
  
  // Always keep first line (usually the most important)
  if (lines.length > 0) {
    compacted.push(lines[0]);
    tokenBudget -= estimateTokens(lines[0]);
  }
  
  // Extract error lines (critical)
  const errorLines = lines.filter(l => 
    /error|fail|exception|fatal/i.test(l)
  );
  for (const err of errorLines.slice(0, 5)) {
    if (estimateTokens(err) < tokenBudget) {
      compacted.push(err);
      tokenBudget -= estimateTokens(err);
    }
  }
  
  // Extract key-value pairs and important data
  const keyValueLines = lines.filter(l => 
    /^[\w-]+\s*[:=]\s*.+/.test(l) || 
    /^\s*"[\w-]+":\s*.+/.test(l)
  );
  for (const kv of keyValueLines.slice(0, 20)) {
    if (estimateTokens(kv) < tokenBudget) {
      compacted.push(kv);
      tokenBudget -= estimateTokens(kv);
    }
  }
  
  // Add truncation notice
  const originalLines = lines.length;
  const keptLines = compacted.length;
  compacted.push(`\n[Compacted: ${keptLines}/${originalLines} lines kept, ~${currentTokens - estimateTokens(compacted.join('\n'))} tokens saved]`);
  
  return {
    ...result,
    content: compacted.join('\n'),
    tokens: estimateTokens(compacted.join('\n'))
  };
}

/**
 * Compact memory entry by summarizing if too long.
 */
function compactMemory(entry: MemoryEntry, maxTokens: number = 300): MemoryEntry {
  const content = entry.content;
  const currentTokens = estimateTokens(content);
  
  if (currentTokens <= maxTokens) {
    return { ...entry, tokens: currentTokens };
  }
  
  // Keep first paragraph + bullet points + last paragraph
  const paragraphs = content.split(/\n\n+/);
  const compacted: string[] = [];
  let tokenBudget = maxTokens;
  
  // First paragraph
  if (paragraphs.length > 0 && estimateTokens(paragraphs[0]) < tokenBudget) {
    compacted.push(paragraphs[0]);
    tokenBudget -= estimateTokens(paragraphs[0]);
  }
  
  // Bullet points from middle
  for (const para of paragraphs.slice(1, -1)) {
    const bullets = para.split('\n').filter(l => /^[-*•]\s/.test(l));
    for (const bullet of bullets.slice(0, 5)) {
      if (estimateTokens(bullet) < tokenBudget) {
        compacted.push(bullet);
        tokenBudget -= estimateTokens(bullet);
      }
    }
  }
  
  // Last paragraph
  if (paragraphs.length > 1) {
    const last = paragraphs[paragraphs.length - 1];
    if (estimateTokens(last) < tokenBudget) {
      compacted.push(last);
    }
  }
  
  return {
    ...entry,
    content: compacted.join('\n\n') + `\n[Memory compacted from ~${currentTokens} tokens]`,
    tokens: estimateTokens(compacted.join('\n\n'))
  };
}

/**
 * Detect and merge redundant content blocks.
 */
function deduplicateBlocks(blocks: ContextBlock[]): ContextBlock[] {
  const seen = new Map<string, ContextBlock>();
  const result: ContextBlock[] = [];
  
  for (const block of blocks) {
    // Create a fingerprint (first 100 chars + type)
    const fingerprint = `${block.type}:${block.content.slice(0, 100)}`;
    
    if (!seen.has(fingerprint)) {
      seen.set(fingerprint, block);
      result.push(block);
    }
  }
  
  return result;
}

// ============================================================================
// Main Optimizer Class
// ============================================================================

export class ContextOptimizer {
  private config: OptimizerConfig;
  private logStream?: fs.WriteStream;
  
  constructor(config: Partial<OptimizerConfig> = {}) {
    this.config = {
      maxTokens: config.maxTokens ?? 100000,
      compactionThreshold: config.compactionThreshold ?? 0.7,
      preserveRecent: config.preserveRecent ?? 5,
      logPath: config.logPath ?? path.join(
        process.env.HOME || '~', 
        '.kolo/logs/context-optimizer.jsonl'
      ),
      verbose: config.verbose ?? false,
    };
    
    this.initLogging();
  }
  
  private initLogging(): void {
    try {
      const logDir = path.dirname(this.config.logPath!);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      this.logStream = fs.createWriteStream(this.config.logPath!, { flags: 'a' });
    } catch (e) {
      console.error('Failed to initialize logging:', e);
    }
  }
  
  private log(operation: string, result: OptimizationResult): void {
    const metrics: Metrics = {
      timestamp: new Date().toISOString(),
      operation,
      result,
    };
    
    if (this.logStream) {
      this.logStream.write(JSON.stringify(metrics) + '\n');
    }
    
    if (this.config.verbose) {
      console.log(`[ContextOptimizer] ${operation}:`, result);
    }
  }
  
  /**
   * Check if context needs optimization based on token count.
   */
  needsOptimization(context: string | ContextBlock[]): boolean {
    const tokens = typeof context === 'string' 
      ? estimateTokens(context)
      : context.reduce((sum, b) => sum + estimateTokens(b.content), 0);
    
    const threshold = this.config.maxTokens * this.config.compactionThreshold;
    return tokens > threshold;
  }
  
  /**
   * Get current token usage and budget status.
   */
  getTokenStatus(context: string | ContextBlock[]): {
    used: number;
    max: number;
    percentage: number;
    needsOptimization: boolean;
  } {
    const used = typeof context === 'string'
      ? estimateTokens(context)
      : context.reduce((sum, b) => sum + estimateTokens(b.content), 0);
    
    return {
      used,
      max: this.config.maxTokens,
      percentage: (used / this.config.maxTokens) * 100,
      needsOptimization: this.needsOptimization(context),
    };
  }
  
  /**
   * Optimize tool results, keeping recent ones intact.
   */
  optimizeToolResults(results: ToolResult[]): {
    optimized: ToolResult[];
    result: OptimizationResult;
  } {
    const startTime = Date.now();
    const actions: string[] = [];
    let itemsRemoved = 0;
    
    // Sort by timestamp, newest first
    const sorted = [...results].sort((a, b) => b.timestamp - a.timestamp);
    
    // Preserve recent N results fully
    const preserved = sorted.slice(0, this.config.preserveRecent);
    const candidates = sorted.slice(this.config.preserveRecent);
    
    // Compact older results
    const compacted = candidates.map(r => {
      const original = estimateTokens(r.content);
      const result = compactToolResult(r);
      if (result.tokens! < original) {
        actions.push(`Compacted ${r.tool} result: ${original} → ${result.tokens} tokens`);
      }
      return result;
    });
    
    // Calculate total tokens
    const originalTokens = results.reduce((sum, r) => sum + estimateTokens(r.content), 0);
    const optimized = [...preserved, ...compacted];
    const optimizedTokens = optimized.reduce((sum, r) => sum + (r.tokens ?? estimateTokens(r.content)), 0);
    
    const result: OptimizationResult = {
      originalTokens,
      optimizedTokens,
      ratio: optimizedTokens / originalTokens,
      itemsRemoved,
      itemsPreserved: optimized.length,
      timeMs: Date.now() - startTime,
      actions,
    };
    
    this.log('optimizeToolResults', result);
    
    return { optimized, result };
  }
  
  /**
   * Optimize memory entries based on importance and age.
   */
  optimizeMemory(entries: MemoryEntry[]): {
    optimized: MemoryEntry[];
    result: OptimizationResult;
  } {
    const startTime = Date.now();
    const actions: string[] = [];
    
    // Sort by importance then date
    const importanceOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...entries].sort((a, b) => {
      const impDiff = importanceOrder[a.importance] - importanceOrder[b.importance];
      if (impDiff !== 0) return impDiff;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
    
    // Compact based on importance
    const optimized = sorted.map(entry => {
      const maxTokens = entry.importance === 'critical' ? 1000 :
                        entry.importance === 'high' ? 500 :
                        entry.importance === 'medium' ? 300 : 150;
      
      const original = estimateTokens(entry.content);
      const result = compactMemory(entry, maxTokens);
      
      if (result.tokens! < original) {
        actions.push(`Compacted ${entry.importance} memory: ${original} → ${result.tokens} tokens`);
      }
      
      return result;
    });
    
    const originalTokens = entries.reduce((sum, e) => sum + estimateTokens(e.content), 0);
    const optimizedTokens = optimized.reduce((sum, e) => sum + (e.tokens ?? estimateTokens(e.content)), 0);
    
    const result: OptimizationResult = {
      originalTokens,
      optimizedTokens,
      ratio: optimizedTokens / originalTokens,
      itemsRemoved: 0,
      itemsPreserved: optimized.length,
      timeMs: Date.now() - startTime,
      actions,
    };
    
    this.log('optimizeMemory', result);
    
    return { optimized, result };
  }
  
  /**
   * Full context optimization - processes all block types.
   */
  optimizeContext(blocks: ContextBlock[]): {
    optimized: ContextBlock[];
    result: OptimizationResult;
  } {
    const startTime = Date.now();
    const actions: string[] = [];
    
    // Step 1: Deduplicate
    const deduped = deduplicateBlocks(blocks);
    if (deduped.length < blocks.length) {
      actions.push(`Removed ${blocks.length - deduped.length} duplicate blocks`);
    }
    
    // Step 2: Compact each block type appropriately
    const optimized = deduped.map(block => {
      const originalTokens = estimateTokens(block.content);
      let content = block.content;
      
      if (block.type === 'tool_result' && originalTokens > 500) {
        const compacted = compactToolResult({
          id: 'temp',
          tool: (block.metadata?.tool as string) || 'unknown',
          timestamp: Date.now(),
          content: block.content,
        });
        content = compacted.content;
        if (compacted.tokens! < originalTokens) {
          actions.push(`Compacted tool_result: ${originalTokens} → ${compacted.tokens} tokens`);
        }
      }
      
      return {
        ...block,
        content,
        tokens: estimateTokens(content),
      };
    });
    
    const originalTokens = blocks.reduce((sum, b) => sum + estimateTokens(b.content), 0);
    const optimizedTokens = optimized.reduce((sum, b) => sum + (b.tokens ?? estimateTokens(b.content)), 0);
    
    const result: OptimizationResult = {
      originalTokens,
      optimizedTokens,
      ratio: optimizedTokens / originalTokens,
      itemsRemoved: blocks.length - optimized.length,
      itemsPreserved: optimized.length,
      timeMs: Date.now() - startTime,
      actions,
    };
    
    this.log('optimizeContext', result);
    
    return { optimized, result };
  }
  
  /**
   * Quick string optimization for raw context.
   */
  optimizeRawContext(context: string, targetTokens?: number): {
    optimized: string;
    result: OptimizationResult;
  } {
    const startTime = Date.now();
    const actions: string[] = [];
    const originalTokens = estimateTokens(context);
    const target = targetTokens ?? this.config.maxTokens;
    
    if (originalTokens <= target) {
      return {
        optimized: context,
        result: {
          originalTokens,
          optimizedTokens: originalTokens,
          ratio: 1,
          itemsRemoved: 0,
          itemsPreserved: 1,
          timeMs: Date.now() - startTime,
          actions: ['No optimization needed'],
        },
      };
    }
    
    // Strategy: Keep beginning and end, truncate middle
    const keepRatio = target / originalTokens;
    const keepChars = Math.floor(context.length * keepRatio);
    const frontChars = Math.floor(keepChars * 0.6);
    const backChars = keepChars - frontChars;
    
    const front = context.slice(0, frontChars);
    const back = context.slice(-backChars);
    const truncationNotice = `\n\n[...${context.length - frontChars - backChars} characters truncated...]\n\n`;
    
    const optimized = front + truncationNotice + back;
    const optimizedTokens = estimateTokens(optimized);
    
    actions.push(`Truncated middle: kept ${frontChars} front + ${backChars} back chars`);
    
    const result: OptimizationResult = {
      originalTokens,
      optimizedTokens,
      ratio: optimizedTokens / originalTokens,
      itemsRemoved: 1,
      itemsPreserved: 1,
      timeMs: Date.now() - startTime,
      actions,
    };
    
    this.log('optimizeRawContext', result);
    
    return { optimized, result };
  }
  
  /**
   * Close resources.
   */
  close(): void {
    if (this.logStream) {
      this.logStream.end();
    }
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const optimizer = new ContextOptimizer({ verbose: true });
  
  if (command === 'status') {
    // Read from stdin or file
    const input = args[1] ? fs.readFileSync(args[1], 'utf-8') : '';
    const status = optimizer.getTokenStatus(input);
    console.log(JSON.stringify(status, null, 2));
  } else if (command === 'optimize') {
    const input = args[1] ? fs.readFileSync(args[1], 'utf-8') : '';
    const targetTokens = args[2] ? parseInt(args[2]) : undefined;
    const { optimized, result } = optimizer.optimizeRawContext(input, targetTokens);
    console.log('=== OPTIMIZATION RESULT ===');
    console.log(JSON.stringify(result, null, 2));
    console.log('\n=== OPTIMIZED CONTENT ===');
    console.log(optimized);
  } else {
    console.log(`
Context Optimizer CLI

Usage:
  npx ts-node context-optimizer.ts status [file]     - Show token status
  npx ts-node context-optimizer.ts optimize [file]   - Optimize context

Examples:
  echo "content" | npx ts-node context-optimizer.ts status
  npx ts-node context-optimizer.ts optimize context.txt 50000
    `);
  }
  
  optimizer.close();
}

// ============================================================================
// Exports
// ============================================================================

export {
  estimateTokens,
  compactToolResult,
  compactMemory,
  deduplicateBlocks,
  OptimizerConfig,
  ToolResult,
  MemoryEntry,
  ContextBlock,
  OptimizationResult,
};
