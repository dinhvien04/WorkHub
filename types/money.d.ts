/** Gradual TypeScript migration — money helpers. */
export function toMinor(amount: number | string | null | undefined): number;
export function assertNonNegativeMinor(amount: number | string): number;
export function formatVnd(minor: number): string;
export function moneyDto(
  amount: number,
  currency?: string
): { amount: number; currency: string };
