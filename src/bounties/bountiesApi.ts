// Typed client for the bounty endpoints (phase 6.3). Mirrors the fetch +
// {error} body convention of src/clans/clansApi.ts.

export type Bounty = {
  id: number;
  targetKind: 'player' | 'clan';
  targetId: number;
  targetName: string;
  sponsorKind: 'player' | 'clan';
  sponsorId: number;
  sponsorName: string;
  amount: number;
  status: 'active' | 'paid' | 'expired';
  createdAt: string;
  expiresAt: string;
};

export type SetBountyRequest = {
  targetKind: 'player' | 'clan';
  targetId: number;
  amount: number;
  ttlHours: number;
  fromClan: boolean;
};

async function errMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function fetchTopBounties(): Promise<Bounty[]> {
  const res = await fetch('/api/bounties');
  if (!res.ok) {
    throw new Error(`GET /api/bounties: ${await errMessage(res)}`);
  }
  return (await res.json()) as Bounty[];
}

export async function setBounty(req: SetBountyRequest): Promise<{ id: number }> {
  const res = await fetch('/api/bounties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(await errMessage(res));
  }
  return (await res.json()) as { id: number };
}
