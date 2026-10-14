/**
 * Context Health Monitor
 * 
 * Monitors and diagnoses context health issues:
 * - Token budget tracking
 * - Lost-in-middle detection
 * - Context freshness analysis
 * - Degradation warnings
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

interface HealthConfig {
  maxTokens: number;
  warningThresholds: number[];    // e.g., [0.7, 0.85, 0.95]
  middleThreshold: number;        // Position considered "middle" (0-1)
  staleHoursVolatile: number;     // Hours before volatile data is stale
  staleDaysStable: number;        // Days before stable data is stale
  logPath?: string;
}

interface ContextBlock {
  id: string;
  type: 'system' | 'user' | 'assistant' | 'tool_result' | 'memory' | 'file';
  content: string;
  timestamp?: number;
  importance?: 'critical' | 'high' | 'medium' | 'low';
  source?: string;
  tokens?: number;
}

interface TokenBudgetStatus {
  used: number;
  max: number;
  percentage: number;
  remaining: number;
  warningLevel: 'ok' | 'warning' | 'critical' | 'exceeded';
  projection?: {
    turnsRemaining: number;
    tokensPerTurn: number;
  };
}

interface MiddleAnalysis {
  blocksInMiddle: {
    id: string;
    type: string;
    importance: string;
    position: number;
    preview: string;
  }[];
  criticalBuried: boolean;
  highBuried: boolean;
  recommendation?: string;
}

interface FreshnessAnalysis {
  staleBlocks: {
    id: string;
    type: string;
    ageHours: number;
    source?: string;
    recommendation: string;
  }[];
  averageAgeHours: number;
  oldestBlock?: {
    id: string;
    ageHours: number;
  };
}

interface DegradationAnalysis {
  repetitionScore: number;        // 0-1, higher = more repetition
  confusionIndicators: string[];
  qualityScore: number;           // 0-100
  warnings: string[];
}

interface HealthReport {
  timestamp: string;
  overall: 'healthy' | 'warning' | 'degraded' | 'critical';
  tokenBudget: TokenBudgetStatus;
  middleAnalysis: MiddleAnalysis;
  freshness: FreshnessAnalysis;
  degradation: DegradationAnalysis;
  recommendations: string[];
}

// ============================================================================
// Utility Functions
// ============================================================================

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function extractPreview(content: string, maxLength: number = 100): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return clean.slice(0, maxLength - 3) + '...';
}

// ============================================================================
// Context Health Monitor Class
// ============================================================================

export class ContextHealthMonitor {
  private config: HealthConfig;
  private turnHistory: number[] = [];  // Token counts per turn
  
  constructor(config: Partial<HealthConfig> = {}) {
    this.config = {
      maxTokens: config.maxTokens ?? 100000,
      warningThresholds: config.warningThresholds ?? [0.7, 0.85, 0.95],
      middleThreshold: config.middleThreshold ?? 0.6,
      staleHoursVolatile: config.staleHoursVolatile ?? 24,
      staleDaysStable: config.staleDaysStable ?? 7,
      logPath: config.logPath,
    };
  }
  
  // ==========================================================================
  // Token Budget Analysis
  // ==========================================================================
  
  analyzeTokenBudget(blocks: ContextBlock[]): TokenBudgetStatus {
    const tokens = blocks.map(b => b.tokens ?? estimateTokens(b.content));
    const used = tokens.reduce((sum, t) => sum + t, 0);
    const percentage = used / this.config.maxTokens;
    
    // Track for projection
    this.turnHistory.push(used);
    if (this.turnHistory.length > 20) {
      this.turnHistory.shift();
    }
    
    // Determine warning level
    let warningLevel: TokenBudgetStatus['warningLevel'] = 'ok';
    if (percentage >= 1) {
      warningLevel = 'exceeded';
    } else if (percentage >= this.config.warningThresholds[2]) {
      warningLevel = 'critical';
    } else if (percentage >= this.config.warningThresholds[1]) {
      warningLevel = 'critical';
    } else if (percentage >= this.config.warningThresholds[0]) {
      warningLevel = 'warning';
    }
    
    // Calculate projection
    let projection: TokenBudgetStatus['projection'];
    if (this.turnHistory.length >= 3) {
      const recentGrowth = this.turnHistory.slice(-3);
      const avgGrowth = (recentGrowth[2] - recentGrowth[0]) / 2;
      if (avgGrowth > 0) {
        const remaining = this.config.maxTokens - used;
        projection = {
          turnsRemaining: Math.floor(remaining / avgGrowth),
          tokensPerTurn: Math.round(avgGrowth),
        };
      }
    }
    
    return {
      used,
      max: this.config.maxTokens,
      percentage: Math.round(percentage * 100) / 100,
      remaining: this.config.maxTokens - used,
      warningLevel,
      projection,
    };
  }
  
  // ==========================================================================
  // Lost-in-Middle Analysis
  // ==========================================================================
  
  analyzeMiddle(blocks: ContextBlock[]): MiddleAnalysis {
    const totalTokens = blocks.reduce((sum, b) => sum + (b.tokens ?? estimateTokens(b.content)), 0);
    let currentPosition = 0;
    
    const middleBlocks: MiddleAnalysis['blocksInMiddle'] = [];
    let criticalBuried = false;
    let highBuried = false;
    
    for (const block of blocks) {
      const tokens = block.tokens ?? estimateTokens(block.content);
      const relativePosition = (currentPosition + tokens / 2) / totalTokens;
      
      // Check if in the "middle" zone (typically 30-70% of context)
      const isInMiddle = relativePosition > 0.3 && relativePosition < 0.7;
      const importance = block.importance ?? 'medium';
      
      if (isInMiddle && (importance === 'critical' || importance === 'high')) {
        middleBlocks.push({
          id: block.id,
          type: block.type,
          importance,
          position: Math.round(relativePosition * 100) / 100,
          preview: extractPreview(block.content),
        });
        
        if (importance === 'critical') criticalBuried = true;
        if (importance === 'high') highBuried = true;
      }
      
      currentPosition += tokens;
    }
    
    let recommendation: string | undefined;
    if (criticalBuried) {
      recommendation = 'CRITICAL: Move critical information to beginning or end of context';
    } else if (highBuried && middleBlocks.length > 3) {
      recommendation = 'Consider restructuring: important information buried in middle';
    }
    
    return {
      blocksInMiddle: middleBlocks,
      criticalBuried,
      highBuried,
      recommendation,
    };
  }
  
  // ==========================================================================
  // Freshness Analysis
  // ==========================================================================
  
  analyzeFreshness(blocks: ContextBlock[]): FreshnessAnalysis {
    const now = Date.now();
    const staleBlocks: FreshnessAnalysis['staleBlocks'] = [];
    const ages: number[] = [];
    let oldestBlock: FreshnessAnalysis['oldestBlock'];
    
    for (const block of blocks) {
      if (!block.timestamp) continue;
      
      const ageHours = (now - block.timestamp) / (1000 * 60 * 60);
      ages.push(ageHours);
      
      // Determine staleness based on content type
      const isVolatile = ['tool_result', 'user', 'assistant'].includes(block.type);
      const staleThreshold = isVolatile 
        ? this.config.staleHoursVolatile 
        : this.config.staleDaysStable * 24;
      
      if (ageHours > staleThreshold) {
        let recommendation = 'Consider refreshing this information';
        if (block.type === 'tool_result') {
          recommendation = 'Re-run tool to get current data';
        } else if (block.type === 'memory') {
          recommendation = 'Verify memory is still accurate';
        } else if (block.type === 'file') {
          recommendation = 'Re-read file to check for changes';
        }
        
        staleBlocks.push({
          id: block.id,
          type: block.type,
          ageHours: Math.round(ageHours * 10) / 10,
          source: block.source,
          recommendation,
        });
      }
      
      if (!oldestBlock || ageHours > oldestBlock.ageHours) {
        oldestBlock = { id: block.id, ageHours: Math.round(ageHours * 10) / 10 };
      }
    }
    
    return {
      staleBlocks,
      averageAgeHours: ages.length > 0 
        ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 
        : 0,
      oldestBlock,
    };
  }
  
  // ==========================================================================
  // Degradation Analysis
  // ==========================================================================
  
  analyzeDegradation(blocks: ContextBlock[]): DegradationAnalysis {
    const warnings: string[] = [];
    const confusionIndicators: string[] = [];
    
    // Check for repetition
    const contentHashes = new Map<string, number>();
    let repetitionCount = 0;
    
    for (const block of blocks) {
      const hash = block.content.slice(0, 200);
      const count = (contentHashes.get(hash) ?? 0) + 1;
      contentHashes.set(hash, count);
      if (count > 1) repetitionCount++;
    }
    
    const repetitionScore = blocks.length > 0 
      ? Math.min(1, repetitionCount / blocks.length) 
      : 0;
    
    if (repetitionScore > 0.2) {
      warnings.push(`High repetition detected: ${Math.round(repetitionScore * 100)}% of blocks have duplicates`);
    }
    
    // Check for confusion patterns in assistant responses
    const assistantBlocks = blocks.filter(b => b.type === 'assistant');
    const confusionPatterns = [
      /I('m| am) (not sure|confused|uncertain)/i,
      /as I (mentioned|said) (earlier|before|previously)/i,
      /wait,? (actually|no)/i,
      /let me (reconsider|rethink|start over)/i,
      /I (apologize|sorry) for the confusion/i,
    ];
    
    for (const block of assistantBlocks) {
      for (const pattern of confusionPatterns) {
        if (pattern.test(block.content)) {
          confusionIndicators.push(pattern.source);
        }
      }
    }
    
    if (confusionIndicators.length > 2) {
      warnings.push('Multiple confusion indicators detected - context may need cleanup');
    }
    
    // Calculate quality score
    let qualityScore = 100;
    qualityScore -= repetitionScore * 30;
    qualityScore -= Math.min(30, confusionIndicators.length * 10);
    
    const tokenStatus = this.analyzeTokenBudget(blocks);
    if (tokenStatus.warningLevel === 'critical') qualityScore -= 20;
    if (tokenStatus.warningLevel === 'exceeded') qualityScore -= 40;
    
    return {
      repetitionScore: Math.round(repetitionScore * 100) / 100,
      confusionIndicators: Array.from(new Set(confusionIndicators)).slice(0, 5),
      qualityScore: Math.max(0, Math.round(qualityScore)),
      warnings,
    };
  }
  
  // ==========================================================================
  // Full Health Report
  // ==========================================================================
  
  generateReport(blocks: ContextBlock[]): HealthReport {
    const tokenBudget = this.analyzeTokenBudget(blocks);
    const middleAnalysis = this.analyzeMiddle(blocks);
    const freshness = this.analyzeFreshness(blocks);
    const degradation = this.analyzeDegradation(blocks);
    
    // Determine overall health (use severity scores for comparison)
    const severityMap: Record<HealthReport['overall'], number> = {
      'healthy': 0,
      'warning': 1,
      'degraded': 2,
      'critical': 3,
    };
    
    let overallSeverity = 0;
    const recommendations: string[] = [];
    
    // Token budget issues
    if (tokenBudget.warningLevel === 'exceeded') {
      overallSeverity = Math.max(overallSeverity, 3);
      recommendations.push('IMMEDIATE: Context exceeded budget - compact or start fresh');
    } else if (tokenBudget.warningLevel === 'critical') {
      overallSeverity = Math.max(overallSeverity, 2);
      recommendations.push('Compact context soon - approaching token limit');
    } else if (tokenBudget.warningLevel === 'warning') {
      overallSeverity = Math.max(overallSeverity, 1);
      recommendations.push('Monitor token usage - consider proactive compaction');
    }
    
    // Middle analysis issues
    if (middleAnalysis.criticalBuried) {
      overallSeverity = Math.max(overallSeverity, 2);
      recommendations.push(middleAnalysis.recommendation!);
    } else if (middleAnalysis.recommendation) {
      overallSeverity = Math.max(overallSeverity, 1);
      recommendations.push(middleAnalysis.recommendation);
    }
    
    // Freshness issues
    if (freshness.staleBlocks.length > 5) {
      overallSeverity = Math.max(overallSeverity, 1);
      recommendations.push(`${freshness.staleBlocks.length} blocks contain stale information - refresh or remove`);
    }
    
    // Degradation issues
    if (degradation.qualityScore < 50) {
      overallSeverity = Math.max(overallSeverity, 2);
      recommendations.push('Context quality degraded - consider fresh start or major cleanup');
    } else if (degradation.qualityScore < 70) {
      overallSeverity = Math.max(overallSeverity, 1);
      recommendations.push('Context quality declining - review and clean up');
    }
    
    for (const warning of degradation.warnings) {
      recommendations.push(warning);
    }
    
    // Add projection-based recommendation
    if (tokenBudget.projection && tokenBudget.projection.turnsRemaining < 10) {
      recommendations.push(`Projected to hit limit in ~${tokenBudget.projection.turnsRemaining} turns`);
    }
    
    // Convert severity back to status
    const severityToStatus: HealthReport['overall'][] = ['healthy', 'warning', 'degraded', 'critical'];
    const overall = severityToStatus[overallSeverity];
    
    // Deduplicate recommendations
    const uniqueRecommendations = Array.from(new Set(recommendations));
    
    return {
      timestamp: new Date().toISOString(),
      overall,
      tokenBudget,
      middleAnalysis,
      freshness,
      degradation,
      recommendations: uniqueRecommendations,
    };
  }
  
  // ==========================================================================
  // Utility Methods
  // ==========================================================================
  
  /**
   * Quick health check - returns simple status.
   */
  quickCheck(blocks: ContextBlock[]): {
    status: 'ok' | 'warning' | 'critical';
    issues: string[];
  } {
    const report = this.generateReport(blocks);
    return {
      status: report.overall === 'healthy' ? 'ok' : 
              report.overall === 'warning' ? 'warning' : 'critical',
      issues: report.recommendations.slice(0, 3),
    };
  }
  
  /**
   * Format report for human reading.
   */
  formatReport(report: HealthReport): string {
    const lines: string[] = [
      '# Context Health Report',
      `Generated: ${report.timestamp}`,
      `Overall Status: **${report.overall.toUpperCase()}**`,
      '',
      '## Token Budget',
      `- Used: ${report.tokenBudget.used.toLocaleString()} / ${report.tokenBudget.max.toLocaleString()} (${Math.round(report.tokenBudget.percentage * 100)}%)`,
      `- Status: ${report.tokenBudget.warningLevel}`,
      report.tokenBudget.projection 
        ? `- Projection: ~${report.tokenBudget.projection.turnsRemaining} turns remaining at ${report.tokenBudget.projection.tokensPerTurn} tokens/turn`
        : '',
      '',
      '## Lost-in-Middle Analysis',
      `- Critical buried: ${report.middleAnalysis.criticalBuried ? 'YES ⚠️' : 'No'}`,
      `- High-importance buried: ${report.middleAnalysis.highBuried ? 'Yes' : 'No'}`,
      `- Blocks in middle: ${report.middleAnalysis.blocksInMiddle.length}`,
      '',
      '## Freshness',
      `- Stale blocks: ${report.freshness.staleBlocks.length}`,
      `- Average age: ${report.freshness.averageAgeHours}h`,
      report.freshness.oldestBlock 
        ? `- Oldest: ${report.freshness.oldestBlock.id} (${report.freshness.oldestBlock.ageHours}h)`
        : '',
      '',
      '## Quality Metrics',
      `- Quality Score: ${report.degradation.qualityScore}/100`,
      `- Repetition: ${Math.round(report.degradation.repetitionScore * 100)}%`,
      `- Confusion indicators: ${report.degradation.confusionIndicators.length}`,
      '',
      '## Recommendations',
      ...report.recommendations.map(r => `- ${r}`),
    ];
    
    return lines.filter(l => l !== '').join('\n');
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const inputFile = args[0];
  
  if (!inputFile) {
    console.log(`
Context Health Monitor

Usage:
  npx ts-node context-health.ts <context.json>

Input JSON format:
[
  { "id": "1", "type": "system", "content": "...", "timestamp": 1234567890 },
  { "id": "2", "type": "user", "content": "...", "importance": "high" }
]

Output: Health report with recommendations
    `);
    process.exit(0);
  }
  
  try {
    const content = fs.readFileSync(inputFile, 'utf-8');
    const blocks: ContextBlock[] = JSON.parse(content);
    
    const monitor = new ContextHealthMonitor();
    const report = monitor.generateReport(blocks);
    
    console.log(monitor.formatReport(report));
    console.log('\n--- JSON Report ---\n');
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  HealthConfig,
  ContextBlock,
  TokenBudgetStatus,
  MiddleAnalysis,
  FreshnessAnalysis,
  DegradationAnalysis,
  HealthReport,
};
