// Daily challenge determinism (spec §7.2 / §4.2): the daily seed is
// hashStringToSeed('YYYYMMDD'); two simulations of the same date seed with the
// same agent rng seed must produce identical move lists, scores, and boards.
import { describe, expect, it } from 'vitest';
import { Game } from '../../src/engine/game';
import { createRng, hashStringToSeed } from '../../src/engine/rng';
import { RandomAgent, applyMove, playGame } from '../../src/sim/agents';
import type { Move } from '../../src/sim/agents';

const DAILY_DATE = '20260610';
const AGENT_SEED = 424242;

interface DailyRun {
  moves: Move[];
  score: number;
  board: number[];
  over: boolean;
}

function runDaily(): DailyRun {
  const seed = hashStringToSeed(DAILY_DATE);
  const game = Game.create(seed, 'daily', DAILY_DATE);
  const agent = new RandomAgent(createRng(AGENT_SEED));
  const played = playGame(game, agent);
  const state = game.state;
  return {
    moves: played.moves,
    score: state.score,
    board: state.board,
    over: state.over,
  };
}

describe('daily challenge determinism (spec §7.2)', () => {
  it('two runs of the same date seed with the same agent seed are move-for-move identical', () => {
    const first = runDaily();
    const second = runDaily();

    // Both runs are real, complete games.
    expect(first.moves.length).toBeGreaterThan(0);
    expect(first.over).toBe(true);
    expect(second.over).toBe(true);

    // Identical move lists, scores, and final boards.
    expect(second.moves).toEqual(first.moves);
    expect(second.score).toBe(first.score);
    expect(second.board).toEqual(first.board);
  });

  it('replaying the recorded move list on a fresh daily game reproduces the exact score and board', () => {
    const recorded = runDaily();
    const game = Game.create(hashStringToSeed(DAILY_DATE), 'daily', DAILY_DATE);
    for (const move of recorded.moves) {
      applyMove(game, move);
    }
    const state = game.state;
    expect(state.score).toBe(recorded.score);
    expect(state.board).toEqual(recorded.board);
    expect(state.over).toBe(true);
  });
});
