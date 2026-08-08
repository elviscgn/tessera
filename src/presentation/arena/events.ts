// Arena event presentation: turns authoritative arena events into
// presentation-oriented messages (M21). Pure and DOM-free.

export type ArenaPresentationEvent =
  | { readonly kind: 'turn'; readonly side: number }
  | { readonly kind: 'aim'; readonly powerMilli: number }
  | { readonly kind: 'release' }
  | { readonly kind: 'goal'; readonly side: number }
  | { readonly kind: 'matchOver'; readonly winner: number | null }
  | { readonly kind: 'powerUp'; readonly side: number; readonly handle: number }
  | { readonly kind: 'rejected'; readonly reason: string };

export interface ArenaEventRecord {
  readonly kind: string;
  readonly side?: number;
  readonly power_milli?: number;
  readonly handle?: number;
  readonly reason?: string;
  readonly ball?: boolean;
  readonly body?: number;
}

/** Maps the adapter's JSON event stream to presentation events. */
export function presentArenaEvents(
  records: readonly ArenaEventRecord[],
  finalScore: readonly [number, number],
  matchOver: boolean,
): ArenaPresentationEvent[] {
  const events: ArenaPresentationEvent[] = [];
  for (const record of records) {
    switch (record.kind) {
      case 'turn_started':
        events.push({ kind: 'turn', side: record.side ?? 0 });
        break;
      case 'aimed':
        events.push({ kind: 'aim', powerMilli: record.power_milli ?? 0 });
        break;
      case 'released':
        events.push({ kind: 'release' });
        break;
      case 'goal':
        events.push({ kind: 'goal', side: record.side ?? 0 });
        break;
      case 'power_on':
        events.push({ kind: 'powerUp', side: record.side ?? 0, handle: record.handle ?? 0 });
        break;
      case 'rejected':
        events.push({ kind: 'rejected', reason: record.reason ?? 'unknown' });
        break;
      default:
        break;
    }
  }
  if (matchOver) {
    events.push({
      kind: 'matchOver',
      winner: finalScore[0] > finalScore[1] ? 0 : finalScore[1] > finalScore[0] ? 1 : null,
    });
  }
  return events;
}

/** Builds a scoreboard row for the match header. */
export function formatScore(score: readonly [number, number]): string {
  return `${score[0]}–${score[1]}`;
}

/** Maps a phase discriminant to a short presentation label. */
export function formatPhase(phase: string): string {
  switch (phase) {
    case 'Setup':
      return 'Formation';
    case 'Aiming':
      return 'Aim';
    case 'Releasing':
      return 'In play';
    case 'Resolved':
      return 'Leg over';
    default:
      return phase;
  }
}
