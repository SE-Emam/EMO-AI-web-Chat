/**
 * Task 11 — structured profile-ownership conflict (owner mandatory mod #3).
 *
 * Replaces the old text-only 503 error from ensureContext. The message text
 * keeps the legacy "503 profile in use by another gateway process" prefix so
 * external behavior is unchanged; the structured details enable the
 * ProfileOwnerRouter to FORWARD to the owner instead of failing.
 *
 * An ownership conflict must NEVER be silently converted into a provider
 * switch (RoutingDriver treats this error as non-fail-over).
 */
export interface ProfileBusyDetails {
  profileDir: string;
  ownerInstanceId: string;
  pid: number;
  epoch: string;
  heartbeatAt: number;
  staleHeartbeat?: boolean;
}

export class ProfileBusyError extends Error {
  readonly details: ProfileBusyDetails;
  statusCode = 503;

  constructor(message: string, details: ProfileBusyDetails) {
    super(message);
    this.name = 'ProfileBusyError';
    this.details = details;
  }
}
