// Typed client for the insurance endpoints (phase 6.5). Same fetch + {error}
// convention as the other station tabs — and, since the review of TASK-140, the
// same transport: netFetch so a dead connection is a NetworkError, ApiError so
// commandErrorText can tell a refused premium from an unanswered one.
// parseErrorBody comes from ../api too (TASK-168): this file had a fourth copy of
// it, and its res.statusText fallback leaked the English HTTP reason phrase into
// the premium form the same way the market tab did.
import { ApiError, netFetch, parseErrorBody } from '../api';

export type InsurancePolicy = {
  id: number;
  shipId: number;
  premiumPaid: number;
  coverage: number;
  status: 'active' | 'claimed' | 'expired';
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
};

// CoveragePreviewMultiplier mirrors the backend insurance.Config default
// (coverage = premium × multiplier) — used only for the form's payout preview.
export const CoveragePreviewMultiplier = 10;

export async function fetchMyPolicies(): Promise<InsurancePolicy[]> {
  const res = await netFetch('/api/insurance');
  if (!res.ok) {
    throw new ApiError(res.status, `GET /api/insurance: ${await parseErrorBody(res)}`);
  }
  return (await res.json()) as InsurancePolicy[];
}

export async function buyInsurance(
  shipId: number,
  premium: number,
  durationDays: number,
): Promise<{ id: number }> {
  const res = await netFetch('/api/insurance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipId, premium, durationDays }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  return (await res.json()) as { id: number };
}
