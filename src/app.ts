import {
  airports,
  airport,
  coordinates,
  search,
  reachable,
  type Airport,
  type ReachableAirport,
} from "./airports.ts";
import { distance } from "./geo.ts";
import { FlightMap, type FlightView } from "./map.ts";
import {
  KEY,
  decode,
  emptyState,
  finalize,
  cancel,
  pause as pauseFlight,
  resume as resumeFlight,
  progress,
  type AppState,
  type CompletedFlight,
} from "./state.ts";

export function start() {
  const root = document.querySelector<HTMLDivElement>("#app")!;
  root.innerHTML = `<header><span id="brand" class="brand">航刻</span><button id="history-toggle">航迹</button></header>
    <div id="notice" role="alert" hidden></div><div id="map-error" role="alert" hidden>地图加载失败 <button id="retry">重试</button></div>
    <form id="planner" autocomplete="off"><div class="airport-field"><label for="origin">出发机场</label><input id="origin" placeholder="机场 / 城市" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="origin-results"><div id="origin-results" class="results" role="listbox" hidden></div></div>
    <label class="duration">专注时长<select id="duration" aria-label="专注时长"></select></label><span class="arrow" aria-hidden="true">→</span><div class="airport-field"><label for="destination">可达目的地</label><input id="destination" placeholder="先选择出发机场和时长" readonly role="combobox" aria-expanded="false" aria-controls="destination-results"><div id="destination-results" class="results" role="listbox" hidden></div></div>
    <label class="task-field">当前任务<input id="task" placeholder="准备专注什么？" maxlength="200"></label><button id="takeoff" class="primary" disabled>起飞</button><output id="distance"></output></form>
    <section id="flight" hidden aria-label="飞行专注"><div id="flight-route" class="route-label"></div><div class="flight-views"><button id="follow-plane" class="flight-view-button" type="button" aria-label="跟随飞机" data-tooltip="跟随飞机"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><path d="M12 2v4M12 18v4M2 12h4M18 12h4"></path></svg></button><button id="route-view" class="flight-view-button" type="button" aria-label="查看完整航线" data-tooltip="查看完整航线"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="18" r="2"></circle><circle cx="19" cy="6" r="2"></circle><path d="M7 18c5.5 0 2.5-12 10-12M9 7h4M11 5v4"></path></svg></button><button id="pause-flight" class="flight-view-button pause-flight" type="button" aria-label="暂停飞行" data-tooltip="暂停飞行" aria-pressed="false"><svg class="pause-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7v10M15 7v10"></path></svg><svg class="resume-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5Z"></path></svg></button></div><div class="focus"><div id="timer" role="timer"></div><div id="remaining-distance"></div><p id="flight-task"></p><button id="cancel" class="quiet hold-end" type="button"><span>按住结束</span></button></div></section>
    <section id="landing" class="result" hidden aria-label="航程完成"><p id="landing-route"></p><h1>航程完成</h1><p id="landing-metrics"></p><p id="landing-task"></p><button id="done" class="primary">完成</button></section>
    <aside id="history" hidden aria-label="航迹"><h1>航迹</h1><div id="history-list"></div><div id="details" hidden></div></aside>`;
  const el = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const show = (id: string, visible: boolean) => {
    el(id).hidden = !visible;
  };
  const notice = (text: string) => {
    el("notice").textContent = text;
    show("notice", !!text);
  };
  let state: AppState;
  let storageAvailable = true;
  try {
    state = decode(localStorage.getItem(KEY));
  } catch {
    state = emptyState();
    storageAvailable = false;
    notice("无法读取本地航程，请重新打开航刻。");
  }
  // This is the only durable write; update in-memory state only after success.
  const commit = (next: AppState) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      state = next;
      notice("");
      return true;
    } catch {
      notice("航程暂时无法保存，请释放磁盘空间后重试。");
      return false;
    }
  };
  const syncFlightViewButtons = (view: FlightView) => {
    const follow = el<HTMLButtonElement>("follow-plane"),
      route = el<HTMLButtonElement>("route-view");
    follow.disabled = view === "focus";
    route.disabled = view === "route";
    follow.setAttribute("aria-label", view === "manual" ? "回到飞机" : "跟随飞机");
    follow.setAttribute("aria-pressed", String(view === "focus"));
    route.setAttribute("aria-pressed", String(view === "route"));
  };
  const syncPauseButton = (paused: boolean) => {
    const button = el<HTMLButtonElement>("pause-flight");
    const label = paused ? "继续飞行" : "暂停飞行";
    button.setAttribute("aria-pressed", String(paused));
    button.setAttribute("aria-label", label);
    button.dataset.tooltip = label;
  };
  let map: FlightMap | undefined;
  try {
    map = new FlightMap(
      (failed) => show("map-error", failed),
      syncFlightViewButtons,
    );
  } catch {
    show("map-error", true);
  }
  el("retry").onclick = () => window.location.reload();
  el("follow-plane").onclick = () => map?.focusPlane();
  el("route-view").onclick = () => map?.showRoute();
  let origin = airport(state.lastAirportIata),
    destination: Airport | undefined;
  let historyMode = false,
    landed: CompletedFlight | undefined;
  const duration = el<HTMLSelectElement>("duration");
  for (let m = 10; m <= 180; m += 5)
    duration.add(new Option(`${m} min`, String(m), false, m === 60));
  const validDuration = () =>
    Number(duration.value) >= 10 &&
    Number(duration.value) <= 180 &&
    Number(duration.value) % 5 === 0;
  const setInput = (id: string, a?: Airport) => {
    el<HTMLInputElement>(id).value = a ? `${a.iata} · ${a.city || a.name}` : "";
  };
  const refreshPlanner = () => {
    el<HTMLButtonElement>("takeoff").disabled = !(
      storageAvailable &&
      airports.length &&
      origin &&
      destination &&
      origin.iata !== destination.iata &&
      el<HTMLInputElement>("task").value.trim() &&
      validDuration()
    );
    el("distance").textContent =
      origin && destination
        ? `${Math.round(distance(coordinates(origin), coordinates(destination))).toLocaleString()} km`
        : "";
  };

  const originInput = el<HTMLInputElement>("origin"),
    originResults = el("origin-results");
  let originMatches: Airport[] = [],
    originIndex = -1;
  const closeOrigin = () => {
    originResults.hidden = true;
    originInput.setAttribute("aria-expanded", "false");
    originInput.removeAttribute("aria-activedescendant");
    originIndex = -1;
  };

  const destinationInput = el<HTMLInputElement>("destination"),
    destinationResults = el("destination-results");
  let destinationMatches: ReachableAirport[] = [];
  const closeDestinations = () => {
    destinationResults.hidden = true;
    destinationInput.setAttribute("aria-expanded", "false");
  };
  const openDestinations = () => {
    if (!destinationMatches.length) return;
    destinationResults.hidden = false;
    destinationInput.setAttribute("aria-expanded", "true");
  };
  const refreshDestinations = (open = true) => {
    destinationMatches =
      origin && validDuration() ? reachable(origin, Number(duration.value)) : [];
    if (
      destination &&
      !destinationMatches.some(({ airport: a }) => a.iata === destination!.iata)
    ) {
      destination = undefined;
      setInput("destination");
      map?.select(origin);
    }
    destinationResults.replaceChildren();
    destinationMatches.forEach(({ airport: a, distanceKm }, i) => {
      const item = document.createElement("div");
      item.id = `destination-option-${i}`;
      item.setAttribute("role", "option");
      item.setAttribute(
        "aria-selected",
        String(destination?.iata === a.iata),
      );
      const code = document.createElement("strong");
      code.textContent = `${a.iata} · ${a.city || a.country}`;
      const details = document.createElement("small");
      details.textContent = `${Math.round(distanceKm).toLocaleString()} km`;
      item.append(code, details);
      item.onmousedown = (e) => e.preventDefault();
      item.onclick = () => {
        destination = a;
        setInput("destination", a);
        closeDestinations();
        refreshPlanner();
        map?.select(origin, destination);
      };
      destinationResults.append(item);
    });
    if (origin && validDuration() && !destinationMatches.length) {
      const item = document.createElement("p");
      item.textContent = "当前时长暂无可达目的地";
      destinationResults.append(item);
    }
    destinationInput.disabled = !destinationMatches.length;
    destinationInput.placeholder = origin
      ? "选择可达目的地"
      : "先选择出发机场和时长";
    destinationResults.hidden =
      !open || !origin || !validDuration() || !destinationMatches.length;
    destinationInput.setAttribute(
      "aria-expanded",
      String(!destinationResults.hidden),
    );
    refreshPlanner();
  };

  const chooseOrigin = (a: Airport) => {
    origin = a;
    destination = undefined;
    setInput("origin", a);
    setInput("destination");
    closeOrigin();
    map?.select(origin);
    refreshDestinations(true);
    originInput.focus();
  };
  originInput.oninput = () => {
    origin = undefined;
    destination = undefined;
    setInput("destination");
    map?.select();
    refreshDestinations(false);
    originIndex = -1;
    originInput.removeAttribute("aria-activedescendant");
    originMatches = search(originInput.value);
    originResults.replaceChildren();
    originMatches.forEach((a, i) => {
      const item = document.createElement("div");
      item.id = `origin-option-${i}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      const code = document.createElement("strong");
      code.textContent = `${a.iata} · ${a.city || a.country}`;
      const name = document.createElement("small");
      name.textContent = a.name;
      item.append(code, name);
      item.onmousedown = (e) => e.preventDefault();
      item.onclick = () => chooseOrigin(a);
      originResults.append(item);
    });
    if (!originMatches.length && originInput.value.trim()) {
      const item = document.createElement("p");
      item.textContent = "未找到机场";
      originResults.append(item);
    }
    originResults.hidden = !originInput.value.trim();
    originInput.setAttribute("aria-expanded", String(!originResults.hidden));
  };
  originInput.onkeydown = (e) => {
    if (e.key === "Escape") closeOrigin();
    if (
      ["ArrowDown", "ArrowUp"].includes(e.key) &&
      originMatches.length &&
      !originResults.hidden
    ) {
      e.preventDefault();
      originIndex =
        (originIndex +
          (e.key === "ArrowDown" ? 1 : originMatches.length - 1) +
          originMatches.length) %
        originMatches.length;
      Array.from(originResults.children).forEach((item, i) =>
        item.setAttribute("aria-selected", String(i === originIndex)),
      );
      originInput.setAttribute(
        "aria-activedescendant",
        `origin-option-${originIndex}`,
      );
    }
    if (e.key === "Enter" && !originResults.hidden) {
      e.preventDefault();
      const selected = originMatches[originIndex < 0 ? 0 : originIndex];
      if (selected) chooseOrigin(selected);
    }
  };
  originInput.onblur = closeOrigin;
  destinationInput.onfocus = openDestinations;
  destinationInput.onclick = openDestinations;
  destinationInput.onkeydown = (e) => {
    if (e.key === "Escape") closeDestinations();
  };
  el("task").oninput = refreshPlanner;
  duration.onchange = () => {
    destination = undefined;
    setInput("destination");
    map?.select(origin);
    refreshDestinations(true);
  };
  let animationFrame: number | null = null;
  const stopPlaneAnimation = () => {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
  };
  const animatePlane = () => {
    animationFrame = null;
    const f = state.activeFlight;
    if (!f || f.pausedAt !== null || !map) return;
    // Frames only trigger drawing; elapsed wall time is always authoritative.
    const now = Date.now();
    const a = airport(f.originIata),
      b = airport(f.destinationIata);
    if (a && b) map.fly(a, b, progress(f, now));
    if (now < f.endsAt) animationFrame = requestAnimationFrame(animatePlane);
  };
  const startPlaneAnimation = () => {
    if (
      animationFrame === null &&
      state.activeFlight &&
      state.activeFlight.pausedAt === null &&
      Date.now() < state.activeFlight.endsAt
    ) {
      animationFrame = requestAnimationFrame(animatePlane);
    }
  };
  const render = () => {
    show("brand", !state.activeFlight);
    show("planner", !state.activeFlight && !landed && !historyMode);
    show("flight", !!state.activeFlight);
    show("landing", !!landed);
    show("history", historyMode);
    show("history-toggle", !state.activeFlight && !landed);
    el("history-toggle").textContent = historyMode ? "返回" : "航迹";
    map?.setHistory(state.flights);
    if (state.activeFlight) {
      const f = state.activeFlight;
      el("flight-route").textContent = `${f.originIata} → ${f.destinationIata}`;
      el("flight-task").textContent = f.task;
      syncPauseButton(f.pausedAt !== null);
      const a = airport(f.originIata),
        b = airport(f.destinationIata);
      map?.select(a, b);
      if (a && b && map) {
        map.fly(a, b, progress(f, f.pausedAt ?? Date.now()));
        map.focusPlane();
      }
      startPlaneAnimation();
    } else {
      stopPlaneAnimation();
      map?.hidePlane();
    }
    if (landed) {
      el("landing-route").textContent =
        `${landed.originIata} → ${landed.destinationIata}`;
      el("landing-metrics").textContent =
        `${landed.durationSeconds / 60} min · ${Math.round(landed.distanceKm).toLocaleString()} km`;
      el("landing-task").textContent = landed.task;
      const a = airport(landed.destinationIata);
      if (a) map?.land(a);
      el("done").focus();
    }
    refreshPlanner();
  };
  const tick = () => {
    const f = state.activeFlight;
    if (!f) return;
    const now = Date.now();
    const clock = f.pausedAt ?? now;
    if (clock >= f.endsAt) {
      const next = finalize(state, now);
      if (next !== state && commit(next)) {
        landed = next.flights.find((x) => x.id === f.id);
        origin = airport(next.lastAirportIata);
        destination = undefined;
        setInput("origin", origin);
        setInput("destination");
        render();
      }
      return;
    }
    const seconds = Math.ceil((f.endsAt - clock) / 1000);
    el("timer").textContent = `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
    el("remaining-distance").textContent =
      `剩余 ${Math.round(f.distanceKm * (1 - progress(f, now))).toLocaleString()} km`;
    syncPauseButton(f.pausedAt !== null);
  };
  el<HTMLFormElement>("planner").onsubmit = (e) => {
    e.preventDefault();
    refreshPlanner();
    if (el<HTMLButtonElement>("takeoff").disabled || !origin || !destination)
      return;
    const startedAt = Date.now(),
      durationSeconds = Number(duration.value) * 60;
    if (
      commit({
        ...state,
        activeFlight: {
          id: crypto.randomUUID(),
          originIata: origin.iata,
          destinationIata: destination.iata,
          task: el<HTMLInputElement>("task").value.trim(),
          durationSeconds,
          startedAt,
          endsAt: startedAt + durationSeconds * 1000,
          distanceKm: distance(coordinates(origin), coordinates(destination)),
          pausedAt: null,
        },
      })
    ) {
      render();
      tick();
      el("cancel").focus();
    }
  };
  el("pause-flight").onclick = () => {
    tick();
    const f = state.activeFlight;
    if (!f) return;
    const now = Date.now();
    const next = f.pausedAt === null ? pauseFlight(state, now) : resumeFlight(state, now);
    if (next === state || !commit(next)) return;
    if (next.activeFlight?.pausedAt !== null) {
      stopPlaneAnimation();
      const paused = next.activeFlight;
      const a = paused && airport(paused.originIata),
        b = paused && airport(paused.destinationIata);
      if (paused && a && b && map)
        map.fly(a, b, progress(paused, paused.pausedAt ?? now));
    } else {
      startPlaneAnimation();
    }
    tick();
  };

  const endButton = el<HTMLButtonElement>("cancel");
  let endHoldTimer: number | undefined;
  const clearEndHold = () => {
    if (endHoldTimer !== undefined) window.clearTimeout(endHoldTimer);
    endHoldTimer = undefined;
    endButton.classList.remove("holding");
  };
  const finishHeldEnd = () => {
    clearEndHold();
    tick();
    if (!state.activeFlight) return;
    if (commit(cancel(state))) {
      stopPlaneAnimation();
      render();
      map?.select(origin, destination);
      el("origin").focus();
    }
  };
  const beginEndHold = () => {
    if (endHoldTimer !== undefined || !state.activeFlight) return;
    endButton.classList.add("holding");
    endHoldTimer = window.setTimeout(finishHeldEnd, 1200);
  };
  endButton.onpointerdown = (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    endButton.setPointerCapture(e.pointerId);
    beginEndHold();
  };
  endButton.onpointerup = clearEndHold;
  endButton.onpointercancel = clearEndHold;
  endButton.onlostpointercapture = clearEndHold;
  endButton.onkeydown = (e) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      beginEndHold();
    }
  };
  endButton.onkeyup = (e) => {
    if (e.key === " " || e.key === "Enter") clearEndHold();
  };
  endButton.onclick = (e) => e.preventDefault();
  el("done").onclick = () => {
    landed = undefined;
    el<HTMLInputElement>("task").value = "";
    refreshDestinations(true);
    render();
    map?.select(origin);
    destinationInput.focus();
  };
  el("history-toggle").onclick = () => {
    historyMode = !historyMode;
    show("details", false);
    render();
    map?.select(
      historyMode ? undefined : origin,
      historyMode ? undefined : destination,
    );
    const list = el("history-list");
    list.replaceChildren();
    if (!state.flights.length) list.textContent = "还没有完成的航程";
    [...state.flights].reverse().forEach((f) => {
      const button = document.createElement("button");
      button.className = "history-item";
      const title = document.createElement("strong");
      title.textContent = `${f.originIata} → ${f.destinationIata}`;
      const summary = document.createElement("small");
      summary.textContent = `${f.durationSeconds / 60} min · ${new Date(f.completedAt).toLocaleDateString("zh-CN")}`;
      button.append(title, summary);
      button.onclick = () => {
        const a = airport(f.originIata),
          b = airport(f.destinationIata);
        map?.select(a, b, true);
        el("details").replaceChildren();
        for (const text of [
          `${a?.name || f.originIata} → ${b?.name || f.destinationIata}`,
          new Date(f.completedAt).toLocaleString("zh-CN"),
          `${f.durationSeconds / 60} min · ${Math.round(f.distanceKm).toLocaleString()} km`,
          f.task,
        ]) {
          const p = document.createElement("p");
          p.textContent = text;
          el("details").append(p);
        }
        show("details", true);
      };
      list.append(button);
    });
  };
  if (!airports.length) notice("机场数据无法加载，暂时无法起飞。");
  setInput("origin", origin);
  refreshDestinations(!!origin);
  render();
  tick();
  setInterval(tick, 250);
  window.addEventListener("focus", tick);
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("pagehide", stopPlaneAnimation);
}
