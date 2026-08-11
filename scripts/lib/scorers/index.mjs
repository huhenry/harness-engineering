import * as instructions from './instructions.mjs';
import * as tools from './tools.mjs';
import * as environment from './environment.mjs';
import * as state from './state.mjs';
import * as feedback from './feedback.mjs';
import * as loop from './loop.mjs';

/** Registry order is the report's display order and must match SUBSYSTEMS. */
export const SCORERS = [instructions, tools, environment, state, feedback, loop]
  .map((m) => ({ id: m.id, score: m.score }));
