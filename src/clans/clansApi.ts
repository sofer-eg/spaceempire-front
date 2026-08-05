// Typed client for the clan endpoints (phase 6.1). Mirrors the netFetch +
// {error} body convention of src/api.ts; failures throw an ApiError carrying the
// server's human-readable message so views can surface it inline.
//
// ApiError, not a plain Error (TASK-168): the message alone is not enough for
// friendlyError, which words 502/504 as «Сервер не ответил» — a proxy answered
// instead of the game — and can only tell those apart by branching on err.status.
// Raising a plain Error dropped the status, so the identical 502 read one way on
// the galaxy map and another on this page. Only friendlyError is meant here:
// commandErrorText branches on the same statuses but no clan call reaches it, and
// none should — the clan operations debit nothing (see the note in ClansPage).
//
// netFetch, not bare fetch (TASK-168): a raw fetch rejection is a TypeError whose
// message is the English "Failed to fetch", and opening the Кланы tab during a
// backend restart put it straight into the Russian interface. netFetch labels that
// case NetworkError instead — the classification friendlyError needs, and a message
// that is already the Russian line. Note the classification is the point now, not
// the message: every consumer here goes through friendlyError (ClansPage :36, :55,
// :95, :135; ClansView :22; ClanDetailView :32; MyClanView :67), which the first
// version of this comment predated when it said the views «render e.message
// directly».
import { ApiError, netFetch, parseErrorBody } from '../api';

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
    // The route goes to the console, not into the message: the views here hand the
    // failure to friendlyError, which shows the message, so «GET /api/clans/mine: …»
    // in it was machine text in the player's error slot (TASK-168). postJSON below
    // throws the same shape; this is the two of them agreeing.
    const msg = await parseErrorBody(res);
    console.error('clan request failed', url, res.status, msg);
    throw new ApiError(res.status, msg);
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
    throw new ApiError(res.status, await parseErrorBody(res));
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
