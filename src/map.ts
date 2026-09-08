import {
  Map,
  LngLatBounds,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  airport,
  coordinates,
  airportCityLabel,
  type Airport,
  type ReachableAirport,
} from "./airports.ts";
import { route, interpolate, bearing, distance, type Coordinate } from "./geo.ts";
import type { CompletedFlight } from "./state.ts";
setWorkerUrl(workerUrl);
const style = "https://tiles.openfreemap.org/styles/dark";
const focusZoom = 11.5;
const cameraDuration = 650;
const focusSettleDuration = 90;
const airportCandidateImageId = "hangke-airport-candidate";
const airportSelectedImageId = "hangke-airport-selected";
const airportEndpointImageId = "hangke-airport-endpoint";
const planeImageId = "hangke-plane";
export type FlightView = "focus" | "route" | "manual";

function airportBadge(
  fill: string,
  stroke: string,
  glyph: string,
) {
  const scale = 2,
    width = 62,
    height = 26,
    radius = 6;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, width - 1, height - 1, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  ctx.translate(12, 13);
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = glyph;
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(6, 0);
  ctx.moveTo(1.5, -4.5);
  ctx.lineTo(1.5, 4.5);
  ctx.moveTo(-3.5, -2.5);
  ctx.lineTo(-3.5, 2.5);
  ctx.stroke();
  ctx.restore();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

const planeBodyPath = "M24 2C22.5 2 21.5 4 21 7L20 18 3 27 2 33 20 28 20 38 14 42 14 45 24 43 34 45 34 42 28 38 28 28 46 33 45 27 28 18 27 7C26.5 4 25.5 2 24 2Z";
const planeEnginePath = "M14 24h3l1 7-2 3h-2l-1-3zM31 24h3l1 7-1 3h-2l-2-3z";
const planePanelPath = "M24 4v36M20 18 6 30M28 18 42 30M20 38 15 43M28 38 33 43";

function planeImage() {
  const scale = 2, size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = "#e8f1f4";
  ctx.strokeStyle = "#627985";
  ctx.lineWidth = 0.65;
  ctx.fill(new Path2D(planeBodyPath));
  ctx.stroke(new Path2D(planeBodyPath));
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#b6cbd4";
  ctx.lineWidth = 0.55;
  ctx.fill(new Path2D(planeEnginePath));
  ctx.stroke(new Path2D(planeEnginePath));
  ctx.strokeStyle = "#819aa6";
  ctx.lineCap = "round";
  ctx.stroke(new Path2D(planePanelPath));
  ctx.fillStyle = "#526d7b";
  ctx.fill(new Path2D("M22 8Q24 6 26 8v3h-4z"));
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function rangePolygon(center: Coordinate, radiusKm: number): Coordinate[] {
  const earthRadiusKm = 6371;
  const angular = radiusKm / earthRadiusKm;
  const latitude = (center[1] * Math.PI) / 180;
  const longitude = (center[0] * Math.PI) / 180;
  const points: Coordinate[] = [];
  for (let i = 0; i <= 96; i++) {
    const heading = (i / 96) * Math.PI * 2;
    const lat = Math.asin(
      Math.sin(latitude) * Math.cos(angular) +
        Math.cos(latitude) * Math.sin(angular) * Math.cos(heading),
    );
    const lon =
      longitude +
      Math.atan2(
        Math.sin(heading) * Math.sin(angular) * Math.cos(latitude),
        Math.cos(angular) - Math.sin(latitude) * Math.sin(lat),
      );
    let degrees = (lon * 180) / Math.PI;
    while (degrees - center[0] > 180) degrees -= 360;
    while (degrees - center[0] < -180) degrees += 360;
    points.push([degrees, (lat * 180) / Math.PI]);
  }
  return points;
}

export class FlightMap {
  private map: Map;
  private ready = false;
  private history: CompletedFlight[] = [];
  private selected: [Airport, Airport] | null = null;
  private endpoints: Airport[] = [];
  private planningOrigin: Airport | undefined;
  private planningCandidates: ReachableAirport[] = [];
  private planningDestination: Airport | undefined;
  private planningRangeKm = 0;
  private airportSelectHandler: ((airport: Airport) => void) | undefined;
  private arrival: Airport | undefined;
  private reserveRight = false;
  private roaming = false;
  private worldAirportHandler: ((airport: Airport) => void) | undefined;
  private roamCamera: {center: [number, number]; zoom: number; bearing: number; pitch: number; padding: ReturnType<Map["getPadding"]>; view: FlightView} | undefined;
  private view: FlightView = "manual";
  private flightActive = false;
  private planePosition: Coordinate | undefined;
  private planeHeading = 0;
  private trailProgress = 0;
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
      attributionControl: { compact: true },
      maxTileCacheSize: 512,
      maxTileCacheZoomLevels: 12,
    });
    const prepareAttribution = () => {
      const attribution = this.map
        .getContainer()
        .querySelector<HTMLElement>(".maplibregl-ctrl-attrib");
      const button = attribution?.querySelector<HTMLButtonElement>(
        ".maplibregl-ctrl-attrib-button",
      );
      if (!attribution || !button) return false;
      if (!attribution.classList.contains("hangke-attrib-ready")) {
        button.setAttribute("aria-expanded", "false");
        button.addEventListener("click", () => {
          const expanded = attribution.classList.toggle(
            "hangke-attrib-expanded",
          );
          button.setAttribute("aria-expanded", String(expanded));
        });
        attribution.classList.add("hangke-attrib-ready");
      }
      return true;
    };
    requestAnimationFrame(() => {
      if (!prepareAttribution()) this.map.once("load", prepareAttribution);
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
    this.map.on("zoom", () => this.renderTrail());
    this.map.on("dragstart", () => this.pauseAutomaticView());
    this.map.on("zoomstart", (event) => {
      if (event.originalEvent) this.pauseAutomaticView();
    });
    const el = document.createElement("div");
    el.className = "plane plane-overlay";
    el.setAttribute("aria-label", "飞机");
    el.innerHTML = "<svg class=\"plane-icon\" viewBox=\"0 0 48 48\" width=\"48\" height=\"48\" aria-hidden=\"true\"><path fill=\"#e8f1f4\" stroke=\"#627985\" stroke-width=\".65\" d=\"M24 2C22.5 2 21.5 4 21 7L20 18 3 27 2 33 20 28 20 38 14 42 14 45 24 43 34 45 34 42 28 38 28 28 46 33 45 27 28 18 27 7C26.5 4 25.5 2 24 2Z\"/><path fill=\"#b6cbd4\" stroke=\"#627985\" stroke-width=\".55\" d=\"M14 24h3l1 7-2 3h-2l-1-3zM31 24h3l1 7-1 3h-2l-2-3z\"/><path fill=\"none\" stroke=\"#819aa6\" stroke-width=\".55\" stroke-linecap=\"round\" d=\"M24 4v36M20 18 6 30M28 18 42 30M20 38 15 43M28 38 33 43\"/><path fill=\"#526d7b\" d=\"M22 8Q24 6 26 8v3h-4z\"/></svg>";
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
      this.map.addImage(
        airportCandidateImageId,
        airportBadge("rgba(24, 25, 20, 0.95)", "rgba(240, 201, 75, 0.82)", "#f0c94b"),
        { pixelRatio: 2 },
      );
      this.map.addImage(
        airportSelectedImageId,
        airportBadge("#f0c94b", "#f4d76f", "#171814"),
        { pixelRatio: 2 },
      );
      this.map.addImage(
        airportEndpointImageId,
        airportBadge("rgba(23, 33, 38, 0.92)", "rgba(165, 200, 204, 0.48)", "#dce7e8"),
        { pixelRatio: 2 },
      );
      this.map.addImage(planeImageId, planeImage(), { pixelRatio: 2 });
      this.map.addSource("trail", {
        type: "geojson",
        lineMetrics: true,
        data: { type: "FeatureCollection", features: [] },
      });
      for (const id of ["history", "current", "range", "airports", "plane"]) {
        this.map.addSource(id, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      this.map.addLayer({
        id: "range",
        type: "fill",
        source: "range",
        paint: {
          "fill-color": "#f0c94b",
          "fill-opacity": 0.055,
          "fill-outline-color": "rgba(240, 201, 75, 0.12)",
        },
      });
      for (const id of ["history", "current"]) {
        this.map.addLayer({
          id,
          type: "line",
          source: id,
          paint: {
            "line-color":
              id === "history"
                ? "#738e98"
                : ["case", ["boolean", ["get", "planning"], false], "#f0c94b", "#bfdbdf"],
            "line-width":
              id === "history"
                ? 1.2
                : ["case", ["boolean", ["get", "planning"], false], 1.8, 2.3],
            "line-opacity": id === "history" ? 0.45 : 0.95,
          },
        });
      }
      this.map.addLayer({
        id: "trail",
        type: "line",
        source: "trail",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": 1.35,
          "line-opacity": 0.86,
          "line-gradient": ["interpolate", ["linear"], ["line-progress"],
            0, "rgba(255,255,255,0)",
            0.2, "rgba(255,255,255,0.14)",
            0.65, "rgba(255,255,255,0.45)",
            1, "rgba(255,255,255,0.85)"],
        },
      });
      this.map.addLayer({
        id: "airports",
        type: "symbol",
        source: "airports",
        layout: {
          "icon-image": [
            "case",
            ["==", ["get", "role"], "selected"],
            airportSelectedImageId,
            ["==", ["get", "role"], "candidate"],
            airportCandidateImageId,
            ["==", ["get", "role"], "origin"],
            airportCandidateImageId,
            airportEndpointImageId,
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": ["get", "iata"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11.5,
          "text-offset": [0.78, 0],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": [
            "case",
            ["==", ["get", "role"], "selected"],
            "#171814",
            ["==", ["get", "role"], "candidate"],
            "#f0c94b",
            ["==", ["get", "role"], "origin"],
            "#f0c94b",
            "#dfedef",
          ],
        },
      });
      this.map.addLayer({
        id: "airport-names",
        type: "symbol",
        source: "airports",
        layout: {
          "text-field": ["get", "city"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10.5,
          "text-anchor": "top",
          "text-offset": [0, 1.75],
          "text-max-width": 12,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": [
            "case",
            ["==", ["get", "role"], "selected"],
            "#f7db78",
            ["==", ["get", "role"], "candidate"],
            "#d8bd64",
            ["==", ["get", "role"], "origin"],
            "#d8bd64",
            "#9fb0b6",
          ],
          "text-halo-color": "rgba(11, 16, 19, 0.94)",
          "text-halo-width": 1.2,
        },
      });
      const pickAirport = (event: {
        features?: Array<{ properties?: { iata?: string; role?: string } }>;
      }) => {
        const properties = event.features?.[0]?.properties;
        if (!properties?.iata || properties.role === "origin") return;
        if (this.roaming) {
          const a = airport(properties.iata);
          if (a) this.worldAirportHandler?.(a);
          return;
        }
        const selected = this.planningCandidates.find(
          ({ airport: item }) => item.iata === properties.iata,
        )?.airport;
        if (selected) this.airportSelectHandler?.(selected);
      };
      for (const layer of ["airports", "airport-names"]) {
        this.map.on("click", layer, pickAirport);
        this.map.on("mouseenter", layer, () => {
          this.map.getCanvas().style.cursor = "pointer";
        });
        this.map.on("mouseleave", layer, () => {
          this.map.getCanvas().style.cursor = "";
        });
      }
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
      else if (this.planningOrigin) {
        if (this.planningDestination)
          this.framePlanningRoute(this.planningOrigin, this.planningDestination);
        else this.framePlanning(this.planningOrigin, this.planningCandidates);
      } else if (this.selected && (!this.flightActive || this.view === "route"))
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
  setAirportSelectHandler(handler: (airport: Airport) => void) {
    this.airportSelectHandler = handler;
  }
  plan(
    origin: Airport | undefined,
    candidates: ReachableAirport[],
    destination: Airport | undefined,
    rangeKm: number,
  ) {
    this.reserveRight = false;
    this.arrival = undefined;
    this.planningOrigin = origin;
    this.planningCandidates = candidates;
    this.planningDestination = destination;
    this.planningRangeKm = rangeKm;
    this.selected = origin && destination ? [origin, destination] : null;
    this.endpoints = [];
    this.render();
    if (!origin || !this.ready) return;
    if (destination) this.framePlanningRoute(origin, destination);
    else this.framePlanning(origin, candidates);
  }
  select(a?: Airport, b?: Airport, reserveRight = false) {
    this.planningOrigin = undefined;
    this.planningCandidates = [];
    this.planningDestination = undefined;
    this.planningRangeKm = 0;
    this.reserveRight = reserveRight;
    this.arrival = undefined;
    this.selected = a && b ? [a, b] : null;
    this.endpoints = [a, b].filter((item): item is Airport => !!item);
    this.render();
    if (a && b && this.ready) this.frame(a, b);
  }
  // Home-only camera helpers. They do not alter the flight clock or map sources.
  locate(a: Airport) {
    this.map.stop();
    this.select(a);
    this.map.setPadding({top:0,bottom:0,left:0,right:0});
    this.map.easeTo({center: coordinates(a), zoom: 5, duration: this.motionDuration()});
  }
  showWorld() {
    this.select();
    this.map.setPadding({top:0,bottom:0,left:0,right:0});
    const bounds = new LngLatBounds();
    for (const flight of this.history) {
      const a = airport(flight.originIata), b = airport(flight.destinationIata);
      if (a) bounds.extend(coordinates(a));
      if (b) bounds.extend(coordinates(b));
    }
    if (bounds.isEmpty()) this.map.easeTo({center: [0, 15], zoom: 1.2, duration: this.motionDuration()});
    else {
      const panel = document.getElementById("home-detail")?.getBoundingClientRect();
      const width = this.map.getCanvas().clientWidth;
      const right = Math.min(panel?.width ? panel.width + 48 : 90, Math.max(90, width - 280));
      this.map.fitBounds(bounds, {padding: {top: 90, bottom: 90, left: 40, right}, maxZoom: 4, duration: this.motionDuration(), linear: true});
    }
  }
  setWorldAirportHandler(handler: (a: Airport) => void) { this.worldAirportHandler = handler; }
  startRoam() {
    if (this.roaming) return;
    const c = this.map.getCenter();
    this.roamCamera = {center:[c.lng,c.lat],zoom:this.map.getZoom(),bearing:this.map.getBearing(),pitch:this.map.getPitch(),padding:this.map.getPadding(),view:this.view};
    this.roaming = true;
    this.map.stop();
    this.setView("manual");
    this.map.setPadding({top:0,bottom:0,left:0,right:0});
    this.map.dragRotate.enable();
    this.render();
    this.roamControl("all");
  }
  stopRoam() {
    if (!this.roaming) return;
    this.roaming = false;
    this.map.dragRotate.disable();
    this.render();
    if (this.roamCamera) {
      const {view,...camera} = this.roamCamera;
      this.map.jumpTo(camera);
      this.setView(view);
      this.roamCamera = undefined;
    }
  }
  roamControl(action: "in" | "out" | "left" | "right" | "all") {
    if (!this.roaming) return;
    if (action === "all") this.map.easeTo({center:[105,20],zoom:Math.max(.6,1.5+Math.log2(this.map.getCanvas().clientHeight / 800)),bearing:0,pitch:0,duration:this.motionDuration()});
    else if (action === "in" || action === "out") this.map.easeTo({zoom:Math.max(0,Math.min(12,this.map.getZoom()+(action==="in"?.6:-.6))),duration:this.motionDuration()});
    else { const c = this.map.getCenter(); this.map.easeTo({center:[c.lng+(action==="left"?-30:30),c.lat],duration:this.motionDuration()}); }
  }
  roamAirport(a: Airport) {
    if (this.roaming) this.map.easeTo({center:coordinates(a),zoom:4,bearing:0,pitch:0,duration:this.motionDuration()});
  }
  projectAirport(a: Airport) {
    return this.map.project(coordinates(a));
  }
  onCameraChange(handler: () => void) {
    this.map.on("move", handler);
    this.map.on("resize", handler);
    return () => { this.map.off("move", handler); this.map.off("resize", handler); };
  }
  private render() {
    if (!this.ready) return;
    const feature = (a: Airport, b: Airport, planning = false) => ({
      type: "Feature" as const,
      properties: { planning },
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
      features: this.selected
        ? [feature(...this.selected, !!this.planningOrigin)]
        : [],
    });
    (this.map.getSource("range") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features:
        this.planningOrigin && this.planningRangeKm > 0
          ? [
              {
                type: "Feature" as const,
                properties: {},
                geometry: {
                  type: "Polygon" as const,
                  coordinates: [
                    rangePolygon(
                      coordinates(this.planningOrigin),
                      this.planningRangeKm,
                    ),
                  ],
                },
              },
            ]
          : [],
    });
    const planningAirports: Array<{ airport: Airport; role: string }> = [];
    if (this.planningOrigin) {
      planningAirports.push({ airport: this.planningOrigin, role: "origin" });
      for (const { airport: candidate } of this.planningCandidates)
        planningAirports.push({
          airport: candidate,
          role:
            candidate.iata === this.planningDestination?.iata
              ? "selected"
              : "candidate",
        });
    } else {
      for (const endpoint of this.endpoints)
        planningAirports.push({ airport: endpoint, role: "endpoint" });
    }
    if (this.roaming) {
      const seen = new Set(planningAirports.map(item=>item.airport.iata));
      for (const iata of new Set(this.history.flatMap(f=>[f.originIata,f.destinationIata]))) {
        const a = airport(iata);
        if (a && !seen.has(iata)) planningAirports.push({airport:a,role:"endpoint"});
      }
    }
    (this.map.getSource("airports") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: planningAirports.map(({ airport: item, role }) => ({
        type: "Feature" as const,
        properties: {
          iata: item.iata,
          city: airportCityLabel(item),
          role,
        },
        geometry: {
          type: "Point" as const,
          coordinates: coordinates(item),
        },
      })),
    });
    this.renderPlane();
  }
  private renderTrail() {
    if (!this.ready) return;
    const features: Array<{ type: "Feature"; properties: Record<string, never>; geometry: { type: "LineString"; coordinates: Coordinate[] } }> = [];
    if (this.flightActive && this.selected && this.planePosition && this.trailProgress > 0) {
      const [a, b] = this.selected;
      const start = coordinates(a), end = coordinates(b);
      const routeKm = distance(start, end);
      if (routeKm > 0) {
        // Keep the visual tail short in screen space, not a fixed fraction of the journey.
        const pixelKm = 40075.016686 * Math.max(0.01, Math.cos(this.planePosition[1] * Math.PI / 180)) / (512 * 2 ** this.map.getZoom());
        const first = Math.max(0, this.trailProgress - 88 * pixelKm / routeKm);
        if (first < this.trailProgress) {
          const points: Coordinate[] = [];
          for (let i = 0; i <= 8; i++) {
            const point = interpolate(start, end, first + (this.trailProgress - first) * i / 8);
            if (points.length) {
              while (point[0] - points[i - 1][0] > 180) point[0] -= 360;
              while (point[0] - points[i - 1][0] < -180) point[0] += 360;
            }
            points.push(point);
          }
          features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } });
        }
      }
    }
    (this.map.getSource("trail") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }
  private renderPlane() {
    if (!this.ready) return;
    this.renderTrail();
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
  private planningPadding() {
    // The home is full-screen; only the visible flight-selection console reserves map space.
    const planner = document.getElementById("planner");
    const planning = document.getElementById("flight-stage");
    const plannerHeight =
      planner && !planner.hidden && planning && !planning.hidden
        ? planning.getBoundingClientRect().height : 0;
    const canvas = this.map.getCanvas();
    // Reserve the console without making the camera fitting area negative.
    const vertical = Math.max(0, canvas.clientHeight - 80);
    const top = Math.min(66, vertical / 3);
    const side = Math.min(66, Math.max(0, (canvas.clientWidth - 80) / 2));
    return {
      top,
      bottom: Math.min(
        Math.max(92, Math.ceil(plannerHeight) + 66),
        Math.max(0, vertical - top),
      ),
      left: side,
      right: side,
    };
  }
  private framePlanning(origin: Airport, candidates: ReachableAirport[]) {
    if (!this.ready) return;
    const bounds = new LngLatBounds();
    const range = rangePolygon(coordinates(origin), this.planningRangeKm);
    for (const point of range) bounds.extend(point);
    bounds.extend(coordinates(origin));
    for (const { airport: candidate } of candidates)
      bounds.extend(coordinates(candidate));
    this.map.fitBounds(bounds, {
      padding: this.planningPadding(),
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 320,
      linear: true,
      maxZoom: 8.5,
    });
  }
  private framePlanningRoute(origin: Airport, destination: Airport) {
    if (!this.ready) return;
    const bounds = new LngLatBounds();
    route(coordinates(origin), coordinates(destination)).forEach((point) =>
      bounds.extend(point),
    );
    this.map.fitBounds(bounds, {
      padding: this.planningPadding(),
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 360,
      linear: true,
      maxZoom: 8.5,
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
      linear: true,
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
    this.trailProgress = t;
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
    this.trailProgress = 0;
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
