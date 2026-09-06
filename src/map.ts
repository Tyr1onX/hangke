import {
  Map,
  LngLatBounds,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { airport, coordinates, type Airport } from "./airports.ts";
import { route, interpolate, bearing, type Coordinate } from "./geo.ts";
import type { CompletedFlight } from "./state.ts";
setWorkerUrl(workerUrl);
const style = "https://tiles.openfreemap.org/styles/dark";
const focusZoom = 11.5;
const cameraDuration = 650;
const focusSettleDuration = 90;
const airportImageId = "hangke-airport-pin";
const planeImageId = "hangke-plane";
export type FlightView = "focus" | "route" | "manual";

function airportImage() {
  const scale = 2,
    width = 42,
    height = 26,
    radius = 5;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.moveTo(radius, 0.5);
  ctx.lineTo(width - radius, 0.5);
  ctx.quadraticCurveTo(width - 0.5, 0.5, width - 0.5, radius);
  ctx.lineTo(width - 0.5, height - radius);
  ctx.quadraticCurveTo(width - 0.5, height - 0.5, width - radius, height - 0.5);
  ctx.lineTo(radius, height - 0.5);
  ctx.quadraticCurveTo(0.5, height - 0.5, 0.5, height - radius);
  ctx.lineTo(0.5, radius);
  ctx.quadraticCurveTo(0.5, 0.5, radius, 0.5);
  ctx.closePath();
  ctx.fillStyle = "rgba(23, 33, 38, 0.91)";
  ctx.fill();
  ctx.strokeStyle = "rgba(165, 200, 204, 0.53)";
  ctx.lineWidth = 1;
  ctx.stroke();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function planeImage() {
  const scale = 2,
    size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#edf8f8";
  ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 2;
  ctx.fill(
    new Path2D(
      "M16 2c-1 0-2 2-2 4v7L3 20v3l11-4v7l-4 3v1l6-2 6 2v-1l-4-3v-7l11 4v-3l-11-7V6c0-2-1-4-2-4Z",
    ),
  );
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export class FlightMap {
  private map: Map;
  private ready = false;
  private history: CompletedFlight[] = [];
  private selected: [Airport, Airport] | null = null;
  private endpoints: Airport[] = [];
  private arrival: Airport | undefined;
  private reserveRight = false;
  private view: FlightView = "manual";
  private flightActive = false;
  private planePosition: Coordinate | undefined;
  private planeHeading = 0;
  private focusTransitioning = false;
  private planeOverlay = false;
  private planeElement: HTMLDivElement;
  private planeIcon: SVGElement;
  private loadingTimer: ReturnType<typeof setTimeout>;
  constructor(
    onError: (failed: boolean) => void,
    private onViewChange: (view: FlightView) => void = () => {},
  ) {
    this.map = new Map({
      container: "map",
      style,
      center: [0, 15],
      zoom: 1.2 + Math.log2(window.innerHeight / 800),
      attributionControl: { compact: false },
    });
    this.map.dragRotate.disable();
    this.map.touchZoomRotate.disableRotation();
    const canvas = this.map.getCanvasContainer();
    let pointerStart: [number, number] | undefined;
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.isPrimary && event.button === 0)
          pointerStart = [event.clientX, event.clientY];
      },
      true,
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        if (
          pointerStart &&
          event.buttons & 1 &&
          Math.hypot(
            event.clientX - pointerStart[0],
            event.clientY - pointerStart[1],
          ) > 3
        ) {
          this.pauseAutomaticView();
          pointerStart = undefined;
        }
      },
      true,
    );
    for (const type of ["pointerup", "pointercancel"] as const)
      canvas.addEventListener(type, () => (pointerStart = undefined), true);
    canvas.addEventListener("wheel", () => this.pauseAutomaticView(), {
      capture: true,
      passive: true,
    });
    this.map.on("dragstart", () => this.pauseAutomaticView());
    this.map.on("zoomstart", (event) => {
      if (event.originalEvent) this.pauseAutomaticView();
    });
    const el = document.createElement("div");
    el.className = "plane plane-overlay";
    el.setAttribute("aria-label", "飞机");
    el.innerHTML =
      '<svg class="plane-icon" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><path fill="currentColor" d="M16 2c-1 0-2 2-2 4v7L3 20v3l11-4v7l-4 3v1l6-2 6 2v-1l-4-3v-7l11 4v-3l-11-7V6c0-2-1-4-2-4Z"/></svg>';
    this.planeElement = el;
    this.planeIcon = el.querySelector("svg")!;
    this.loadingTimer = setTimeout(() => onError(true), 25000);
    this.map.on("error", () => onError(true));
    this.map.on("idle", () => {
      clearTimeout(this.loadingTimer);
      onError(false);
    });
    this.map.on("style.load", () => {
      this.map.setProjection({ type: "globe" });
      this.map.addImage(airportImageId, airportImage(), { pixelRatio: 2 });
      this.map.addImage(planeImageId, planeImage(), { pixelRatio: 2 });
      for (const id of ["history", "current", "airports", "plane"]) {
        this.map.addSource(id, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      for (const id of ["history", "current"]) {
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
      this.map.addLayer({
        id: "airports",
        type: "symbol",
        source: "airports",
        layout: {
          "icon-image": airportImageId,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": ["get", "iata"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": "#dfedef" },
      });
      this.map.addLayer({
        id: "plane",
        type: "symbol",
        source: "plane",
        layout: {
          "icon-image": planeImageId,
          "icon-rotate": ["get", "heading"],
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          visibility: "none",
        },
      });
      this.ready = true;
      this.render();
      if (this.arrival) this.land(this.arrival);
      else if (this.flightActive && this.view === "focus" && this.planePosition)
        this.focusPlane();
      else if (this.selected && (!this.flightActive || this.view === "route"))
        this.frame(...this.selected);
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
    this.endpoints = [a, b].filter((item): item is Airport => !!item);
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
    (this.map.getSource("airports") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: this.endpoints.map((a) => ({
        type: "Feature" as const,
        properties: { iata: a.iata },
        geometry: { type: "Point" as const, coordinates: coordinates(a) },
      })),
    });
    this.renderPlane();
  }
  private renderPlane() {
    if (!this.ready) return;
    (this.map.getSource("plane") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: this.planePosition
        ? [
            {
              type: "Feature",
              properties: { heading: this.planeHeading },
              geometry: { type: "Point", coordinates: this.planePosition },
            },
          ]
        : [],
    });
  }
  private setView(view: FlightView) {
    if (this.view === view) return;
    this.view = view;
    this.onViewChange(view);
  }
  private pauseAutomaticView() {
    if (!this.flightActive || this.view === "manual") return;
    this.focusTransitioning = false;
    this.showPlaneSymbol();
    this.map.stop();
    this.setView("manual");
  }
  private motionDuration() {
    return matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : cameraDuration;
  }
  private showPlaneSymbol() {
    if (this.planeOverlay) this.planeElement.remove();
    this.planeOverlay = false;
    if (this.ready) this.map.setLayoutProperty("plane", "visibility", "visible");
  }
  private showPlaneOverlay() {
    if (this.ready) this.map.setLayoutProperty("plane", "visibility", "none");
    if (!this.planeOverlay) {
      this.map.getContainer().appendChild(this.planeElement);
      this.planeOverlay = true;
    }
  }
  private settleFocusTransition() {
    if (!this.focusTransitioning || this.view !== "focus" || !this.planePosition)
      return;
    this.map.once("moveend", () => {
      if (this.focusTransitioning && this.view === "focus")
        this.finishFocusTransition();
    });
    this.map.easeTo({
      center: this.planePosition,
      zoom: focusZoom,
      bearing: 0,
      pitch: 0,
      duration: focusSettleDuration,
    });
  }
  private finishFocusTransition() {
    if (this.view !== "focus" || !this.planePosition || !this.ready) return;
    this.focusTransitioning = false;
    this.map.jumpTo({
      center: this.planePosition,
      zoom: focusZoom,
      bearing: 0,
      pitch: 0,
    });
    this.showPlaneOverlay();
  }
  focusPlane() {
    this.setView("focus");
    if (!this.planePosition || !this.ready) return;
    this.focusTransitioning = false;
    this.map.stop();
    this.showPlaneSymbol();
    const duration = this.motionDuration();
    if (!duration) {
      this.finishFocusTransition();
      return;
    }
    this.focusTransitioning = true;
    this.map.once("moveend", () => {
      if (this.focusTransitioning && this.view === "focus")
        this.settleFocusTransition();
    });
    this.map.easeTo({
      center: this.planePosition,
      zoom: focusZoom,
      bearing: 0,
      pitch: 0,
      duration,
    });
  }
  showRoute() {
    this.focusTransitioning = false;
    this.map.stop();
    this.showPlaneSymbol();
    this.setView("route");
    if (this.selected && this.ready)
      this.frame(...this.selected, this.motionDuration());
  }
  frame(a: Airport, b: Airport, duration = 0) {
    const bounds = new LngLatBounds();
    route(coordinates(a), coordinates(b)).forEach((p) => bounds.extend(p));
    this.map.fitBounds(bounds, {
      padding: {
        top: 64,
        bottom: 96,
        left: 56,
        right: this.reserveRight ? 350 : 56,
      },
      duration,
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
    this.flightActive = true;
    this.planePosition = p;
    this.planeHeading = heading;
    this.planeIcon.style.transform = `rotate(${heading}deg)`;
    this.renderPlane();
    if (this.view === "focus" && !this.focusTransitioning && this.ready) {
      this.showPlaneOverlay();
      this.map.setCenter(p);
    } else {
      this.showPlaneSymbol();
    }
  }
  hidePlane() {
    this.flightActive = false;
    this.planePosition = undefined;
    this.focusTransitioning = false;
    this.view = "manual";
    if (this.planeOverlay) this.planeElement.remove();
    this.planeOverlay = false;
    if (this.ready) this.map.setLayoutProperty("plane", "visibility", "none");
    this.renderPlane();
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
