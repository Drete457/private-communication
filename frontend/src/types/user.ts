interface User {
  userId: string;
  publicKey: string;
  displayName?: string | undefined;
  lastSeen?: number | undefined;     // Unix timestamp of last activity
  isOnline?: boolean | undefined;
}

export type { User };