/**
 * Token Budget — Per-agent daily token ceiling for consciousness engine.
 * Prevents runaway token burn (e.g., the 2.5M crash loop incident).
 *
 * Design:
 * - Each agent has a daily token budget (default: 500K tokens)
 * - Usage resets at midnight in the agent's timezone
 * - When budget is exceeded, consciousness engine pauses (sleep mode, not crash)
 * - Budget is tracked in memory (not persisted — resets on restart, which is fine)
 *
 */

export interface TokenBudget {
  /** Daily token ceiling per agent */
  dailyLimit: number;
  /** Tokens consumed today */
  todayUsed: number;
  /** The calendar date this budget tracks (YYYY-MM-DD) */
  budgetDate: string;
  /** Whether the budget is exhausted */
  exhausted: boolean;
  /** When the budget was exhausted (ISO string) */
  exhaustedAt?: string;
}

/** Default daily token budget per agent: 500K tokens */
const DEFAULT_DAILY_LIMIT = 500_000;

/** Per-agent budget state (in-memory) */
const budgets = new Map<string, TokenBudget>();

/**
 * Get today's date string in the agent's timezone.
 */
function todayInTimezone(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(now); // YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Get or create a budget for an agent. Auto-resets if the date has changed.
 */
export function getTokenBudget(
  agentId: string,
  timezone: string = "UTC",
  dailyLimit: number = DEFAULT_DAILY_LIMIT,
): TokenBudget {
  const today = todayInTimezone(timezone);
  let budget = budgets.get(agentId);

  if (!budget || budget.budgetDate !== today) {
    // New day or first access — reset budget
    budget = {
      dailyLimit,
      todayUsed: 0,
      budgetDate: today,
      exhausted: false,
      exhaustedAt: undefined,
    };
    budgets.set(agentId, budget);
  }

  return budget;
}

/**
 * Record token usage for an agent's tick. Returns true if still within budget.
 */
export function recordTokenUsage(
  agentId: string,
  tokens: number,
  timezone: string = "UTC",
  dailyLimit: number = DEFAULT_DAILY_LIMIT,
): { withinBudget: boolean; budget: TokenBudget } {
  const budget = getTokenBudget(agentId, timezone, dailyLimit);

  budget.todayUsed += tokens;

  if (budget.todayUsed >= budget.dailyLimit && !budget.exhausted) {
    budget.exhausted = true;
    budget.exhaustedAt = new Date().toISOString();
    console.error(
      `[consciousness] [${agentId}] TOKEN BUDGET EXHAUSTED: ` +
        `${budget.todayUsed.toLocaleString()} / ${budget.dailyLimit.toLocaleString()} tokens used today. ` +
        `Engine will pause until ${budget.budgetDate} ends in ${timezone}.`,
    );
  }

  return { withinBudget: !budget.exhausted, budget };
}

/**
 * Check if an agent has budget remaining (without recording usage).
 */
export function hasTokenBudget(
  agentId: string,
  timezone: string = "UTC",
  dailyLimit: number = DEFAULT_DAILY_LIMIT,
): boolean {
  const budget = getTokenBudget(agentId, timezone, dailyLimit);
  return !budget.exhausted;
}

/**
 * Get a summary of all agent budgets (for /health endpoint or monitoring).
 */
export function getAllBudgetSummaries(): Record<string, TokenBudget> {
  const summaries: Record<string, TokenBudget> = {};
  for (const [agentId, budget] of budgets) {
    summaries[agentId] = { ...budget };
  }
  return summaries;
}
