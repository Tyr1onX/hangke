import {
  airports,
  airport,
  coordinates,
  search,
  type Airport,
} from "./airports.ts";
import { distance } from "./geo.ts";
import { FlightMap } from "./map.ts";
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
    <span class="arrow" aria-hidden="true">→</span><div class="airport-field"><label for="destination">目的机场</label><input id="destination" placeholder="机场 / 城市" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="destination-results"><div id="destination-results" class="results" role="listbox" hidden></div></div>
    <label class="duration">专注时长<select id="duration" aria-label="专注时长"></select></label><label class="task-field">当前任务<input id="task" placeholder="准备专注什么？" maxlength="200"></label><button id="takeoff" class="primary" disabled>起飞</button><output id="distance"></output></form>
    <section id="flight" hidden aria-label="飞行专注"><div id="flight-route" class="route-label"></div><div class="focus"><div id="timer" role="timer"></div><p id="flight-task"></p><button id="cancel" class="quiet">结束航程</button></div></section>
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
  let map: FlightMap | undefined;
  try {
    map = new FlightMap((failed) => show("map-error", failed));
  } catch {
    show("map-error", true);
  }
  el("retry").onclick = () => window.location.reload();
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
  const setInput = (id: string, a?: Airport) => {
    el<HTMLInputElement>(id).value = a ? `${a.iata} · ${a.city || a.name}` : "";
  };
  for (const id of ["origin", "destination"]) {
    const input = el<HTMLInputElement>(id),
      results = el(`${id}-results`);
    let matches: Airport[] = [],
      index = -1;
    const close = () => {
      results.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      index = -1;
    };
    const choose = (a: Airport) => {
      if (id === "origin") origin = a;
      else destination = a;
      setInput(id, a);
      close();
      refreshPlanner();
      map?.select(origin, destination);
      input.focus();
    };
    input.oninput = () => {
      if (id === "origin") origin = undefined;
      else destination = undefined;
      map?.select(origin, destination);
      refreshPlanner();
      index = -1;
      input.removeAttribute("aria-activedescendant");
      matches = search(input.value);
      results.replaceChildren();
      matches.forEach((a, i) => {
        const item = document.createElement("div");
        item.id = `${id}-option-${i}`;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");
        const code = document.createElement("strong");
        code.textContent = `${a.iata} · ${a.city || a.country}`;
        const name = document.createElement("small");
        name.textContent = a.name;
        item.append(code, name);
        item.onmousedown = (e) => e.preventDefault();
        item.onclick = () => choose(a);
        results.append(item);
      });
      if (!matches.length && input.value.trim()) {
        const item = document.createElement("p");
        item.textContent = "未找到机场";
        results.append(item);
      }
      results.hidden = !input.value.trim();
      input.setAttribute("aria-expanded", String(!results.hidden));
    };
    input.onkeydown = (e) => {
      if (e.key === "Escape") close();
      if (
        ["ArrowDown", "ArrowUp"].includes(e.key) &&
        matches.length &&
        !results.hidden
      ) {
        e.preventDefault();
        index =
          (index +
            (e.key === "ArrowDown" ? 1 : matches.length - 1) +
            matches.length) %
          matches.length;
        Array.from(results.children).forEach((item, i) =>
          item.setAttribute("aria-selected", String(i === index)),
        );
        input.setAttribute("aria-activedescendant", `${id}-option-${index}`);
      }
      if (e.key === "Enter" && !results.hidden) {
        e.preventDefault();
        if (matches[index < 0 ? 0 : index])
          choose(matches[index < 0 ? 0 : index]);
      }
    };
    input.onblur = close;
  }
  el("task").oninput = refreshPlanner;
  duration.onchange = refreshPlanner;
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
      map?.select(airport(f.originIata), airport(f.destinationIata));
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
    render();
    map?.select(origin);
    el("destination").focus();
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
  render();
  tick();
  setInterval(tick, 250);
  window.addEventListener("focus", tick);
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("pagehide", stopPlaneAnimation);
}
