import { describe, it, expect } from 'vitest';
import { gateActions } from './confirmationGate';
import type { Decision } from './riskEngine';

const ALL_DECISIONS: Decision[] = ['APPROVE', 'CAUTION', 'REDUCE_OR_WAIT', 'BLOCK'];

describe('gateActions', () => {
  it('never exposes execution, for any decision, confirmed or not', () => {
    // The invariant the whole component exists to protect. The component has no onExecute
    // callback at all; this asserts the decision logic agrees.
    for (const decision of ALL_DECISIONS) {
      expect(gateActions(decision, false).canExecute).toBe(false);
      expect(gateActions(decision, true).canExecute).toBe(false);
    }
  });

  it('always offers the reduce-and-re-analyze path', () => {
    for (const decision of ALL_DECISIONS) {
      expect(gateActions(decision, true).canReduce).toBe(true);
    }
  });

  describe('BLOCK', () => {
    it('asks for no confirmations, because there is nothing to confirm your way past', () => {
      expect(gateActions('BLOCK', false).requiresConfirmations).toBe(false);
    });

    it('leaves reduce immediately actionable rather than waiting on absent checkboxes', () => {
      // Regression guard: BLOCK hides the checkboxes, so a disabled reduce button would be
      // permanently unreachable and the "reduce and re-run" instruction unfollowable.
      expect(gateActions('BLOCK', false).canReduceNow).toBe(true);
    });
  });

  describe('REDUCE_OR_WAIT', () => {
    it('requires the three acknowledgements', () => {
      expect(gateActions('REDUCE_OR_WAIT', false).requiresConfirmations).toBe(true);
    });

    it('keeps reduce disabled until they are all ticked', () => {
      expect(gateActions('REDUCE_OR_WAIT', false).canReduceNow).toBe(false);
      expect(gateActions('REDUCE_OR_WAIT', true).canReduceNow).toBe(true);
    });
  });

  it('does not treat ticking the boxes as permission to execute an oversized trade', () => {
    // Confirmations gate the move to a smaller position, nothing more. `canReduceNow` becoming
    // true must never be accompanied by any execution affordance.
    const actions = gateActions('REDUCE_OR_WAIT', true);
    expect(actions.canReduceNow).toBe(true);
    expect(actions.canExecute).toBe(false);
  });
});
