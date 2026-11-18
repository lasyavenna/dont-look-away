export type Phase = 'ready' | 'playing' | 'won' | 'lost';
export type WarningLevel = 'calm' | 'uneasy' | 'distressed' | 'critical';
export type TestStatus = 'pass' | 'fail' | 'error' | 'timeout';

export interface SanityState {
  value: number; // integer 0..100
}

export interface TestResult {
  index: number; // Test_Case index
  status: TestStatus;
  message: string;
  expectedText: string; // already truncated (<=500 + indicator)
  actualText: string | null; // null for error/timeout
}

export type RunStatus = 'running' | 'complete' | 'timedOut' | 'failed' | 'stale';

export interface Run {
  runId: number;
  roundId: number;
  status: RunStatus;
  testCount: number; // Challenge test count, fixed when the run is created
  results: TestResult[]; // sorted by index, exactly one per accepted index
  doneReceived: boolean; // run-complete message accepted
  error?: string; // worker creation/worker-level failure text
}

export interface MutationRecord {
  id: string;
  description: string;
  snapshot: string; // Code_Snapshot taken before the Mutation
  resultingCode: string;
}

export type SkipReason = 'target-missing' | 'transform-failed' | 'no-change' | 'size-limit';
export interface SkippedRecord {
  id: string;
  reason: SkipReason;
}

export interface Round {
  roundId: number;
  absenceActive: boolean;
  applied: MutationRecord | null; // 0 or 1
  lastAttemptSkipped: SkippedRecord[]; // per latest attempt
  noticedSeq: number; // bumps on every Absence end
  absenceEndSeq: number; // audio cue trigger
  noticedActive: boolean;
}

export interface GameState {
  phase: Phase;
  activeRoundId: number | null; // null whenever phase != 'playing'
  nextRoundId: number;
  nextRunId: number; // monotonic for the session
  sanity: SanityState;
  code: string;
  round: Round | null; // retained in won/lost for the results reveal
  run: Run | null; // latest run
  displayRun: Run | null; // last run whose results are shown
  resultsOutdated: boolean;
  notice: 'none' | 'watcherChanged';
}

export type GameEvent =
  | { type: 'START' }
  | { type: 'RESTART' }
  | { type: 'CODE_CHANGED'; roundId: number; code: string }
  | { type: 'DRAIN_TICK'; roundId: number }
  | { type: 'VISIBILITY_HIDDEN'; roundId: number }
  | { type: 'VISIBILITY_VISIBLE'; roundId: number }
  | { type: 'NOTICED_EXPIRED'; roundId: number; seq: number }
  | { type: 'RUN_REQUESTED'; roundId: number }
  | { type: 'RUN_RESULT'; roundId: number; runId: number; result: TestResult }
  | { type: 'RUN_DONE'; roundId: number; runId: number; count: number }
  | { type: 'RUN_ABORT'; roundId: number; runId: number }
  | { type: 'RUN_TIMEOUT'; roundId: number; runId: number }
  | { type: 'RUN_FAILED'; roundId: number; runId: number; message: string };

export type StepOutcome = 'applied' | 'discarded' | 'rejected';
export interface StepResult {
  state: GameState;
  outcome: StepOutcome;
}

// Fault injection for Req 13.2
export interface CoreDeps {
  saveSnapshot?: (code: string) => boolean;
}
