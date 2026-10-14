// src/consciousness/tasks/types.ts
//
// Task dependency graph types for consciousness goal decomposition.
// Inspired by KoLo's task system, adapted for KoLo's autonomous agents.
//
// Tasks have:
//   - Dependencies (blockedBy / blocks) that auto-resolve
//   - Ownership (which agent is working on it)
//   - Locking (prevent concurrent work on same task)
//   - Status tracking with automatic state transitions

/** Task lifecycle states. */
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "failed";

/** Priority levels for task ordering. */
export type TaskPriority = "low" | "medium" | "high" | "urgent";

/** A task in the consciousness goal graph. */
export interface TaskItem {
  /** Unique task ID. */
  id: string;
  /** Short subject line. */
  subject: string;
  /** Detailed description. */
  description: string;
  /** Current status. */
  status: TaskStatus;
  /** Priority level. */
  priority: TaskPriority;
  /** Which agent owns this task. */
  owner: string;
  /** Which agent currently holds the lock. */
  lockedBy: string;
  /** When the lock was acquired (ISO). */
  lockedAt: string;
  /** Task IDs that this task blocks (downstream dependents). */
  blocks: string[];
  /** Task IDs that must complete before this task can start. */
  blockedBy: string[];
  /** When work started (ISO). */
  startedAt: string;
  /** When the task was created (ISO). */
  createdAt: string;
  /** Last update time (ISO). */
  updatedAt: string;
  /** When the task was completed (ISO). */
  completedAt: string;
  /** Duration in seconds (computed on completion). */
  durationSeconds: number;
  /** Arbitrary metadata. */
  metadata: Record<string, unknown>;
  /** Tags for categorization. */
  tags: string[];
}

/** Options for creating a new task. */
export interface CreateTaskOptions {
  subject: string;
  description?: string;
  owner?: string;
  priority?: TaskPriority;
  blockedBy?: string[];
  blocks?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/** Options for updating a task. */
export interface UpdateTaskOptions {
  status?: TaskStatus;
  owner?: string;
  priority?: TaskPriority;
  description?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

/** Task statistics. */
export interface TaskStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  blocked: number;
  failed: number;
  avgDurationSeconds: number;
}
