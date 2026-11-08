// Approval tickets: the only key that unlocks a PayPal mutation.
// A ticket is minted only by the gate (src/server/gate.ts) after a purchase is either within mandate
// (auto) or approved by a human, or after a human submits a dispute response. PayPal clients refuse any
// mutating call whose ticket was not minted here.

export interface ApprovalTicket {
  readonly subject_id: string; // purchase id or dispute id the ticket was minted for
  readonly authorised_by: string; // 'mandate' | 'human:<name>' | 'payer'
}

const minted = new WeakSet<ApprovalTicket>();

/** Only gate.ts may call this. */
export function mintTicket(subject_id: string, authorised_by: string): ApprovalTicket {
  const t = Object.freeze({ subject_id, authorised_by });
  minted.add(t);
  return t;
}

export function assertTicket(t: ApprovalTicket | undefined): void {
  if (!t || !minted.has(t)) throw new Error('Refusing PayPal mutation: no approved ticket.');
}
