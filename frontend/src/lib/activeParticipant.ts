// Tiny global cell so lib/api.ts can read the active-participant id without
// having to import React. React-side: ParticipantsProvider registers a getter
// via `setActiveParticipantGetter`. Axios-side: each request reads via
// `getActiveParticipantId()`.
//
// We also expose `setImpersonationFlag` for the read-only mode the web has
// (`wayly_impersonation_token` localStorage key). When the flag is true, the
// axios interceptor in api.ts rejects every non-GET request client-side.

type Getter = () => string | null;

let _getter: Getter = () => null;
let _impersonating = false;

export function setActiveParticipantGetter(fn: Getter): void {
  _getter = fn;
}

export function getActiveParticipantId(): string | null {
  try { return _getter(); } catch { return null; }
}

export function setImpersonationFlag(on: boolean): void {
  _impersonating = !!on;
}

export function isImpersonating(): boolean {
  return _impersonating;
}
