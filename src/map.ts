import {
  Map,
  Marker,
  LngLatBounds,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { airport, coordinates, type Airport } from "./airports.ts";
import { route, interpolate, bearing } from "./geo.ts";
import type { CompletedFlight } from "./state.ts";
setWorkerUrl(workerUrl);
const style = "https://tiles.openfreemap.org/styles/dark";
export class FlightMap {
  private map: Map;
  private ready = false;
  private history: CompletedFlight[] = [];
  private selected: [Airport, Airport] | null = null;
  private arrival: Airport | undefined;
  private reserveRight = false;
  private pins: Marker[] = [];
  private plane: Marker;
  private loadingTimer: ReturnType<typeof setTimeout>;
  constructor(onError: (failed: boolean) => void) {
    this.map = new Map({
      container: "map",
      style,
      center: [0, 15],
      zoom: 1.2 + Math.log2(window.innerHeight / 800),
      attributionControl: { compact: false },
    });
    const el = document.createElement("div");
    el.className = "plane";
    el.setAttribute("aria-label", "飞机");
    el.innerHTML =
      '<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><path fill="currentColor" d="M16 2c-1 0-2 2-2 4v7L3 20v3l11-4v7l-4 3v1l6-2 6 2v-1l-4-3v-7l11 4v-3l-11-7V6c0-2-1-4-2-4Z"/></svg>';
    this.plane = new Marker({
      element: el,
      rotationAlignment: "map",
      pitchAlignment: "map",
      subpixelPositioning: true,
    });
    this.loadingTimer = setTimeout(() => onError(true), 25000);
    this.map.on("error", () => onError(true));
    this.map.on("idle", () => {
      clearTimeout(this.loadingTimer);
      onError(false);
    });
    this.map.on("style.load", () => {
      this.map.setProjection({ type: "globe" });
      this.ready = true;
      for (const id of ["history", "current"]) {
        this.map.addSource(id, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        this.map.addLayer({
          id,
          type: "line",
          source: id,
          paint: {
            "line-color": id === "history" ? "#738e98" : "#bfdbdf",
            "line-width": id === "history" ? 1.2 : 2.3,
            "line-opacity": id === "history" ? 0.45 : 0.95,
          },
        });
      }
      this.render();
      if (this.arrival) this.land(this.arrival);
      else if (this.selected) this.frame(...this.selected);
    });
  }
  retry() {
    window.location.reload();
  }
  setHistory(flights: CompletedFlight[]) {
    this.history = flights;
    this.render();
  }
  select(a?: Airport, b?: Airport, reserveRight = false) {
    this.reserveRight = reserveRight;
    this.arrival = undefined;
    this.selected = a && b ? [a, b] : null;
    this.pins.forEach((p) => p.remove());
    this.pins = [];
    for (const item of [a, b])
      if (item) {
        const el = document.createElement("span");
        el.className = "airport-pin";
        el.textContent = item.iata;
        this.pins.push(
          new Marker({ element: el })
            .setLngLat(coordinates(item))
            .addTo(this.map),
        );
      }
    this.render();
    if (a && b && this.ready) this.frame(a, b);
  }
  private render() {
    if (!this.ready) return;
    const feature = (a: Airport, b: Airport) => ({
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: route(coordinates(a), coordinates(b)),
      },
    });
    (this.map.getSource("history") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: this.history.flatMap((f) => {
        const a = airport(f.originIata),
          b = airport(f.destinationIata);
        return a && b ? [feature(a, b)] : [];
      }),
    });
    (this.map.getSource("current") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: this.selected ? [feature(...this.selected)] : [],
    });
  }
  frame(a: Airport, b: Airport) {
    const bounds = new LngLatBounds();
    route(coordinates(a), coordinates(b)).forEach((p) => bounds.extend(p));
    this.map.fitBounds(bounds, {
      padding: {
        top: 110,
        bottom: 180,
        left: 90,
        right: this.reserveRight ? 370 : 90,
      },
      maxZoom: 5,
      duration: 0,
    });
  }
  fly(a: Airport, b: Airport, t: number) {
    const start = coordinates(a),
      end = coordinates(b),
      p = interpolate(start, end, t);
    const ahead = interpolate(start, end, Math.min(1, t + 0.0001));
    const heading =
      t >= 0.9999
        ? bearing(interpolate(start, end, 0.9998), end)
        : bearing(p, ahead);
    this.plane.setLngLat(p).setRotation(heading);
    if (!this.plane.getElement().isConnected) this.plane.addTo(this.map);
  }
  hidePlane() {
    this.plane.remove();
  }
  land(a: Airport) {
    this.arrival = a;
    this.hidePlane();
    this.map.easeTo({
      center: coordinates(a),
      zoom: 5,
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 250,
    });
  }
}
