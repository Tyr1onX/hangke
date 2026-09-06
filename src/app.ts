import {
  airports,
  airport,
  coordinates,
  search,
  reachable,
  focusDistanceKm,
  airportCityLabel,
  airportPlanningLabel,
  airportNameLabel,
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
  root.innerHTML = `<header><button id="history-toggle" class="history-tool-button" type="button" aria-label="航迹" data-tooltip="航迹" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"></path><path d="M8.5 8h7M8.5 12h3.5M8.5 16h7"></path><circle cx="15.5" cy="12" r="1.4"></circle></svg></button></header>
    <div id="notice" role="alert" hidden></div><div id="map-error" role="alert" hidden>地图加载失败 <button id="retry">重试</button></div>
    <form id="planner" class="preflight-console" autocomplete="off">
      <section id="home-stage" class="preflight-stage home-stage" aria-labelledby="home-stage-title">
        <div class="home-airport-card">
          <span class="home-kicker">当前机场</span>
          <div class="home-airport"><strong id="home-origin-code">---</strong><span id="home-origin-city">尚未设置</span></div>
          <button id="home-change-origin" class="text-action" type="button">修改出发机场</button>
          <button id="start-preflight" class="primary home-primary" type="button">开始专注飞行</button>
        </div>
      </section>

      <section id="flight-stage" class="preflight-stage flight-stage" aria-labelledby="flight-stage-title" hidden>
        <div class="stage-heading compact-heading">
          <button id="flight-back" class="back-action" type="button" aria-label="返回主页">←</button>
          <h1 id="flight-stage-title">选择航班</h1>
          <div class="draft-route" aria-label="当前航线"><strong id="draft-origin-code">---</strong><span aria-hidden="true">→</span><strong id="draft-destination-code">---</strong></div>
        </div>
        <div class="flight-controls">
          <button id="flight-origin" class="flight-origin" type="button">
            <span>出发机场</span><strong id="flight-origin-code">---</strong><small id="flight-origin-city">设置</small>
          </button>
          <div class="duration-panel">
            <div class="duration-copy"><span>专注时长</span><strong id="duration-value">60 分钟</strong></div>
            <div class="duration-scale">
              <div id="duration" class="duration-ruler" role="slider" tabindex="0" aria-label="专注时长" aria-valuemin="30" aria-valuemax="180" aria-valuenow="60" aria-valuetext="60 分钟"><div id="duration-track" class="duration-track" aria-hidden="true"></div></div>
              <span class="duration-pointer" aria-hidden="true"></span>
            </div>
          </div>
        </div>
        <div class="carousel-heading"><span>目的机场</span></div>
        <div id="flight-carousel" class="flight-carousel" role="listbox" aria-label="选择目的机场"></div>
        <div class="stage-action-row"><button id="choose-flight" class="primary" type="button" disabled>选择航班</button></div>
      </section>

      <section id="seat-stage" class="preflight-stage seat-stage" aria-labelledby="seat-stage-title" hidden>
        <div class="stage-heading compact-heading">
          <button id="seat-back" class="back-action" type="button" aria-label="返回选择航班">←</button>
          <h1 id="seat-stage-title">选择座位</h1>
          <div id="seat-route" class="draft-route-label"></div>
        </div>
        <div id="seat-content" class="seat-content">
          <div class="seat-cabin" aria-label="机舱座位图">
            <div class="cabin-nose" aria-hidden="true"><span></span></div>
            <div class="seat-columns" aria-hidden="true"><span>A</span><span>C</span><i></i><span>D</span><span>F</span></div>
            <div id="seat-grid" class="seat-grid"></div>
          </div>
          <div id="focus-picker" class="focus-picker" aria-labelledby="focus-picker-label" hidden>
            <span class="focus-seat-label" id="focus-seat-label"></span>
            <h2 id="focus-picker-label">选择专注类型</h2>
            <div class="task-options" role="group" aria-label="选择专注类型">
              <button class="focus-option" type="button" data-task="学习" data-task-key="learn" aria-pressed="false"><span class="focus-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c3.4-.8 5.8-.3 8 1.4v12c-2.2-1.7-4.6-2.2-8-1.4Z"></path><path d="M20 5.5c-3.4-.8-5.8-.3-8 1.4v12c2.2-1.7 4.6-2.2 8-1.4Z"></path></svg></span><span>学习</span></button>
              <button class="focus-option" type="button" data-task="代码" data-task-key="code" aria-pressed="false"><span class="focus-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"></rect><path d="m7.5 9 2.5 2.5L7.5 14M12.5 14h4"></path></svg></span><span>代码</span></button>
              <button class="focus-option" type="button" data-task="阅读" data-task-key="read" aria-pressed="false"><span class="focus-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h11a2 2 0 0 1 2 2v15H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 1-2Z"></path><path d="M8 3.5v17M11 8h5M11 11h5"></path></svg></span><span>阅读</span></button>
              <button class="focus-option" type="button" data-task="写作" data-task-key="write" aria-pressed="false"><span class="focus-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5 4 4M5 19l3.8-.8L19 8a2.1 2.1 0 0 0-3-3L5.8 15.2Z"></path><path d="M13 6.5 17.5 11"></path></svg></span><span>写作</span></button>
              <button class="focus-option" type="button" data-task="事务" data-task-key="tasks" aria-pressed="false"><span class="focus-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="7" width="17" height="12.5" rx="2"></rect><path d="M9 7V4.5h6V7M3.5 11.5h17M9.5 11.5v2h5v-2"></path></svg></span><span>事务</span></button>
            </div>
          </div>
        </div>
        <div class="stage-action-row seat-action-row"><span id="seat-summary" class="draft-distance"></span><button id="confirm-seat" class="primary" type="button" hidden>确认座位</button></div>
      </section>

      <section id="boarding-stage" class="preflight-stage boarding-stage" aria-labelledby="boarding-stage-title" hidden>
        <div class="stage-heading compact-heading">
          <button id="boarding-back" class="back-action" type="button" aria-label="返回选择座位">←</button>
          <h1 id="boarding-stage-title">登机牌</h1>
          <div id="boarding-route-label" class="draft-route-label"></div>
        </div>
        <article class="boarding-pass" aria-label="登机牌">
          <div class="boarding-route"><div><strong id="boarding-origin-code">---</strong><span id="boarding-origin-city">---</span></div><span class="boarding-route-arrow" aria-hidden="true">→</span><div><strong id="boarding-destination-code">---</strong><span id="boarding-destination-city">---</span></div></div>
          <div class="boarding-details"><div><span>TIME</span><strong id="boarding-duration">--</strong></div><div><span>DISTANCE</span><strong id="boarding-distance">--</strong></div><div><span>SEAT</span><strong id="boarding-seat">--</strong></div><div><span>FOCUS</span><strong id="boarding-task">--</strong></div><div><span>DATE</span><strong id="boarding-date"></strong></div></div>
          <div class="boarding-footer"><span class="boarding-barcode" aria-hidden="true"></span></div>
        </article>
        <div class="boarding-action"><button id="next-step" class="primary" type="button">值机</button></div>
      </section>

      <section id="checkin-stage" class="preflight-stage checkin-stage" aria-labelledby="checkin-title" hidden>
        <div class="stage-heading compact-heading">
          <button id="checkin-back" class="back-action" type="button" aria-label="返回登机牌">←</button>
          <h1 id="checkin-title">准备值机</h1>
          <div id="checkin-route" class="draft-route-label"></div>
        </div>
        <div id="checkin-card" class="checkin-card">
          <span class="checkin-status" aria-hidden="true">CHECK IN</span>
          <strong id="checkin-heading">登机牌已生成</strong>
          <p id="checkin-copy">点击开始值机，然后拖动票根</p>
          <div id="checkin-track" class="checkin-track" hidden>
            <div class="checkin-perforation" aria-hidden="true"></div>
            <button id="checkin-stub" class="checkin-stub" type="button" aria-label="向右拖动票根完成值机"><span aria-hidden="true">→</span></button>
          </div>
        </div>
        <div class="boarding-action"><button id="checkin-action" class="primary" type="button">开始值机</button></div>
      </section>

      <section id="airplane-stage" class="preflight-stage airplane-stage" aria-labelledby="airplane-title" hidden>
        <div class="stage-heading compact-heading">
          <h1 id="airplane-title">飞行模式</h1>
          <div id="airplane-route" class="draft-route-label"></div>
        </div>
        <div class="airplane-mode-card">
          <span class="airplane-mode-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.5 12h17M12 3.5v17M5.5 7.5l13 9M18.5 7.5l-13 9"></path></svg></span>
          <div><strong>减少干扰</strong><p>Windows 应用屏蔽尚未接入，本次航程不会拦截其他应用。</p></div>
        </div>
        <div class="boarding-action"><button id="boarding-action" class="primary" type="button">登机</button></div>
      </section>

      <section id="ready-stage" class="preflight-stage ready-stage" aria-labelledby="ready-title" hidden>
        <div class="ready-copy"><span>CABIN DOORS CLOSED</span><h1 id="ready-title">准备起飞</h1><p id="ready-route"></p></div>
        <button id="go-takeoff" class="primary ready-go" type="button">GO</button>
      </section>

      <section id="origin-sheet" class="origin-sheet" aria-labelledby="origin-sheet-title" hidden>
        <div class="origin-sheet-heading"><h2 id="origin-sheet-title">出发机场</h2><button id="close-origin" class="text-action" type="button">关闭</button></div>
        <div class="airport-field origin-field">
          <label for="origin">机场或城市</label>
          <input id="origin" placeholder="输入 IATA / 城市" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="origin-results">
          <small id="origin-name" class="airport-meta"></small>
          <div id="origin-results" class="results" role="listbox" hidden></div>
        </div>
        <div id="origin-confirm" class="origin-confirm" hidden>
          <div><span>STARTING FROM HERE?</span><strong id="origin-confirm-code">---</strong><small id="origin-confirm-city"></small></div>
          <div class="origin-confirm-actions"><button id="origin-cancel" class="text-action" type="button">??</button><button id="origin-apply" class="primary" type="button">??</button></div>
        </div>
      </section>
    </form>
    <section id="flight" hidden aria-label="飞行专注"><div id="flight-route" class="route-label"></div><div class="flight-views"><button id="follow-plane" class="flight-view-button" type="button" aria-label="跟随飞机" data-tooltip="跟随飞机"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><path d="M12 2v4M12 18v4M2 12h4M18 12h4"></path></svg></button><button id="route-view" class="flight-view-button" type="button" aria-label="查看完整航线" data-tooltip="查看完整航线"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="18" r="2"></circle><circle cx="19" cy="6" r="2"></circle><path d="M7 18c5.5 0 2.5-12 10-12M9 7h4M11 5v4"></path></svg></button></div><div class="flight-pause-control"><button id="pause-flight" class="flight-view-button pause-flight" type="button" aria-label="暂停飞行" data-tooltip="暂停飞行" aria-pressed="false"><svg class="pause-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7v10M15 7v10"></path></svg><svg class="resume-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5Z"></path></svg></button></div><div class="focus"><div id="timer" role="timer"></div><div id="remaining-distance"></div><p id="flight-task"></p><button id="cancel" class="quiet hold-end" type="button"><span>按住结束</span></button></div></section>
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
  let preflightStage:
    | "home"
    | "flight"
    | "seat"
    | "boarding"
    | "checkin"
    | "airplane"
    | "ready" = "home";
  let checkinStarted = false;
  let checkinCompleted = false;
  let checkinProgress = 0;
  let pendingOrigin: Airport | undefined;
  let durationMinutes = 60;
  let selectedSeat = "";
  let selectedTask = "";
  const durationRuler = el<HTMLDivElement>("duration"),
    durationTrack = el<HTMLDivElement>("duration-track");
  const durationMin = 30,
    durationMax = 180,
    durationStep = 5,
    durationTickWidth = 24;
  let expectedDurationScroll: number | undefined;
  const validDuration = () =>
    durationMinutes >= durationMin &&
    durationMinutes <= durationMax &&
    durationMinutes % durationStep === 0;
  const durationIndex = (minutes: number) =>
    Math.round((minutes - durationMin) / durationStep);
  const syncDurationVisual = (scroll = false) => {
    el("duration-value").textContent = `${durationMinutes} 分钟`;
    durationRuler.setAttribute("aria-valuenow", String(durationMinutes));
    durationRuler.setAttribute("aria-valuetext", `${durationMinutes} 分钟`);
    if (scroll) {
      expectedDurationScroll = durationIndex(durationMinutes) * durationTickWidth;
      durationRuler.scrollTo({
        left: expectedDurationScroll,
        behavior: "auto",
      });
    }
  };
  for (let minutes = durationMin; minutes <= durationMax; minutes += durationStep) {
    const tick = document.createElement("span");
    tick.className = `duration-tick${minutes % 10 === 0 ? " major" : ""}`;
    tick.dataset.minutes = String(minutes);
    if (minutes % 10 === 0) {
      const label = document.createElement("small");
      label.textContent =
        minutes < 60
          ? `${minutes}m`
          : minutes % 60
            ? `${Math.floor(minutes / 60)}h${minutes % 60}`
            : `${minutes / 60}h`;
      tick.append(label);
    }
    durationTrack.append(tick);
  }
  const syncDurationGeometry = () => {
    const side = Math.max(0, (durationRuler.clientWidth - durationTickWidth) / 2);
    durationTrack.style.paddingLeft = `${side}px`;
    durationTrack.style.paddingRight = `${side}px`;
    syncDurationVisual(true);
  };
  const durationResizeObserver = new ResizeObserver(syncDurationGeometry);
  durationResizeObserver.observe(durationRuler);
  requestAnimationFrame(syncDurationGeometry);

  const formatDate = (date: Date) =>
    [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((part) => String(part).padStart(2, "0"))
      .join(".");
  const setOriginInput = (a?: Airport) => {
    el<HTMLInputElement>("origin").value = a?.iata || "";
    el("origin-name").textContent = a ? airportPlanningLabel(a) : "";
  };
  const refreshPlanner = () => {
    const actualDistanceKm =
      origin && destination
        ? distance(coordinates(origin), coordinates(destination))
        : undefined;
    el<HTMLButtonElement>("choose-flight").disabled = !(
      airports.length &&
      origin &&
      destination &&
      origin.iata !== destination.iata &&
      validDuration()
    );
    const confirmSeat = el<HTMLButtonElement>("confirm-seat");
    confirmSeat.disabled = !(selectedSeat && selectedTask);
    confirmSeat.hidden = !(selectedSeat && selectedTask);
    el("home-origin-code").textContent = origin?.iata || "---";
    el("home-origin-city").textContent = origin
      ? airportPlanningLabel(origin)
      : "尚未设置";
    el("flight-origin-code").textContent = origin?.iata || "---";
    el("flight-origin-city").textContent = origin
      ? airportPlanningLabel(origin)
      : "设置";
    el("draft-origin-code").textContent = origin?.iata || "---";
    el("draft-destination-code").textContent = destination?.iata || "---";
    el("seat-route").textContent =
      origin && destination
        ? `${origin.iata} → ${destination.iata} · ${durationMinutes} MIN`
        : "";
    el("seat-summary").textContent =
      selectedSeat && selectedTask
        ? `${selectedSeat} · ${selectedTask}`
        : selectedSeat;
    el("focus-seat-label").textContent = selectedSeat
      ? `SEAT ${selectedSeat}`
      : "";
    el("boarding-route-label").textContent =
      origin && destination ? `${origin.iata} → ${destination.iata}` : "";
    el("checkin-route").textContent =
      origin && destination ? `${origin.iata} → ${destination.iata}` : "";
    el("airplane-route").textContent =
      origin && destination ? `${origin.iata} → ${destination.iata}` : "";
    el("ready-route").textContent =
      origin && destination
        ? `${origin.iata} → ${destination.iata} · ${durationMinutes} MIN`
        : "";
    el("boarding-origin-code").textContent = origin?.iata || "---";
    el("boarding-origin-city").textContent = origin
      ? airportPlanningLabel(origin)
      : "---";
    el("boarding-destination-code").textContent = destination?.iata || "---";
    el("boarding-destination-city").textContent = destination
      ? airportPlanningLabel(destination)
      : "---";
    el("boarding-duration").textContent = `${durationMinutes} MIN`;
    el("boarding-distance").textContent = actualDistanceKm
      ? `${Math.round(actualDistanceKm).toLocaleString()} KM`
      : "--";
    el("boarding-seat").textContent = selectedSeat || "--";
    el("boarding-task").textContent = selectedTask || "--";
    el("boarding-date").textContent = formatDate(new Date());
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

  const flightCarousel = el<HTMLDivElement>("flight-carousel");
  let destinationMatches: ReachableAirport[] = [];
  const refreshDestinations = (scrollToSelected = false) => {
    destinationMatches =
      origin && validDuration() ? reachable(origin, durationMinutes) : [];
    if (
      destination &&
      !destinationMatches.some(({ airport: a }) => a.iata === destination!.iata)
    )
      destination = undefined;

    flightCarousel.replaceChildren();
    if (!origin) {
      const empty = document.createElement("p");
      empty.className = "flight-carousel-empty";
      empty.textContent = "选择出发机场";
      flightCarousel.append(empty);
    } else if (!destinationMatches.length) {
      const empty = document.createElement("p");
      empty.className = "flight-carousel-empty";
      empty.textContent = "暂无可达航班";
      flightCarousel.append(empty);
    } else {
      destinationMatches.forEach(({ airport: a, distanceKm }) => {
        const selected = destination?.iata === a.iata;
        const card = document.createElement("button");
        card.type = "button";
        card.className = "flight-card";
        card.dataset.iata = a.iata;
        card.setAttribute("role", "option");
        card.setAttribute("aria-selected", String(selected));
        card.setAttribute(
          "aria-label",
          `${a.iata}，${airportPlanningLabel(a)}，${Math.round(distanceKm).toLocaleString()} km`,
        );
        const code = document.createElement("span");
        code.className = "flight-card-code";
        code.textContent = `✈ ${a.iata}`;
        const city = document.createElement("strong");
        city.className = "flight-card-city";
        city.textContent = airportPlanningLabel(a);
        card.append(code, city);
        if (selected) {
          const distanceLabel = document.createElement("small");
          distanceLabel.className = "flight-card-distance";
          distanceLabel.textContent = `${Math.round(distanceKm).toLocaleString()} km`;
          card.append(distanceLabel);
        }
        card.onclick = () => {
          if (destination?.iata !== a.iata) {
            selectedSeat = "";
            selectedTask = "";
          }
          destination = a;
          refreshDestinations(true);
        };
        flightCarousel.append(card);
      });
    }
    if (preflightStage === "flight" && !historyMode)
      map?.plan(
        origin,
        destinationMatches,
        destination,
        validDuration() ? focusDistanceKm(durationMinutes) : 0,
      );
    refreshPlanner();
    if (scrollToSelected && destination) {
      requestAnimationFrame(() =>
        flightCarousel
          .querySelector<HTMLElement>(`[data-iata="${destination!.iata}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }),
      );
    }
  };

  const resetOriginCandidate = () => {
    pendingOrigin = undefined;
    show("origin-confirm", false);
    setOriginInput(origin);
    if (preflightStage === "home") map?.select(origin);
    else if (preflightStage === "flight") refreshDestinations();
  };
  const closeOriginSheet = () => {
    closeOrigin();
    show("origin-sheet", false);
    resetOriginCandidate();
  };
  const openOriginSheet = () => {
    pendingOrigin = undefined;
    show("origin-confirm", false);
    setOriginInput(origin);
    show("origin-sheet", true);
    originInput.focus();
    originInput.select();
  };
  const previewOrigin = (a: Airport) => {
    pendingOrigin = a;
    setOriginInput(a);
    closeOrigin();
    el("origin-confirm-code").textContent = a.iata;
    el("origin-confirm-city").textContent = airportPlanningLabel(a);
    show("origin-confirm", true);
    map?.select(a);
    el<HTMLButtonElement>("origin-apply").focus();
  };
  const applyOrigin = () => {
    if (!pendingOrigin) return;
    origin = pendingOrigin;
    pendingOrigin = undefined;
    destination = undefined;
    selectedSeat = "";
    selectedTask = "";
    show("origin-confirm", false);
    show("origin-sheet", false);
    refreshDestinations();
    if (preflightStage === "home") map?.select(origin);
    refreshPlanner();
    el<HTMLButtonElement>(
      preflightStage === "flight" ? "flight-origin" : "home-change-origin",
    ).focus();
  };
  originInput.oninput = () => {
    pendingOrigin = undefined;
    show("origin-confirm", false);
    el("origin-name").textContent = "";
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
      code.className = "airport-option-code";
      code.textContent = a.iata;
      const name = document.createElement("span");
      name.className = "airport-option-name";
      name.textContent = airportCityLabel(a);
      const details = document.createElement("small");
      details.className = "airport-option-airport";
      details.textContent = airportNameLabel(a);
      item.setAttribute(
        "aria-label",
        `${a.iata}, ${airportCityLabel(a)}, ${airportNameLabel(a)}`,
      );
      item.append(code, name, details);
      item.onmousedown = (e) => e.preventDefault();
      item.onclick = () => previewOrigin(a);
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
      if (selected) previewOrigin(selected);
    }
  };
  originInput.onblur = closeOrigin;

  const seatGrid = el<HTMLDivElement>("seat-grid");
  for (let row = 1; row <= 7; row += 1) {
    const rowNumber = String(row).padStart(2, "0");
    const seatRow = document.createElement("div");
    seatRow.className = "seat-row";
    for (const column of ["A", "C"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.seat = `${rowNumber}${column}`;
      button.textContent = `${rowNumber}${column}`;
      button.setAttribute("aria-label", `座位 ${rowNumber}${column}`);
      button.setAttribute("aria-pressed", "false");
      seatRow.append(button);
    }
    const label = document.createElement("span");
    label.className = "seat-row-number";
    label.textContent = rowNumber;
    seatRow.append(label);
    for (const column of ["D", "F"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.seat = `${rowNumber}${column}`;
      button.textContent = `${rowNumber}${column}`;
      button.setAttribute("aria-label", `座位 ${rowNumber}${column}`);
      button.setAttribute("aria-pressed", "false");
      seatRow.append(button);
    }
    seatGrid.append(seatRow);
  }

  const taskButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-task]"),
  );
  for (const button of taskButtons)
    button.onclick = () => {
      selectedTask = button.dataset.task || "";
      for (const item of taskButtons)
        item.setAttribute(
          "aria-pressed",
          String(item.dataset.task === selectedTask),
        );
      for (const seat of seatButtons) {
        seat.removeAttribute("data-focus");
        seat.removeAttribute("data-focus-key");
      }
      if (selectedSeat && selectedTask)
        seatButtons
          .find((seat) => seat.dataset.seat === selectedSeat)
          ?.setAttribute("data-focus", selectedTask);
      seatButtons
        .find((seat) => seat.dataset.seat === selectedSeat)
        ?.setAttribute(
          "data-focus-key",
          taskButtons.find((item) => item.dataset.task === selectedTask)?.dataset.taskKey || "",
        );
      refreshPlanner();
    };
  const seatButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-seat]"),
  );
  for (const button of seatButtons)
    button.onclick = () => {
      const nextSeat = button.dataset.seat || "";
      if (selectedSeat !== nextSeat) selectedTask = "";
      selectedSeat = nextSeat;
      for (const item of seatButtons)
        item.setAttribute(
          "aria-pressed",
          String(item.dataset.seat === selectedSeat),
        );
      for (const item of taskButtons) item.setAttribute("aria-pressed", "false");
      const focusPicker = el("focus-picker");
      focusPicker.hidden = false;
      focusPicker.classList.remove("is-visible");
      requestAnimationFrame(() => focusPicker.classList.add("is-visible"));
      refreshPlanner();
      taskButtons[0]?.focus();
    };

  const renderPreflight = () => {
    el("planner").dataset.stage = preflightStage;
    show("home-stage", preflightStage === "home");
    show("flight-stage", preflightStage === "flight");
    show("seat-stage", preflightStage === "seat");
    show("boarding-stage", preflightStage === "boarding");
    show("checkin-stage", preflightStage === "checkin");
    show("airplane-stage", preflightStage === "airplane");
    show("ready-stage", preflightStage === "ready");
    for (const button of seatButtons)
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.seat === selectedSeat),
      );
    for (const button of taskButtons)
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.task === selectedTask),
      );
    for (const seat of seatButtons) {
        seat.removeAttribute("data-focus");
        seat.removeAttribute("data-focus-key");
      }
    if (selectedSeat && selectedTask)
      seatButtons
        .find((seat) => seat.dataset.seat === selectedSeat)
        ?.setAttribute("data-focus", selectedTask);
    const focusPicker = el("focus-picker");
    focusPicker.hidden = !selectedSeat;
    focusPicker.classList.toggle("is-visible", !!selectedSeat);
    const checkinTrack = el("checkin-track");
    checkinTrack.hidden = !checkinStarted || checkinCompleted;
    el("checkin-card").classList.toggle("is-started", checkinStarted);
    el("checkin-card").classList.toggle("is-complete", checkinCompleted);
    el("checkin-heading").textContent = checkinCompleted
      ? "值机完成"
      : checkinStarted
        ? "拖动票根完成值机"
        : "登机牌已生成";
    el("checkin-copy").textContent = checkinCompleted
      ? "票根已分离"
      : checkinStarted
        ? "将票根拖到右侧"
        : "点击开始值机，然后拖动票根";
    show("checkin-action", preflightStage === "checkin" && !checkinStarted);
    refreshPlanner();
    if (preflightStage === "home") map?.select(origin);
    else if (preflightStage === "flight")
      map?.plan(
        origin,
        destinationMatches,
        destination,
        validDuration() ? focusDistanceKm(durationMinutes) : 0,
      );
    else if (preflightStage === "seat") map?.select();
    else map?.select(origin, destination);
  };

  let durationRefreshTimer: number | undefined;
  const settleDuration = () => {
    const snapped = Math.min(
      durationMax,
      Math.max(
        durationMin,
        durationMin +
          Math.round(durationRuler.scrollLeft / durationTickWidth) *
            durationStep,
      ),
    );
    durationMinutes = snapped;
    syncDurationVisual(true);
    destination = undefined;
    refreshDestinations();
  };
  const scheduleDurationSettle = () => {
    if (durationRefreshTimer !== undefined)
      window.clearTimeout(durationRefreshTimer);
    durationRefreshTimer = window.setTimeout(() => {
      durationRefreshTimer = undefined;
      settleDuration();
    }, 130);
  };
  const applyDuration = (minutes: number, scroll: boolean) => {
    if (durationRefreshTimer !== undefined) {
      window.clearTimeout(durationRefreshTimer);
      durationRefreshTimer = undefined;
    }
    const snapped = Math.min(
      durationMax,
      Math.max(durationMin, Math.round(minutes / durationStep) * durationStep),
    );
    durationMinutes = snapped;
    syncDurationVisual(scroll);
    destination = undefined;
    refreshDestinations();
  };
  durationRuler.addEventListener(
    "scroll",
    () => {
      if (
        expectedDurationScroll !== undefined &&
        Math.abs(durationRuler.scrollLeft - expectedDurationScroll) < 1
      ) {
        expectedDurationScroll = undefined;
        return;
      }
      expectedDurationScroll = undefined;
      const next = Math.min(
        durationMax,
        Math.max(
          durationMin,
          durationMin +
            Math.round(durationRuler.scrollLeft / durationTickWidth) *
              durationStep,
        ),
      );
      if (next !== durationMinutes) {
        durationMinutes = next;
        syncDurationVisual();
      }
      scheduleDurationSettle();
    },
    { passive: true },
  );
  durationTrack.onclick = (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-minutes]",
    );
    if (!target) return;
    applyDuration(Number(target.dataset.minutes), true);
  };
  let durationDrag: { pointerId: number; x: number; left: number } | undefined;
  durationRuler.onpointerdown = (event) => {
    if (!event.isPrimary || event.button !== 0 || event.pointerType !== "mouse")
      return;
    durationDrag = {
      pointerId: event.pointerId,
      x: event.clientX,
      left: durationRuler.scrollLeft,
    };
    durationRuler.setPointerCapture(event.pointerId);
    durationRuler.classList.add("dragging");
  };
  durationRuler.onpointermove = (event) => {
    if (!durationDrag || durationDrag.pointerId !== event.pointerId) return;
    durationRuler.scrollLeft =
      durationDrag.left - (event.clientX - durationDrag.x);
  };
  const finishDurationDrag = (event: PointerEvent) => {
    if (!durationDrag || durationDrag.pointerId !== event.pointerId) return;
    durationDrag = undefined;
    durationRuler.classList.remove("dragging");
    scheduleDurationSettle();
  };
  durationRuler.onpointerup = finishDurationDrag;
  durationRuler.onpointercancel = finishDurationDrag;
  durationRuler.onkeydown = (event) => {
    let next = durationMinutes;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown")
      next -= durationStep;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp")
      next += durationStep;
    else if (event.key === "Home") next = durationMin;
    else if (event.key === "End") next = durationMax;
    else if (event.key === "PageDown") next -= 30;
    else if (event.key === "PageUp") next += 30;
    else return;
    event.preventDefault();
    applyDuration(next, true);
  };
  map?.setAirportSelectHandler((selectedAirport) => {
    if (
      preflightStage !== "flight" ||
      historyMode ||
      !origin ||
      !destinationMatches.some(
        (item) => item.airport.iata === selectedAirport.iata,
      )
    )
      return;
    destination = selectedAirport;
    refreshDestinations(true);
  });

  el<HTMLFormElement>("planner").onsubmit = (event) => event.preventDefault();
  el<HTMLButtonElement>("home-change-origin").onclick = openOriginSheet;
  el<HTMLButtonElement>("flight-origin").onclick = openOriginSheet;
  el<HTMLButtonElement>("close-origin").onclick = closeOriginSheet;
  el<HTMLButtonElement>("origin-cancel").onclick = resetOriginCandidate;
  el<HTMLButtonElement>("origin-apply").onclick = applyOrigin;
  el<HTMLButtonElement>("start-preflight").onclick = () => {
    if (!origin) {
      openOriginSheet();
      return;
    }
    preflightStage = "flight";
    refreshDestinations();
    renderPreflight();
    requestAnimationFrame(syncDurationGeometry);
  };
  el<HTMLButtonElement>("flight-back").onclick = () => {
    preflightStage = "home";
    renderPreflight();
  };
  el<HTMLButtonElement>("seat-back").onclick = () => {
    preflightStage = "flight";
    refreshDestinations(true);
    renderPreflight();
  };
  el<HTMLButtonElement>("boarding-back").onclick = () => {
    preflightStage = "seat";
    renderPreflight();
  };
  el<HTMLButtonElement>("checkin-back").onclick = () => {
    checkinStarted = false;
    checkinCompleted = false;
    checkinProgress = 0;
    preflightStage = "boarding";
    renderPreflight();
  };
  el<HTMLButtonElement>("choose-flight").onclick = () => {
    refreshPlanner();
    if (
      el<HTMLButtonElement>("choose-flight").disabled ||
      !origin ||
      !destination
    )
      return;
    preflightStage = "seat";
    map?.select();
    renderPreflight();
    seatButtons[0]?.focus();
  };
  el<HTMLButtonElement>("confirm-seat").onclick = () => {
    if (!origin || !destination || !selectedSeat || !selectedTask) return;
    preflightStage = "boarding";
    checkinStarted = false;
    checkinCompleted = false;
    checkinProgress = 0;
    map?.select(origin, destination);
    renderPreflight();
    el("next-step").focus();
  };
  el<HTMLButtonElement>("next-step").onclick = () => {
    if (!origin || !destination || !selectedSeat || !selectedTask) return;
    preflightStage = "checkin";
    checkinStarted = false;
    checkinCompleted = false;
    checkinProgress = 0;
    renderPreflight();
    el("checkin-action").focus();
  };
  el<HTMLButtonElement>("checkin-action").onclick = () => {
    checkinStarted = true;
    checkinCompleted = false;
    checkinProgress = 0;
    renderPreflight();
    requestAnimationFrame(() => el("checkin-stub").focus());
  };
  const checkinStub = el<HTMLButtonElement>("checkin-stub");
  const checkinTrack = el<HTMLDivElement>("checkin-track");
  let checkinDrag: { pointerId: number; startX: number; startProgress: number } | undefined;
  const paintCheckinProgress = () => {
    checkinTrack.style.setProperty("--checkin-progress", String(checkinProgress));
    checkinStub.setAttribute("aria-valuenow", String(Math.round(checkinProgress * 100)));
  };
  const completeCheckin = () => {
    checkinProgress = 1;
    checkinCompleted = true;
    paintCheckinProgress();
    renderPreflight();
    window.setTimeout(() => {
      if (!checkinCompleted || preflightStage !== "checkin") return;
      preflightStage = "airplane";
      renderPreflight();
      el("boarding-action").focus();
    }, 420);
  };
  checkinStub.setAttribute("role", "slider");
  checkinStub.setAttribute("aria-valuemin", "0");
  checkinStub.setAttribute("aria-valuemax", "100");
  checkinStub.setAttribute("aria-valuenow", "0");
  checkinStub.onpointerdown = (event) => {
    if (!checkinStarted || checkinCompleted || event.button !== 0) return;
    checkinDrag = { pointerId: event.pointerId, startX: event.clientX, startProgress: checkinProgress };
    checkinStub.setPointerCapture(event.pointerId);
    checkinTrack.classList.add("dragging");
  };
  checkinStub.onpointermove = (event) => {
    if (!checkinDrag || checkinDrag.pointerId !== event.pointerId) return;
    const travel = Math.max(1, checkinTrack.clientWidth - checkinStub.offsetWidth - 12);
    checkinProgress = Math.min(1, Math.max(0, checkinDrag.startProgress + (event.clientX - checkinDrag.startX) / travel));
    paintCheckinProgress();
    if (checkinProgress >= 0.88) completeCheckin();
  };
  const finishCheckinDrag = (event: PointerEvent) => {
    if (!checkinDrag || checkinDrag.pointerId !== event.pointerId) return;
    checkinDrag = undefined;
    checkinTrack.classList.remove("dragging");
    if (!checkinCompleted) {
      checkinProgress = 0;
      paintCheckinProgress();
    }
  };
  checkinStub.onpointerup = finishCheckinDrag;
  checkinStub.onpointercancel = finishCheckinDrag;
  checkinStub.onkeydown = (event) => {
    if ((event.key === "Enter" || event.key === " ") && checkinStarted && !checkinCompleted) {
      event.preventDefault();
      completeCheckin();
    }
  };
  el<HTMLButtonElement>("boarding-action").onclick = () => {
    if (!checkinCompleted) return;
    preflightStage = "ready";
    renderPreflight();
    el("go-takeoff").focus();
  };
  el<HTMLButtonElement>("go-takeoff").onclick = () => {
    if (!origin || !destination || !selectedTask || !validDuration() || !storageAvailable)
      return;
    const startedAt = Date.now();
    const durationSeconds = durationMinutes * 60;
    if (
      commit({
        ...state,
        activeFlight: {
          id: crypto.randomUUID(),
          originIata: origin.iata,
          destinationIata: destination.iata,
          task: selectedTask,
          durationSeconds,
          startedAt,
          endsAt: startedAt + durationSeconds * 1000,
          distanceKm: distance(coordinates(origin), coordinates(destination)),
          pausedAt: null,
        },
      })
    ) {
      checkinStarted = false;
      checkinCompleted = false;
      checkinProgress = 0;
      render();
      tick();
      el("cancel").focus();
    }
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
    show("planner", !state.activeFlight && !landed && !historyMode);
    show("flight", !!state.activeFlight);
    show("landing", !!landed);
    show("history", historyMode);
    show("history-toggle", !state.activeFlight && !landed);
    const historyToggle = el<HTMLButtonElement>("history-toggle");
    historyToggle.setAttribute("aria-pressed", String(historyMode));
    historyToggle.setAttribute("aria-label", historyMode ? "关闭航迹" : "航迹");
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
    if (!state.activeFlight && !landed && !historyMode) renderPreflight();
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
        setOriginInput(origin);
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
      preflightStage = "home";
      selectedSeat = "";
      selectedTask = "";
      render();
      refreshDestinations();
      el("start-preflight").focus();
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
    preflightStage = "home";
    selectedSeat = "";
    selectedTask = "";
    destination = undefined;
    refreshDestinations();
    render();
    el("start-preflight").focus();
  };
  el("history-toggle").onclick = () => {
    historyMode = !historyMode;
    show("details", false);
    render();
    if (historyMode) map?.select();
    else if (preflightStage === "flight") refreshDestinations();
    else if (preflightStage === "boarding" && origin && destination)
      map?.select(origin, destination);
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
          `${a ? airportPlanningLabel(a) : f.originIata} ? ${b ? airportPlanningLabel(b) : f.destinationIata}`,
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
  setOriginInput(origin);
  refreshDestinations();
  render();
  tick();
  setInterval(tick, 250);
  window.addEventListener("focus", tick);
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("pagehide", stopPlaneAnimation);
}
