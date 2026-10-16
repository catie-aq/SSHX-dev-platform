/** @file Typed client of the platform HTTP API. */

export type AgentState = "none" | "idle" | "working" | "question" | "permission" | "done";

export type User = {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
};

export type VaultInfo = {
  salt: string;
  /** JSON-encoded KdfParams. */
  kdf: string;
  verifier: string;
  /** JSON-encoded public JWK. */
  publicKey: string;
  privateKeyEnc: string;
};

export type Me = { user: User; vault: VaultInfo | null };

export type Member = {
  userId: string;
  username: string;
  displayName: string;
  scheme: "vault" | "ecdh";
};

export type Machine = {
  id: string;
  name: string;
  kind: "personal" | "project";
  project: string | null;
  ownerId: string;
  ownerName: string;
  tokenHint: string;
  createdAt: number;
  lastSeenAt: number | null;
  keyEnc: string;
  scheme: "vault" | "ecdh";
  members: Member[];
};

export type Session = {
  name: string;
  machineId: string;
  url: string;
  sshxServer: string;
  displayName: string;
  keyEnc: string;
  hostname: string;
  username: string;
  os: string;
  arch: string;
  version: string;
  startedAt: number;
  lastSeenAt: number;
  closedAt: number | null;
  online: boolean;
};

export type Terminal = {
  session: string;
  sid: number;
  state: AgentState;
  agent: string | null;
  stateSince: number | null;
  metaEnc: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Pref = {
  session: string;
  sid: number;
  nameEnc: string | null;
  sortKey: number | null;
  pinned: boolean;
  bell: boolean;
};

export type Workspace = {
  machines: Machine[];
  sessions: Session[];
  terminals: Terminal[];
  prefs: Pref[];
  now: number;
};

export type UserInfo = {
  id: string;
  username: string;
  displayName: string;
  publicKey: string | null;
};

export type PlatformConfig = {
  authMode: "dev" | "oidc";
  version: string;
  /** Public URL of the platform, if configured. */
  publicUrl: string | null;
  /** sshx server as reached from machines. */
  sshxServer: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "x-sshx-platform": "1",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new ApiError(resp.status, data?.error ?? resp.statusText);
  }
  return data as T;
}

export const api = {
  config: () => request<PlatformConfig>("GET", "/api/config"),
  devLogin: (username: string) => request("POST", "/api/auth/dev/login", { username }),
  logout: () => request("POST", "/api/auth/logout"),
  me: () => request<Me>("GET", "/api/me"),
  createVault: (vault: {
    salt: string;
    kdf: unknown;
    verifier: string;
    publicKey: JsonWebKey;
    privateKeyEnc: string;
  }) => request("PUT", "/api/me/vault", vault),
  resetVault: () => request("DELETE", "/api/me/vault"),
  workspace: () => request<Workspace>("GET", "/api/workspace"),
  users: () => request<UserInfo[]>("GET", "/api/users"),
  createMachine: (m: { id: string; name: string; kind: string; project: string | null; keyEnc: string }) =>
    request<{ id: string; token: string }>("POST", "/api/machines", m),
  updateMachine: (id: string, m: { name: string; kind: string; project: string | null }) =>
    request("PUT", `/api/machines/${id}`, m),
  deleteMachine: (id: string) => request("DELETE", `/api/machines/${id}`),
  rotateToken: (id: string) => request<{ token: string }>("POST", `/api/machines/${id}/token`),
  addMember: (id: string, userId: string, keyEnc: unknown) =>
    request("PUT", `/api/machines/${id}/members/${userId}`, { keyEnc }),
  removeMember: (id: string, userId: string) =>
    request("DELETE", `/api/machines/${id}/members/${userId}`),
  updatePrefs: (
    session: string,
    sid: number,
    p: Partial<{ nameEnc: string | null; sortKey: number | null; pinned: boolean; bell: boolean }>,
  ) => request<Pref>("PUT", `/api/prefs/${session}/${sid}`, p),
  forgetSession: (name: string) => request("DELETE", `/api/sessions/${name}`),
  adminOverview: () => request<any>("GET", "/api/admin/overview"),
};
