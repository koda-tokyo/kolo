/** The factory (KoLo 2.0, M15): boards of cards that turn a goal into a reviewed pull request. */
export type FactoryConfig = {
  /** Master switch for the factory API, tools and Kanban (default true). */
  enabled?: boolean;
  /** Default board id for cards created without one (default "main"). */
  defaultBoard?: string;
  /** Repository path used when a card names none (an absolute path to a git checkout). */
  defaultRepo?: string;
  /**
   * Pull requests on "ready to merge". When enabled, the runner pushes the engine's branch to
   * `remote` and opens a pull request with the `gh` CLI; otherwise the ready branch is left in
   * the repository and the card records its name.
   */
  github?: {
    enabled?: boolean;
    /** Git remote to push the branch to (default "origin"). */
    remote?: string;
    /** Base branch for the pull request (default: the engine task's base branch). */
    base?: string;
    /** Open the pull request as a draft (default false). */
    draft?: boolean;
  };
  /** Default card policy; a card may narrow it, never widen it. */
  policy?: {
    /** Merge through the engine as soon as a run is ready (default false: stop at ready). */
    autoMerge?: boolean;
  };
  /** Timeline entries kept per card (default 500; oldest dropped first). */
  maxTimelineEntries?: number;
};
