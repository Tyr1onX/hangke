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
  progress,
  type AppState,
  type CompletedFlight,
} from "./state.ts";

export function start() {
  const root = document.querySelector<HTMLDivElement>("#app")!;
  root.innerHTML = `<header><span class="brand">航刻</span><button id="history-toggle">航迹</button></header>
    <div id="notice" role="alert" hidden></div><div id="map-error" role="alert" hidden>地图加载失败 <button id="retry">重试</button></div>
    <form id="planner" autocomplete="off"><div class="airport-field"><label for="origin">出发机场</label><input id="origin" placeholder="机场 / 城市" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="origin-results"><div id="origin-results" class="results" role="listbox" hidden></div></div>
    <label class="duration">专注时长<select id="duration" aria-label="专注时长"></select></label><span class="arrow" aria-hidden="true">→</span><div class="airport-field"><label for="destination">可达目的地</label><input id="destination" placeholder="先选择出发机场和时长" readonly role="combobox" aria-expanded="false" aria-controls="destination-results"><div id="destination-results" class="results" role="listbox" hidden></div></div>
    <label class="task-field">当前任务<input id="task" placeholder="准备专注什么？" maxlength="200"></label><button id="takeoff" class="primary" disabled>起飞</button><output id="distance"></output></form>
    <section id="flight" hidden aria-label="飞行专注"><div id="flight-route" class="route-label"></div><div class="flight-views"><button id="follow-plane" class="quiet" type="button">跟随飞机</button><button id="route-view" class="quiet" type="button">查看航线</button></div><div class="focus"><div id="timer" role="timer"></div><p id="flight-task"></p><button id="cancel" class="quiet">结束航程</button></div></section>
    <section id="landing" class="result" hidden aria-label="航程完成"><p id="landing-route"></p><h1>航程完成</h1><p id="landing-metrics"></p><p id="landing-task"></p><button id="done" class="primary">完成</button></section>
    <aside id="history" hidden aria-label="航迹"><h1>航迹</h1><div id="history-list"></div><div id="details" hidden></div></aside>
    <dialog id="confirm"><p>结束本次航程？本次航程不会保存。</p><div class="dialog-actions"><button id="continue" autofocus>继续飞行</button><button id="end">结束航程</button></div></dialog>`;
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
    follow.textContent = view === "manual" ? "回到飞机" : "跟随飞机";
    follow.disabled = view === "focus";
    route.disabled = view === "route";
    follow.setAttribute("aria-pressed", String(view === "focus"));
    route.setAttribute("aria-pressed", String(view === "route"));
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
    if (!f || !map) return;
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
      Date.now() < state.activeFlight.endsAt
    ) {
      animationFrame = requestAnimationFrame(animatePlane);
    }
  };
  const render = () => {
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
      const a = airport(f.originIata),
        b = airport(f.destinationIata);
      map?.select(a, b);
      if (a && b && map) {
        map.fly(a, b, progress(f, Date.now()));
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
    if (now >= f.endsAt) {
      const next = finalize(state, now);
      if (commit(next)) {
        landed = next.flights.find((x) => x.id === f.id);
        origin = airport(next.lastAirportIata);
        destination = undefined;
        setInput("origin", origin);
        setInput("destination");
        el<HTMLDialogElement>("confirm").close();
        render();
      }
      return;
    }
    const seconds = Math.ceil((f.endsAt - now) / 1000);
    el("timer").textContent = `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
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
        },
      })
    ) {
      render();
      tick();
      el("cancel").focus();
    }
  };
  el("cancel").onclick = () => el<HTMLDialogElement>("confirm").showModal();
  el("continue").onclick = () => el<HTMLDialogElement>("confirm").close();
  el("end").onclick = () => {
    tick();
    if (!state.activeFlight) return;
    if (commit(cancel(state))) {
      el<HTMLDialogElement>("confirm").close();
      render();
      map?.select(origin, destination);
      el("origin").focus();
    }
  };
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
