export type StmWriteAckConfig = {
  /** Enable the post-turn STM write acknowledgement turn (default: true). */
  enabled?: boolean;
};

export type MemoryConfig = {
  /** Post-turn STM write acknowledgement behavior. */
  stmWriteAck?: StmWriteAckConfig;
};
