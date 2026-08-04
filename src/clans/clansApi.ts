// Typed client for the clan endpoints (phase 6.1). Mirrors the netFetch +
// {error} body convention of src/api.ts; failures throw an Error carrying
// the server's human-readable message so views can surface it inline.
//
// netFetch, not bare fetch (TASK-168): every view here renders e.message
// directly, so on a dead backend a raw fetch rejection put the English "Failed to
// fetch" in the Russian interface — reachable just by opening the Кланы tab
// during a restart. netFetch labels that case NetworkError, whose message is
// already the Russian line.
import { netFetch, parseErrorBody } from '../api';

export type ClanSummary = {
  id: number;
  name: string;
  tag: string;
  leaderId: number;
  memberCount: number;
  createdAt: string;
};

export type ClanMember = {
  playerId: number;
  login: string;
  role: 'leader' | 'officer' | 'member';
  joinedAt: string;
};

export type ClanInvitation = {
  clanId: number;
  clanName: string;
  clanTag: string;
  playerId: number;
  login: string;
  invitedBy: number;
  createdAt: string;
};

export type ClanDetail = {
  id: number;
  name: string;
  tag: string;
  leaderId: number;
  treasury: number;
  createdAt: string;
  members: ClanMember[];
  invitations: ClanInvitation[];
};

async function getJSON<T>(url: string): Promise<T> {
  const res = await netFetch(url);
  if (!res.ok) {
    // The route goes to the console, not into the message: every view here shows
    // e.message verbatim, and «GET /api/clans/mine: …» was machine text in the
    // player's error slot (TASK-168). postJSON below already threw the bare
    // message; this is the two of them agreeing.
    const msg = await parseErrorBody(res);
    console.error('clan request failed', url, res.status, msg);
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

async function postJSON<T>(url: string, body?: unknown): Promise<T> {
  const res = await netFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await parseErrorBody(res));
  }
  return (await res.json()) as T;
}

export function fetchClans(): Promise<ClanSummary[]> {
  return getJSON<ClanSummary[]>('/api/clans');
}

export function fetchClan(id: number): Promise<ClanDetail> {
  return getJSON<ClanDetail>(`/api/clans/${id}`);
}

// fetchMyClan returns null when the player is in no clan (server sends a
// JSON `null` body).
export function fetchMyClan(): Promise<ClanDetail | null> {
  return getJSON<ClanDetail | null>('/api/clans/mine');
}

export function fetchMyInvites(): Promise<ClanInvitation[]> {
  return getJSON<ClanInvitation[]>('/api/clans/invites');
}

export function createClan(name: string, tag: string): Promise<ClanSummary> {
  return postJSON<ClanSummary>('/api/clans', { name, tag });
}

export function inviteToClan(clanId: number, playerId: number): Promise<void> {
  return postJSON<void>(`/api/clans/${clanId}/invite`, { playerId });
}

export function acceptInvite(clanId: number): Promise<void> {
  return postJSON<void>(`/api/clans/${clanId}/accept`);
}

export function leaveClan(clanId: number): Promise<void> {
  return postJSON<void>(`/api/clans/${clanId}/leave`);
}

export function kickMember(clanId: number, playerId: number): Promise<void> {
  return postJSON<void>(`/api/clans/${clanId}/kick`, { playerId });
}

// setMemberRole promotes/demotes a member between 'officer' and 'member'
// (phase 8.6, leader-only on the server).
export function setMemberRole(
  clanId: number,
  playerId: number,
  role: 'officer' | 'member',
): Promise<void> {
  return postJSON<void>(`/api/clans/${clanId}/role`, { playerId, role });
}
