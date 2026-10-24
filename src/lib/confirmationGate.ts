import type { Decision } from './riskEngine';

/**
 * The confirmation gate's decision logic, kept out of the component so the safety rule can be
 * tested. This rule is the reason the gate exists, and it used to be expressed only as JSX
 * conditionals, which meant the one invariant that actually matters — that a BLOCK can never
 * reach execution — was invisible to the test suite.
 *
 * Two properties hold for every decision:
 *
 *  1. Execution is unreachable from this component. There is no `onExecute` callback to pass.
 *     The only outcomes are cancelling, or moving to a smaller trade and re-scoring it.
 *  2. Confirmations gate the *reduce* path only, and only when they are being asked for. They
 *     are an acknowledgement, not a permission grant: ticking all three cannot make an
 *     oversized trade executable.
 */
export interface GateActions {
  /** Whether the three acknowledgement checkboxes are shown and required. */
  requiresConfirmations: boolean;
  /** Whether the reduce-and-re-analyze action is offered. */
  canReduce: boolean;
  /** Whether that action is currently clickable. */
  canReduceNow: boolean;
  /**
   * Always false. Present so callers and tests can assert against it: if a future change ever
   * wants to expose execution here, this has to be flipped deliberately.
   */
  canExecute: false;
}

export function gateActions(decision: Decision, allConfirmed: boolean): GateActions {
  // BLOCK gets no confirmations: there is nothing to acknowledge your way past, because the
  // trade cannot execute at any size the user could confirm into. It still gets the reduce
  // action, because moving to a smaller position is strictly safer and the engine re-scores it.
  const requiresConfirmations = decision !== 'BLOCK';

  return {
    requiresConfirmations,
    canReduce: true,
    // BLOCK has no checkboxes to tick, so the action must not sit disabled waiting for them.
    canReduceNow: requiresConfirmations ? allConfirmed : true,
    canExecute: false,
  };
}
