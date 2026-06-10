// Typed client for the clan endpoints (phase 6.1). Mirrors the fetch +
// {error} body convention of src/api.ts; failures throw an Error carrying
// the server's human-readable message so views can surface it inline.

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

async function errMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url}: ${await errMessage(res)}`);
  }
  return (await res.json()) as T;
}

async function postJSON<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await errMessage(res));
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
