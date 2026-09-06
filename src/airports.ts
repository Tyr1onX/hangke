import data from "./data/airports.json";
import type { Coordinate } from "./geo.ts";
export interface Airport {
  ident: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
}
export const airports: Airport[] = data;
export const airport = (iata: string | null) =>
  airports.find((a) => a.iata === iata);
export const coordinates = (a: Airport): Coordinate => [
  a.longitude,
  a.latitude,
];
export function search(query: string): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (a: Airport) =>
    a.iata.toLowerCase() === q
      ? 0
      : a.ident.toLowerCase() === q
        ? 1
        : a.iata.toLowerCase().startsWith(q)
          ? 2
          : 3;
  return airports
    .filter((a) =>
      [a.iata, a.ident, a.city, a.name].some((s) =>
        s.toLowerCase().includes(q),
      ),
    )
    .sort((a, b) => score(a) - score(b) || a.iata.localeCompare(b.iata))
    .slice(0, 8);
}
