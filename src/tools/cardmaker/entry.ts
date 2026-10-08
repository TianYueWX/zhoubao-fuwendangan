import type { CardPrint, CardRecord } from '@/components/carddex/types';
let pending: { record: CardRecord; print: CardPrint | null } | undefined;
export function setMakerSource(record: CardRecord, print: CardPrint | null): void {
  pending = { record, print };
}
export function takeMakerSource(): typeof pending {
  const value = pending;
  pending = undefined;
  return value;
}
