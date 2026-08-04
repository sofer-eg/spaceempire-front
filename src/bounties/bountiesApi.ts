// Typed client for the bounty endpoints (phase 6.3). Mirrors the netFetch +
// {error} body convention of src/clans/clansApi.ts, including why the transport
// is netFetch rather than bare fetch (TASK-168).
import { netFetch, parseErrorBody } from '../api';

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

export async function fetchTopBounties(): Promise<Bounty[]> {
  const res = await netFetch('/api/bounties');
  if (!res.ok) {
    // Route in the console, message on screen — same reasoning as clansApi.getJSON.
    const msg = await parseErrorBody(res);
    console.error('bounty request failed', res.status, msg);
    throw new Error(msg);
  }
  return (await res.json()) as Bounty[];
}

export async function setBounty(req: SetBountyRequest): Promise<{ id: number }> {
  const res = await netFetch('/api/bounties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(await parseErrorBody(res));
  }
  return (await res.json()) as { id: number };
}
