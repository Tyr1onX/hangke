export interface ActiveFlight {
  id: string;
  originIata: string;
  destinationIata: string;
  task: string;
  durationSeconds: number;
  startedAt: number;
  endsAt: number;
  distanceKm: number;
}
export type CompletedFlight = Omit<ActiveFlight, "endsAt"> & {
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
    /^[A-Z]{3}$/.test(f.originIata) &&
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
      !(s.lastAirportIata === null || /^[A-Z]{3}$/.test(s.lastAirportIata))
    )
      return emptyState();
    if (
      !s.flights.every(
        (f: any) =>
          validFlight(f) &&
          f.completedAt === f.startedAt + f.durationSeconds * 1000,
      )
    )
      return emptyState();
    if (
      s.activeFlight !== null &&
      !(
        validFlight(s.activeFlight) &&
        s.activeFlight.endsAt ===
          s.activeFlight.startedAt + s.activeFlight.durationSeconds * 1000
      )
    )
      return emptyState();
    if (
      new Set(s.flights.map((f: CompletedFlight) => f.id)).size !==
      s.flights.length
    )
      return emptyState();
    return s;
  } catch {
    return emptyState();
  }
}
export function finalize(s: AppState, now: number): AppState {
  const f = s.activeFlight;
  if (!f || now < f.endsAt) return s;
  const { endsAt, ...fields } = f;
  return {
    activeFlight: null,
    lastAirportIata: f.destinationIata,
    flights: s.flights.some((x) => x.id === f.id)
      ? s.flights
      : [...s.flights, { ...fields, completedAt: endsAt }],
  };
}
export const cancel = (s: AppState): AppState => ({ ...s, activeFlight: null });
export const progress = (f: ActiveFlight, now: number) =>
  Math.max(0, Math.min(1, (now - f.startedAt) / (f.endsAt - f.startedAt)));
