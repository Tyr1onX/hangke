import { renderTicketCodes } from "./ticket-codes.ts";
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
              <div id="duration" class="duration-ruler" role="slider" tabindex="0" aria-label="专注时长" aria-valuemin="10" aria-valuemax="180" aria-valuenow="60" aria-valuetext="60 分钟"><div id="duration-track" class="duration-track" aria-hidden="true"></div></div>
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
          <button id="boarding-back" class="back-action" type="button" aria-label="\u8fd4\u56de\u9009\u62e9\u5ea7\u4f4d">\u2190</button>
          <h1 id="boarding-stage-title">\u767b\u673a\u724c</h1>
          <div id="boarding-route-label" class="draft-route-label"></div>
        </div>
        <article class="boarding-pass" aria-label="\u767b\u673a\u724c">
          <div class="ticket-world-map" aria-hidden="true"></div>
          <div class="boarding-ticket-main"><span class="ticket-brand">HANGKE / FOCUS FLIGHT</span>
            <div class="boarding-route"><div><strong id="boarding-origin-code">---</strong><span id="boarding-origin-city">---</span></div><div class="boarding-flight-time"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 13 6-2 4-7 2 1-2 7 5 3c1 .6 1.2 1.9.4 2.7-.5.5-1.2.6-1.8.3l-5-2-3 4-1.5-.5 1-5-5-1.5Z"></path></svg><strong id="boarding-duration">--</strong></div><div><strong id="boarding-destination-code">---</strong><span id="boarding-destination-city">---</span></div></div>
            <div class="boarding-details"><div><span>\u5ea7\u4f4d</span><strong id="boarding-seat">--</strong></div><div><span>\u8ddd\u79bb</span><strong id="boarding-distance">--</strong></div><div><span>\u767b\u673a</span><strong id="boarding-time">--:--</strong></div><div><span>\u65e5\u671f</span><strong id="boarding-date"></strong></div></div>
          </div>
          <div class="boarding-tear-line" aria-hidden="true"><span></span></div>
          <div class="boarding-ticket-stub"><canvas id="boarding-barcode" class="boarding-barcode" aria-label="Code 128 barcode"></canvas><canvas id="boarding-qr" class="boarding-qr" width="84" height="84" aria-label="QR code for this local focus session"></canvas></div>
        </article>
        <div class="boarding-action"><button id="next-step" class="primary" type="button">\u503c\u673a</button></div>
      </section>

      <section id="checkin-stage" class="preflight-stage checkin-stage" aria-labelledby="checkin-title" hidden>
        <div class="stage-heading compact-heading">
          <button id="checkin-back" class="back-action" type="button" aria-label="\u8fd4\u56de\u767b\u673a\u724c">\u2190</button>
          <h1 id="checkin-title">\u503c\u673a</h1>
          <div id="checkin-route" class="draft-route-label"></div>
        </div>
        <p id="checkin-instruction" class="checkin-instruction">\u6cbf\u865a\u7ebf\u5411\u53f3\u6495\u5f00\u7968\u6839</p>
        <article id="checkin-ticket" class="boarding-pass boarding-pass-checkin" aria-label="\u53ef\u6495\u5f00\u7684\u767b\u673a\u724c">
          <div class="ticket-world-map" aria-hidden="true"></div>
          <div class="boarding-ticket-main"><span class="ticket-brand">HANGKE / FOCUS FLIGHT</span>
            <div class="boarding-route"><div><strong id="checkin-origin-code">---</strong><span id="checkin-origin-city">---</span></div><div class="boarding-flight-time"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 13 6-2 4-7 2 1-2 7 5 3c1 .6 1.2 1.9.4 2.7-.5.5-1.2.6-1.8.3l-5-2-3 4-1.5-.5 1-5-5-1.5Z"></path></svg><strong id="checkin-duration">--</strong></div><div><strong id="checkin-destination-code">---</strong><span id="checkin-destination-city">---</span></div></div>
            <div class="boarding-details"><div><span>\u5ea7\u4f4d</span><strong id="checkin-seat">--</strong></div><div><span>\u8ddd\u79bb</span><strong id="checkin-distance">--</strong></div><div><span>\u767b\u673a</span><strong id="checkin-time">--:--</strong></div><div><span>\u65e5\u671f</span><strong id="checkin-date"></strong></div></div>
          </div>
          <div class="boarding-tear-line" aria-hidden="true"><span class="tear-notch"></span><span class="tear-cut"></span><span id="checkin-tear-handle" class="tear-handle"><svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></span></div>
          <button id="checkin-stub" class="boarding-ticket-stub boarding-stub-detachable" type="button" aria-label="\u6cbf\u865a\u7ebf\u5411\u53f3\u6495\u5f00\u767b\u673a\u8054"><canvas id="checkin-barcode" class="boarding-barcode" aria-label="Code 128 barcode"></canvas><canvas id="checkin-qr" class="boarding-qr" width="84" height="84" aria-label="QR code for this local focus session"></canvas></button>
        </article>
      </section>

      <section id="airplane-stage" class="preflight-stage airplane-stage" aria-labelledby="airplane-title" hidden>
        <div class="stage-heading compact-heading">
          <h1 id="airplane-title">\u98de\u884c\u6a21\u5f0f</h1>
          <div id="airplane-route" class="draft-route-label"></div>
        </div>
        <div class="airplane-mode-card">
          <span class="airplane-mode-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m3.5 14.5 7-2.4 3.7-7.1 2.2.7-1.8 7.3 5.7 3.5c1 .6 1.2 1.9.4 2.7-.5.5-1.2.6-1.8.3l-6.4-2.4-3.8 3.2-1.6-.6 1.7-4.3-5.3-.9Z"></path></svg></span>
          <div><strong>\u4fdd\u6301\u4e13\u6ce8</strong><p>Windows \u7248\u6682\u4e0d\u4f1a\u62e6\u622a\u5176\u4ed6\u5e94\u7528\uff0c\u98de\u884c\u4e0e\u8ba1\u65f6\u672c\u8eab\u4e0d\u53d7\u5f71\u54cd\u3002</p></div>
        </div>
        <div class="boarding-action"><button id="boarding-action" class="primary" type="button">\u767b\u673a</button></div>
      </section>

      <section id="ready-stage" class="preflight-stage ready-stage" aria-labelledby="ready-title" hidden>
        <span class="ready-plane-icon" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M4 23h24M7 20l7-3 4-10 3 1-2 10 7 3c1.3.6 1.6 2.3.6 3.3-.7.7-1.7.8-2.6.4l-7-2.6-5 5-2-.7 2-6-5-1.4Z"></path></svg></span>
        <div class="ready-copy"><span>\u8231\u95e8\u5173\u95ed</span><h1 id="ready-title">\u98de\u884c\u5373\u5c06\u5f00\u59cb</h1><p id="ready-route"></p></div>
        <button id="go-takeoff" class="primary ready-go" type="button">\u51fa\u53d1\uff01</button>
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
          <div><span>\u4ece\u8fd9\u91cc\u51fa\u53d1\uff1f</span><strong id="origin-confirm-code">---</strong><small id="origin-confirm-city"></small></div>
          <div class="origin-confirm-actions"><button id="origin-cancel" class="text-action" type="button">\u53d6\u6d88</button><button id="origin-apply" class="primary" type="button">\u786e\u8ba4</button></div>
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
  let checkinCompletionId = 0;
  let pendingOrigin: Airport | undefined;
  let durationMinutes = 60;
  let selectedSeat = "";
  let selectedTask = "";
  let boardingAt = new Date();
  const durationRuler = el<HTMLDivElement>("duration"),
    durationTrack = el<HTMLDivElement>("duration-track");
  const durationMin = 10,
    durationMax = 180,
    durationStep = 5,
    durationTickWidth = 24;
  let durationPosition = ((durationMinutes - durationMin) / durationStep) * durationTickWidth;
  let durationVelocity = 0;
  let durationMotionFrame: number | null = null;
  let durationMotionTarget: number | null = null;
  let durationMotionTime = 0;
  let durationGeometryWidth = 0;
  let durationDrag: { pointerId: number; lastX: number; lastTime: number; moved: boolean } | undefined;
  let suppressDurationClick = false;
  let lastCandidateDuration = durationMinutes;
  const validDuration = () =>
    durationMinutes >= durationMin &&
    durationMinutes <= durationMax &&
    durationMinutes % durationStep === 0;
  const durationIndex = (minutes: number) =>
    Math.round((minutes - durationMin) / durationStep);
  const syncDurationVisual = () => {
    el("duration-value").textContent = `${durationMinutes} 分钟`;
    durationRuler.setAttribute("aria-valuenow", String(durationMinutes));
    durationRuler.setAttribute("aria-valuetext", `${durationMinutes} 分钟`);
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
    if (durationGeometryWidth !== durationRuler.clientWidth) {
      durationGeometryWidth = durationRuler.clientWidth;
      const clamped = Math.min(durationIndex(durationMax) * durationTickWidth, Math.max(0, durationPosition));
      durationRuler.scrollLeft = clamped;
      durationTrack.style.transform = `translate3d(${clamped - durationPosition}px,0,0)`;
    }
    syncDurationVisual();
  };
  const durationResizeObserver = new ResizeObserver(syncDurationGeometry);
  durationResizeObserver.observe(durationRuler);
  requestAnimationFrame(syncDurationGeometry);

  const formatDate = (date: Date) =>
    [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((part) => String(part).padStart(2, "0"))
      .join(".");
  const formatTime = (date: Date) =>
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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
      validDuration() &&
      durationRuler.dataset.motion !== "dragging" &&
      durationRuler.dataset.motion !== "settling"
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
    const originCity = origin ? airportPlanningLabel(origin) : "---";
    const destinationCity = destination ? airportPlanningLabel(destination) : "---";
    for (const prefix of ["boarding", "checkin"]) {
      el(`${prefix}-origin-code`).textContent = origin?.iata || "---";
      el(`${prefix}-origin-city`).textContent = originCity;
      el(`${prefix}-destination-code`).textContent = destination?.iata || "---";
      el(`${prefix}-destination-city`).textContent = destinationCity;
      el(`${prefix}-duration`).textContent = `${durationMinutes} MIN`;
      el(`${prefix}-distance`).textContent = actualDistanceKm
        ? `${Math.round(actualDistanceKm).toLocaleString()} KM`
        : "--";
      el(`${prefix}-seat`).textContent = selectedSeat || "--";
      el(`${prefix}-time`).textContent = formatTime(boardingAt);
      el(`${prefix}-date`).textContent = formatDate(boardingAt);
    }
    const ticketPayload = [
      origin?.iata || "---",
      destination?.iata || "---",
      selectedSeat || "--",
      durationMinutes,
      formatDate(boardingAt),
      formatTime(boardingAt),
    ].join("|");
    renderTicketCodes("boarding", "checkin", ticketPayload);
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
    if (durationRefreshTimer !== undefined) {
      window.clearTimeout(durationRefreshTimer);
      durationRefreshTimer = undefined;
    }
    lastCandidateDuration = durationMinutes;
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
  for (let row = 1; row <= 22; row += 1) {
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
    const checkinTicket = el("checkin-ticket");
    checkinTicket.classList.toggle("is-tearing", checkinStarted && !checkinCompleted);
    checkinTicket.classList.toggle("is-torn", checkinCompleted);
    el("checkin-instruction").textContent = checkinCompleted
      ? "\u503c\u673a\u5b8c\u6210"
      : "\u6cbf\u865a\u7ebf\u5411\u53f3\u6495\u5f00\u7968\u6839";
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
  const maxDurationPosition = () => durationIndex(durationMax) * durationTickWidth;
  const queueDurationCandidates = (immediate = false) => {
    if (durationRefreshTimer !== undefined) window.clearTimeout(durationRefreshTimer);
    const update = () => {
      durationRefreshTimer = undefined;
      if (lastCandidateDuration === durationMinutes) return;
      destination = undefined;
      refreshDestinations();
    };
    if (immediate) update();
    else durationRefreshTimer = window.setTimeout(update, 64);
  };
  const updateDurationFromPosition = () => {
    const clamped = Math.min(maxDurationPosition(), Math.max(0, durationPosition));
    const next = Math.min(
      durationMax,
      Math.max(
        durationMin,
        durationMin + Math.round(clamped / durationTickWidth) * durationStep,
      ),
    );
    if (next === durationMinutes) return;
    durationMinutes = next;
    syncDurationVisual();
    queueDurationCandidates();
  };
  const paintDurationPosition = () => {
    const max = maxDurationPosition();
    const clamped = Math.min(max, Math.max(0, durationPosition));
    const overscroll = clamped - durationPosition;
    durationRuler.scrollLeft = clamped;
    durationTrack.style.transform = `translate3d(${overscroll}px,0,0)`;
    updateDurationFromPosition();
  };
  const stopDurationMotion = () => {
    if (durationMotionFrame !== null) cancelAnimationFrame(durationMotionFrame);
    durationMotionFrame = null;
    durationMotionTarget = null;
    durationVelocity = 0;
    durationRuler.dataset.motion = "idle";
  };
  const settleDurationTarget = () => {
    const clamped = Math.min(maxDurationPosition(), Math.max(0, durationPosition));
    durationMotionTarget = Math.round(clamped / durationTickWidth) * durationTickWidth;
  };
  const animateDurationMotion = (now: number) => {
    durationMotionFrame = null;
    const dt = Math.min(32, Math.max(1, durationMotionTime ? now - durationMotionTime : 16));
    durationMotionTime = now;
    const max = maxDurationPosition();
    if (durationMotionTarget === null) {
      durationPosition += durationVelocity * dt;
      const bound = durationPosition < 0 ? 0 : durationPosition > max ? max : null;
      if (bound !== null) {
        durationVelocity += (bound - durationPosition) * 0.00042 * dt;
        durationVelocity *= Math.exp(-0.008 * dt);
        durationPosition = Math.min(max + 46, Math.max(-46, durationPosition));
      } else {
        durationVelocity *= Math.exp(-0.0032 * dt);
      }
      if (Math.abs(durationVelocity) < 0.035) settleDurationTarget();
    } else {
      const delta = durationMotionTarget - durationPosition;
      durationVelocity += delta * 0.00026 * dt;
      durationVelocity *= Math.exp(-0.012 * dt);
      durationPosition += durationVelocity * dt;
      if (Math.abs(delta) < 0.16 && Math.abs(durationVelocity) < 0.008) {
        durationPosition = durationMotionTarget;
        durationVelocity = 0;
        paintDurationPosition();
        durationTrack.style.transform = "translate3d(0,0,0)";
        durationMotionTarget = null;
        durationRuler.dataset.motion = "idle";
        queueDurationCandidates(true);
        refreshPlanner();
        return;
      }
    }
    paintDurationPosition();
    durationMotionFrame = requestAnimationFrame(animateDurationMotion);
  };
  const startDurationMotion = () => {
    if (durationMotionFrame !== null) return;
    durationMotionTime = performance.now();
    durationRuler.dataset.motion = "settling";
    durationMotionFrame = requestAnimationFrame(animateDurationMotion);
  };
  const springDurationTo = (minutes: number) => {
    const snapped = Math.min(
      durationMax,
      Math.max(durationMin, Math.round(minutes / durationStep) * durationStep),
    );
    stopDurationMotion();
    durationMinutes = snapped;
    syncDurationVisual();
    durationMotionTarget = durationIndex(snapped) * durationTickWidth;
    durationVelocity = 0;
    queueDurationCandidates();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      durationPosition = durationMotionTarget;
      durationMotionTarget = null;
      paintDurationPosition();
      durationRuler.dataset.motion = "idle";
      refreshPlanner();
      return;
    }
    startDurationMotion();
  };
  durationTrack.onclick = (event) => {
    if (durationDrag || suppressDurationClick) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-minutes]");
    if (!target) return;
    springDurationTo(Number(target.dataset.minutes));
  };
  durationRuler.onpointerdown = (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    stopDurationMotion();
    durationPosition = durationRuler.scrollLeft;
    durationVelocity = 0;
    durationDrag = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastTime: performance.now(),
      moved: false,
    };
    durationRuler.setPointerCapture(event.pointerId);
    durationRuler.classList.add("dragging");
    durationRuler.dataset.motion = "dragging";
  };
  durationRuler.onpointermove = (event) => {
    if (!durationDrag || durationDrag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const dx = event.clientX - durationDrag.lastX;
    const dt = Math.max(1, now - durationDrag.lastTime);
    if (Math.abs(dx) > 1) durationDrag.moved = true;
    let next = durationPosition - dx;
    const max = maxDurationPosition();
    if (durationPosition < 0 || durationPosition > max || next < 0 || next > max)
      next = durationPosition - dx * 0.34;
    next = Math.min(max + 46, Math.max(-46, next));
    const instantaneous = (next - durationPosition) / dt;
    durationVelocity = durationVelocity * 0.58 + instantaneous * 0.42;
    durationPosition = next;
    durationDrag.lastX = event.clientX;
    durationDrag.lastTime = now;
    paintDurationPosition();
  };
  const finishDurationDrag = (event: PointerEvent) => {
    if (!durationDrag || durationDrag.pointerId !== event.pointerId) return;
    const moved = durationDrag.moved;
    if (performance.now() - durationDrag.lastTime > 80) durationVelocity = 0;
    durationDrag = undefined;
    durationRuler.classList.remove("dragging");
    if (moved) {
      suppressDurationClick = true;
      window.setTimeout(() => { suppressDurationClick = false; }, 0);
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      durationPosition = Math.round(Math.min(maxDurationPosition(), Math.max(0, durationPosition)) / durationTickWidth) * durationTickWidth;
      durationVelocity = 0;
      paintDurationPosition();
      durationRuler.dataset.motion = "idle";
      queueDurationCandidates(true);
      refreshPlanner();
    } else startDurationMotion();
  };
  durationRuler.onpointerup = finishDurationDrag;
  durationRuler.onpointercancel = finishDurationDrag;
  durationRuler.addEventListener(
    "wheel",
    (event) => {
      if (preflightStage !== "flight" || event.ctrlKey) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? durationRuler.clientWidth : 1;
      const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit;
      if (durationMotionFrame === null) {
        durationPosition = durationRuler.scrollLeft;
        durationMotionTime = performance.now();
      }
      durationMotionTarget = null;
      durationVelocity = Math.max(-3.5, Math.min(3.5, durationVelocity + Math.max(-240, Math.min(240, delta)) * 0.0035));
      if (matchMedia("(prefers-reduced-motion: reduce)").matches)
        springDurationTo(durationMinutes + Math.sign(delta) * durationStep);
      else startDurationMotion();
    },
    { passive: false },
  );
  durationRuler.onkeydown = (event) => {
    let next = durationMinutes;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= durationStep;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next += durationStep;
    else if (event.key === "Home") next = durationMin;
    else if (event.key === "End") next = durationMax;
    else if (event.key === "PageDown") next -= 30;
    else if (event.key === "PageUp") next += 30;
    else return;
    event.preventDefault();
    springDurationTo(next);
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
    stopDurationMotion();
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
    resetCheckin();
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
    stopDurationMotion();
    durationPosition = durationIndex(durationMinutes) * durationTickWidth;
    paintDurationPosition();
    preflightStage = "seat";
    map?.select();
    renderPreflight();
    seatButtons[0]?.focus();
  };
  el<HTMLButtonElement>("confirm-seat").onclick = () => {
    if (!origin || !destination || !selectedSeat || !selectedTask) return;
    preflightStage = "boarding";
    boardingAt = new Date();
    resetCheckin();
    map?.select(origin, destination);
    renderPreflight();
    el("next-step").focus();
  };
  el<HTMLButtonElement>("next-step").onclick = () => {
    if (!origin || !destination || !selectedSeat || !selectedTask) return;
    preflightStage = "checkin";
    resetCheckin();
    checkinStarted = true;
    renderPreflight();
    paintCheckinProgress();
    requestAnimationFrame(() => el("checkin-stub").focus());
  };
  const checkinStub = el<HTMLButtonElement>("checkin-stub");
  const checkinTicket = el<HTMLElement>("checkin-ticket");
  let checkinDrag: { pointerId: number; startX: number; startProgress: number; travel: number } | undefined;
  const paintCheckinProgress = () => {
    checkinTicket.style.setProperty("--tear-progress", String(checkinProgress));
    const seam = el<HTMLElement>("checkin-tear-handle").parentElement!;
    const travel = Math.max(0, seam.clientWidth - 40);
    checkinTicket.style.setProperty("--tear-x", `${checkinProgress * travel}px`);
    checkinTicket.style.setProperty("--tear-drop", `${checkinProgress * 18}px`);
    checkinTicket.style.setProperty("--tear-angle", `${checkinProgress * -1.8}deg`);
    checkinTicket.style.setProperty("--tear-cut", `${checkinProgress * 100}%`);
    checkinStub.setAttribute("aria-valuenow", String(Math.round(checkinProgress * 100)));
  };
  function resetCheckin() {
    checkinCompletionId += 1;
    checkinStarted = false;
    checkinCompleted = false;
    checkinProgress = 0;
    checkinDrag = undefined;
    checkinTicket.classList.remove("dragging", "springing", "is-torn");
    paintCheckinProgress();
  }
  const completeCheckin = () => {
    if (checkinCompleted || !checkinStarted || preflightStage !== "checkin") return;
    const completionId = ++checkinCompletionId;
    checkinProgress = 1;
    checkinCompleted = true;
    checkinTicket.classList.remove("dragging", "springing");
    paintCheckinProgress();
    renderPreflight();
    window.setTimeout(() => {
      if (completionId !== checkinCompletionId || !checkinCompleted || preflightStage !== "checkin") return;
      preflightStage = "airplane";
      renderPreflight();
      el("boarding-action").focus();
    }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650);
  };
  checkinStub.setAttribute("role", "slider");
  checkinStub.setAttribute("aria-orientation", "horizontal");
  checkinStub.setAttribute("aria-valuemin", "0");
  checkinStub.setAttribute("aria-valuemax", "100");
  checkinStub.setAttribute("aria-valuenow", "0");
  checkinTicket.onpointerdown = (event) => {
    if (!checkinStarted || checkinCompleted || checkinDrag || event.button !== 0 || !event.isPrimary) return;
    if (!(event.target as Element).closest("#checkin-stub, #checkin-tear-handle")) return;
    event.preventDefault();
    const seam = el<HTMLElement>("checkin-tear-handle").parentElement!.getBoundingClientRect();
    checkinDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startProgress: checkinProgress,
      travel: Math.max(1, seam.right - event.clientX - 20),
    };
    checkinTicket.setPointerCapture(event.pointerId);
    checkinTicket.classList.remove("springing");
    checkinTicket.classList.add("dragging");
  };
  checkinTicket.onpointermove = (event) => {
    if (!checkinDrag || checkinDrag.pointerId !== event.pointerId) return;
    checkinProgress = Math.min(1, Math.max(0, checkinDrag.startProgress + (event.clientX - checkinDrag.startX) / checkinDrag.travel));
    paintCheckinProgress();
  };
  const finishCheckinDrag = (event: PointerEvent) => {
    if (!checkinDrag || checkinDrag.pointerId !== event.pointerId) return;
    checkinDrag = undefined;
    checkinTicket.classList.remove("dragging");
    if (event.type !== "pointercancel" && checkinProgress >= 0.85) {
      completeCheckin();
    } else if (!checkinCompleted) {
      checkinTicket.classList.add("springing");
      checkinProgress = 0;
      paintCheckinProgress();
      window.setTimeout(() => checkinTicket.classList.remove("springing"), 360);
    }
  };
  checkinTicket.onpointerup = finishCheckinDrag;
  checkinTicket.onpointercancel = finishCheckinDrag;
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
      resetCheckin();
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
          `${a ? airportPlanningLabel(a) : f.originIata} → ${b ? airportPlanningLabel(b) : f.destinationIata}`,
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
