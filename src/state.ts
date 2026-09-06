export interface ActiveFlight {
  id: string;
  originIata: string;
  destinationIata: string;
  task: string;
  durationSeconds: number;
  startedAt: number;
  endsAt: number;
  distanceKm: number;
  pausedAt: number | null;
}
export type CompletedFlight = Omit<ActiveFlight, "endsAt" | "pausedAt"> & {
  completedAt: number;
};
export interface AppState {
  activeFlight: ActiveFlight | null;
  flights: CompletedFlight[];
  lastAirportIata: string | null;
}
export const KEY = "hangke.v1";
export const emptyState = (): AppState => ({
  activeFlight: null,
  flights: [],
  lastAirportIata: null,
});
function validFlight(f: any): boolean {
  return (
    f &&
    typeof f.id === "string" &&
    f.id.length > 0 &&
    typeof f.originIata === "string" &&
    /^[A-Z]{3}$/.test(f.originIata) &&
    typeof f.destinationIata === "string" &&
    /^[A-Z]{3}$/.test(f.destinationIata) &&
    f.originIata !== f.destinationIata &&
    typeof f.task === "string" &&
    !!f.task.trim() &&
    Number.isFinite(f.startedAt) &&
    Number.isFinite(f.distanceKm) &&
    f.distanceKm >= 0 &&
    Number.isInteger(f.durationSeconds) &&
    f.durationSeconds >= 600 &&
    f.durationSeconds <= 10800 &&
    f.durationSeconds % 300 === 0
  );
}
export function decode(raw: string | null): AppState {
  try {
    const s = JSON.parse(raw || "null");
    if (
      !s ||
      !Array.isArray(s.flights) ||
      !(
        s.lastAirportIata === null ||
        (typeof s.lastAirportIata === "string" && /^[A-Z]{3}$/.test(s.lastAirportIata))
      )
    )
      return emptyState();
    if (
      !s.flights.every(
        (f: any) =>
          validFlight(f) &&
          Number.isFinite(f.completedAt) &&
          f.completedAt >= f.startedAt + f.durationSeconds * 1000,
      )
    )
      return emptyState();
    if (
      s.activeFlight !== null &&
      !(
        validFlight(s.activeFlight) &&
        Number.isFinite(s.activeFlight.endsAt) &&
        s.activeFlight.endsAt >=
          s.activeFlight.startedAt + s.activeFlight.durationSeconds * 1000 &&
        (s.activeFlight.pausedAt == null ||
          (Number.isFinite(s.activeFlight.pausedAt) &&
            s.activeFlight.pausedAt >= s.activeFlight.startedAt &&
            s.activeFlight.pausedAt < s.activeFlight.endsAt))
      )
    )
      return emptyState();
    if (
      new Set(s.flights.map((f: CompletedFlight) => f.id)).size !==
      s.flights.length
    )
      return emptyState();
    return s.activeFlight && s.activeFlight.pausedAt === undefined
      ? { ...s, activeFlight: { ...s.activeFlight, pausedAt: null } }
      : s;
  } catch {
    return emptyState();
  }
}
export function finalize(s: AppState, now: number): AppState {
  const f = s.activeFlight;
  if (!f || (f.pausedAt ?? now) < f.endsAt) return s;
  const { endsAt, pausedAt: _pausedAt, ...fields } = f;
  return {
    activeFlight: null,
    lastAirportIata: f.destinationIata,
    flights: s.flights.some((x) => x.id === f.id)
      ? s.flights
      : [...s.flights, { ...fields, completedAt: endsAt }],
  };
}
export const cancel = (s: AppState): AppState => ({ ...s, activeFlight: null });
export const pause = (s: AppState, now: number): AppState => {
  const f = s.activeFlight;
  if (!f || f.pausedAt !== null || now >= f.endsAt) return s;
  return { ...s, activeFlight: { ...f, pausedAt: now } };
};
export const resume = (s: AppState, now: number): AppState => {
  const f = s.activeFlight;
  if (!f || f.pausedAt === null) return s;
  const pausedFor = Math.max(0, now - f.pausedAt);
  return {
    ...s,
    activeFlight: {
      ...f,
      endsAt: f.endsAt + pausedFor,
      pausedAt: null,
    },
  };
};
export const progress = (f: ActiveFlight, now: number) => {
  const durationMs = f.durationSeconds * 1000;
  const pausedMs = Math.max(0, f.endsAt - f.startedAt - durationMs);
  return Math.max(
    0,
    Math.min(1, ((f.pausedAt ?? now) - f.startedAt - pausedMs) / durationMs),
  );
};
