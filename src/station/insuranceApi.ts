// Typed client for the insurance endpoints (phase 6.5). Same fetch + {error}
// convention as the other station tabs.

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

async function errMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function fetchMyPolicies(): Promise<InsurancePolicy[]> {
  const res = await fetch('/api/insurance');
  if (!res.ok) {
    throw new Error(`GET /api/insurance: ${await errMessage(res)}`);
  }
  return (await res.json()) as InsurancePolicy[];
}

export async function buyInsurance(
  shipId: number,
  premium: number,
  durationDays: number,
): Promise<{ id: number }> {
  const res = await fetch('/api/insurance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipId, premium, durationDays }),
  });
  if (!res.ok) {
    throw new Error(await errMessage(res));
  }
  return (await res.json()) as { id: number };
}
