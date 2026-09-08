import { airport, airportNameLabel, airportPlanningLabel, type Airport } from "./airports.ts";
import { activeSummary, flightTotals, formatDistance, formatMinutes, homeGreeting, trendBuckets, trendFlights, flyingCalendar, sceneTotals, weekdayAverages, type HomePage, type TrendPeriod } from "./home.ts";
import { homeText as text } from "./home-copy.ts";
import worldAsset from "./assets/ticket-world.svg";
import { route } from "./geo.ts";
import type { CompletedFlight } from "./state.ts";
import type { AppState } from "./state.ts";
type Callbacks = {start:()=>void;changeOrigin:()=>void;mine:()=>void;resume:()=>void;page:(page:HomePage)=>void;airport:(a:Airport)=>void;roam:(active:boolean)=>void;roamControl:(action:"in"|"out"|"left"|"right"|"all")=>void;roamAirport:(a:Airport)=>void};
const metric=(label:string,value:string|number)=>`<div><span>${label}</span><strong>${value}</strong></div>`;
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const planeGlyph=`<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M23 3h2l2 16 16 11v4l-16-6v11l6 5v2l-9-3-9 3v-2l6-5V28L5 34v-4l16-11Z" fill="currentColor"/></svg>`;
function routeArt(flights:readonly CompletedFlight[]) {
  const point=(lon:number,lat:number)=>[(lon+180)/360*600,(90-lat)/180*300];
  const paths=flights.flatMap(f=>{const a=airport(f.originIata),b=airport(f.destinationIata);if(!a||!b)return [];
    const points=route([a.longitude,a.latitude],[b.longitude,b.latitude]).map(([lon,lat])=>point(((lon+180)%360+360)%360-180,lat));
    return `<path d="${points.map((p,i)=>`${!i||Math.abs(p[0]-points[i-1][0])>300?'M':'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ')}"/>`;}).join('');
  const dots=[...new Set(flights.flatMap(f=>[f.originIata,f.destinationIata]))].map(i=>{const a=airport(i);if(!a)return '';const [x,y]=point(a.longitude,a.latitude);return `<circle cx="${x}" cy="${y}" r="2.5"/>`;}).join('');
  return `<svg class="home-route-art" viewBox="0 0 600 300" aria-hidden="true"><image href="${worldAsset}" width="600" height="300" opacity=".32"/><g fill="none" stroke="#a7c9cf" stroke-width="1.2">${paths}</g><g fill="#d4e4e6">${dots}</g></svg>`;
}
const globeArt=`<div class="achievement-earth" aria-hidden="true"><div></div></div><div class="achievement-orbit" aria-hidden="true">${planeGlyph}</div>`;
const chart=(buckets:{label:string;minutes:number}[])=>{
 const max=Math.max(1,...buckets.map(b=>b.minutes));
 return buckets.map(b=>`<div class="home-chart-column" title="${escape(b.label)}: ${formatMinutes(b.minutes)}"><div class="home-chart-bar" style="height:${b.minutes/max*100}%"></div><small>${escape(b.label)}</small></div>`).join('');
};
export function createHome(root:HTMLElement, callbacks:Callbacks) {
  root.innerHTML=`
  <div id="home-overview" class="home-overview">
    <div class="home-intro"><div id="home-clock" class="home-clock"></div><h1 id="home-greeting"></h1>
      <div class="home-place-label">${text.currentLocation}</div><div class="home-airport"><strong id="home-origin-code">---</strong><span id="home-origin-city">${text.unset}</span></div>
      <button id="home-change-origin" class="home-location-action" type="button">${text.changeOrigin} <span aria-hidden="true">\u2197</span></button></div>
    <div class="home-journey"><div id="home-journey-caption" class="home-journey-caption"></div><button id="start-preflight" class="primary home-primary" type="button"><span id="home-start-label">${text.start}</span><span aria-hidden="true">\u2197</span></button></div>
    <nav class="home-shortcuts" aria-label="Hangke">
      <button type="button" data-home-page="progress" class="home-shortcut"><span class="home-shortcut-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 17h18M5 13l5-2 3-7 2 1-1 7 5 3-1 2-5-4-2-1 2-5-4-1Z"/></svg></span><span class="home-shortcut-title">${text.progress}</span><small id="home-progress-card">${text.noFlight}</small></button>
      <button type="button" data-home-page="mine" class="home-shortcut"><span class="home-shortcut-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></span><span class="home-shortcut-title">${text.mine}</span><small id="home-mine-card"></small></button>
      <button type="button" data-home-page="trends" class="home-shortcut"><span class="home-shortcut-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M7 15l4-4 3 2 5-7"/></svg></span><span class="home-shortcut-title">${text.trends}</span><small id="home-trends-card"></small></button>
      <button type="button" data-home-page="world" class="home-shortcut"><span class="home-shortcut-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18M12 3c-5 5-5 13 0 18"/></svg></span><span class="home-shortcut-title">${text.world}</span><small id="home-world-card"></small></button>
    </nav>
  </div>
  <section id="home-detail" class="home-detail" hidden aria-labelledby="home-detail-title"><div class="home-detail-heading"><button id="home-detail-back" class="back-action" type="button" aria-label="${text.back}">\u2190</button><h2 id="home-detail-title"></h2></div><div id="home-detail-content" class="home-detail-content"></div></section>`;
  const el=<T extends HTMLElement=HTMLElement>(id:string)=>root.querySelector<T>(`#${id}`)!;
  let page:HomePage="home",period:TrendPeriod="total";
  let currentState:AppState|undefined,currentOrigin:Airport|undefined,currentNow=Date.now(),contentKey="";
  const setPage=(next:HomePage)=>{
    if(next==="progress" && !currentState?.activeFlight)next="home";
    if(page===next)return;
    if(page==="roam")callbacks.roam(false);
    page=next;el("home-overview").hidden=next!=="home";el("home-detail").hidden=next==="home";
    root.dataset.page=next;
    el("home-detail").classList.toggle("is-roaming",next==="roam");
    if(next!=="home")el("home-detail-title").textContent=next==="roam"?"你的地球":text[next];
    el("home-detail-back").setAttribute("aria-label",next==="roam"?"返回世界":text.back);
    if(next==="roam")callbacks.roam(true);
    contentKey="";callbacks.page(next);
    if(currentState)render(currentState,currentOrigin,currentNow);
  };
  el<HTMLButtonElement>("start-preflight").onclick=callbacks.start;
  el<HTMLButtonElement>("home-change-origin").onclick=callbacks.changeOrigin;
  el<HTMLButtonElement>("home-detail-back").onclick=()=>setPage(page==="roam"?"world":"home");
  root.querySelectorAll<HTMLButtonElement>("[data-home-page]").forEach(b=>b.onclick=()=>{
    const next=b.dataset.homePage as HomePage|"mine";
    if(next==="mine")callbacks.mine();else setPage(next);
  });
  const render=(state:AppState,origin:Airport|undefined,now:number)=>{
    currentState=state;currentOrigin=origin;currentNow=now;
    const date=new Date(now);
    el("home-clock").textContent=date.toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false});
    el("home-greeting").textContent=homeGreeting(date);
    el("home-origin-code").textContent=origin?.iata||"---";
    el("home-origin-city").textContent=origin?airportPlanningLabel(origin):text.unset;
    const totals=flightTotals(state.flights),active=activeSummary(state.activeFlight,now);
    root.querySelector<HTMLButtonElement>('[data-home-page="progress"]')!.hidden=!active;
    root.querySelector('.home-shortcuts')!.classList.toggle('has-active',!!active);
    if(page==="progress" && !active){setPage("home");return;}
    const setStat=(id:string,value:string)=>{
      const match=value.match(/^([\d.,]+)\s*(.*)$/);
      if(!match){el(id).textContent=value;return;}
      const number=document.createElement("span"),unit=document.createElement("span");
      number.textContent=match[1];unit.textContent=match[2];unit.className="home-stat-unit";
      el(id).replaceChildren(number,unit);
    };
    setStat("home-mine-card",`${totals.flights} ${text.flights}`);
    setStat("home-trends-card",formatMinutes(totals.minutes));
    setStat("home-world-card",`${totals.airports} ${text.airports}`);
    el("home-progress-card").textContent=active?`${active.route} · ${active.paused?text.paused:text.flying}`:text.noFlight;
    el("home-journey-caption").textContent=origin?`${origin.iata} \u00b7 ${airportPlanningLabel(origin)}`:text.chooseOrigin;
    el("home-start-label").textContent=active?text.resume:text.start;
    if(page==="home")return;
    const content=el("home-detail-content");
    if(page==="progress" && active && state.activeFlight){
      const f=state.activeFlight;
      const key=f.id;
      if(contentKey!==key){
        contentKey=key;
        const a=airport(f.originIata),b=airport(f.destinationIata);
        content.innerHTML=`<article class="active-boarding"><header><span>${new Date(f.startedAt).toLocaleDateString("zh-CN")}</span><span id="home-active-status" class="flight-status"></span></header><h3 id="home-active-route" class="active-route"><span>${f.originIata}<small>${escape(a?airportPlanningLabel(a):f.originIata)}</small></span><span class="ticket-route-line">${planeGlyph}<small>${formatMinutes(f.durationSeconds/60)}</small></span><span>${f.destinationIata}<small>${escape(b?airportPlanningLabel(b):f.destinationIata)}</small></span></h3><div class="boarding-facts">${metric("出发",new Date(f.startedAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}))}${metric("飞行距离",formatDistance(f.distanceKm))}${metric("到达","—")}</div><p id="home-active-task"></p></article><div class="active-instruments"><article><h3>剩余飞行时间</h3><svg class="time-gauge" viewBox="0 0 200 115" aria-hidden="true"><path d="M18 100 A82 82 0 0 1 182 100" pathLength="100"/><path id="time-gauge-value" d="M18 100 A82 82 0 0 1 182 100" pathLength="100"/></svg><strong id="home-active-time"></strong></article><article><h3>剩余飞行距离</h3><strong id="home-active-distance"></strong><div class="distance-gauge" aria-hidden="true"><i id="distance-gauge-value"></i></div></article></div><button id="home-resume" class="primary" type="button">继续飞行 <span aria-hidden="true">↗</span></button>`;
        el<HTMLButtonElement>("home-resume").onclick=callbacks.resume;
      }
      el("home-active-status").textContent=active.paused?text.paused:text.flying;
      el("home-active-task").textContent=f.task;
      el("home-active-time").textContent=formatMinutes(active.remainingSeconds/60);
      el("home-active-distance").textContent=formatDistance(active.remainingKm);
      el("time-gauge-value").setAttribute("stroke-dasharray",`${Math.min(100,active.remainingSeconds/f.durationSeconds*100)} 100`);
      el("distance-gauge-value").style.left=`${f.distanceKm?Math.min(100,active.remainingKm/f.distanceKm*100):0}%`;
      return;
    }
    if(page==="trends"){
      const key=`trends:${period}:${state.flights.length}:${state.flights.at(-1)?.id||""}:${date.toDateString()}`;
      if(contentKey===key)return;
      contentKey=key;
      const periods:TrendPeriod[]=["total","year","month","week","day"];
      const names={total:"总计",year:text.year,month:text.month,week:text.week,day:text.day};
      const selected=trendFlights(state.flights,period,date),summary=flightTotals(selected);
      const calendar=flyingCalendar(state.flights,date),scenes=sceneTotals(selected);
      const colors=['#91c7c9','#b0c98c','#b7a5cf','#d0b27d','#90a9cc','#cda5a0'];
      let offset=0;
      const segments=scenes.map((scene,i)=>{const fraction=summary.minutes?scene.minutes/summary.minutes*100:0;
        const part=`<circle cx="100" cy="100" r="76" pathLength="100" stroke="${colors[i%colors.length]}" stroke-dasharray="${Math.max(0,fraction-(scenes.length>1?1:0))} ${100-Math.max(0,fraction-(scenes.length>1?1:0))}" stroke-dashoffset="${-offset}"/>`;offset+=fraction;return part;}).join('');
      content.innerHTML=`<div class="home-periods" role="group" aria-label="${text.period}">${periods.map(p=>`<button type="button" data-period="${p}" aria-pressed="${p===period}">${names[p]}</button>`).join("")}</div><div class="trend-grid"><article class="trend-streak"><h3>连续飞行 <small>最近 14 天 · 全部记录</small></h3><div class="trend-number"><strong>${calendar.streak}<small> 天</small></strong><span>${calendar.today?'今日已飞行':'今日未飞行'}</span></div><div class="flight-calendar">${calendar.calendar.map(d=>`<div title="${d.label} · ${d.flown?'已飞行':'未飞行'}"><i class="${d.flown?'flown':''} ${d.today?'today':''}"></i><small>${d.label}</small></div>`).join('')}</div></article><article class="trend-time"><h3>专注时间</h3><strong class="trend-number" id="home-trend-metrics">${formatMinutes(summary.minutes)}</strong><div class="home-chart" id="home-chart" aria-label="专注时间图表">${chart(trendBuckets(selected,period,date))}</div>${!selected.length?'<p class="chart-empty">此周期暂无已完成航程</p>':''}</article><article class="trend-flights"><h3>航班</h3><strong class="trend-number">${summary.flights}<small> 次</small></strong>${routeArt(selected)}<p>${formatDistance(summary.distanceKm)} · ${summary.airports} 座到访机场</p></article><article class="trend-weekday"><h3>星期平均</h3><p>按各星期几有专注记录的日期平均</p><div class="home-chart" aria-label="星期平均专注时间">${chart(weekdayAverages(selected))}</div></article><article class="trend-scenes"><h3>专注场景</h3><div class="scene-chart"><svg viewBox="0 0 200 200" aria-hidden="true"><circle class="scene-track" cx="100" cy="100" r="76"/>${segments}</svg><div><strong>${formatMinutes(summary.minutes)}</strong><span>总计</span></div></div><ul>${scenes.map((scene,i)=>`<li><i style="background:${colors[i%colors.length]}"></i><span>${escape(scene.task)}</span><strong>${formatMinutes(scene.minutes)}</strong></li>`).join('')||'<li>完成航程后显示专注场景</li>'}</ul></article></div><p class="home-chart-note">${text.completedOnly} · 按本地完成日期统计</p>`;
      content.querySelectorAll<HTMLButtonElement>("[data-period]").forEach(b=>b.onclick=()=>{period=b.dataset.period as TrendPeriod;contentKey="";render(currentState!,currentOrigin,Date.now());});
      return;
    }
    if(page==="roam"){
      if(contentKey==="roam")return;
      contentKey="roam";
      const visited=[...new Set(state.flights.flatMap(f=>[f.originIata,f.destinationIata]))];
      content.innerHTML=`<p class="roam-hint">3D 漫游 · 拖动地球旋转，滚轮缩放</p><div class="roam-controls" role="group" aria-label="地球视角"><button type="button" data-roam="left" aria-label="向左旋转">↶</button><button type="button" data-roam="right" aria-label="向右旋转">↷</button><button type="button" data-roam="in" aria-label="放大">＋</button><button type="button" data-roam="out" aria-label="缩小">−</button><button type="button" data-roam="all">地球全览</button></div><div class="roam-airports"><label for="roam-airport">到访机场 · ${visited.length}</label><select id="roam-airport"><option value="">${visited.length?'选择机场查看':'完成航程后记录机场与航线'}</option>${visited.map(i=>`<option value="${i}">${i} · ${escape(airport(i)?airportPlanningLabel(airport(i)!):i)}</option>`).join('')}</select><div id="roam-airport-info"></div></div>`;
      content.querySelectorAll<HTMLButtonElement>('[data-roam]').forEach(b=>b.onclick=()=>callbacks.roamControl(b.dataset.roam as 'in'|'out'|'left'|'right'|'all'));
      el<HTMLSelectElement>('roam-airport').onchange=()=>{const a=airport(el<HTMLSelectElement>('roam-airport').value);if(a){showRoamAirport(a);callbacks.roamAirport(a);}};
      return;
    }
    if(page==="world"){
      const key=`world:${state.flights.length}:${state.flights.at(-1)?.id||""}`;
      if(contentKey===key)return;
      contentKey=key;
      const visited=[...new Set(state.flights.flatMap(f=>[f.originIata,f.destinationIata]))];
      const arrivalAirports=visited.map(i=>airport(i)).filter((a):a is Airport=>!!a && state.flights.some(f=>f.destinationIata===a.iata));
      const extreme=(north:boolean)=>[...arrivalAirports].sort((a,b)=>north?b.latitude-a.latitude:a.latitude-b.latitude)[0];
      const achievementCards=[true,false].map(north=>{
        const a=extreme(north);if(!a)return '';
        const arrived=state.flights.filter(f=>f.destinationIata===a.iata).sort((a,b)=>a.completedAt-b.completedAt)[0];
        return `<article class="world-achievement world-record"><h3>到访最${north?'北':'南'}城市</h3><strong>${escape(airportPlanningLabel(a))}</strong>${routeArt([arrived])}<div class="world-record-facts"><span>纬度<strong>${Math.abs(a.latitude).toFixed(2)}°${a.latitude<0?'S':'N'}</strong></span><span>到访<strong>${new Date(arrived.completedAt).toLocaleDateString('zh-CN')}</strong></span></div></article>`;
      }).join('');
      const longest=[...state.flights].sort((a,b)=>b.distanceKm-a.distanceKm)[0];
      const longestCard=longest?`<article class="world-achievement world-record"><h3>最长航线</h3><strong>${longest.originIata} → ${longest.destinationIata}</strong>${routeArt([longest])}<div class="world-record-facts"><span>时间 / 距离<strong>${formatMinutes(longest.durationSeconds/60)} · ${formatDistance(longest.distanceKm)}</strong></span><span>完成<strong>${new Date(longest.completedAt).toLocaleDateString('zh-CN')}</strong></span></div></article>`:'';
      const loops=totals.distanceKm/40075;
      const loopLabel=loops>0&&loops<.01?'&lt;0.01':loops.toFixed(2);
      content.innerHTML=`<button id="world-roam" class="world-roam-entry" type="button"><div class="mini-earth" aria-hidden="true"></div>${routeArt(state.flights)}<span>你的地球<strong>3D 漫游</strong><b aria-hidden="true">→</b></span></button><h3 class="home-section-label">世界卡片</h3><div class="world-card-deck" tabindex="0" aria-label="世界卡片，横向滚动查看更多"><article class="world-achievement"><div class="achievement-copy"><h3>环绕地球</h3><strong>${loopLabel}<small> 圈</small></strong><span>已飞行 ${formatDistance(totals.distanceKm)}</span></div>${globeArt}</article>${achievementCards}${longestCard}</div><h3 class="home-section-label">机场</h3><button id="world-airports-toggle" class="world-airports-card" type="button" aria-expanded="false" aria-controls="home-world-airports"><span><strong>${visited.length}</strong>到访机场<small>查看详情 →</small></span>${planeGlyph}${routeArt(state.flights)}</button><div id="home-world-airports" class="world-airport-list" hidden></div>`;
      el<HTMLButtonElement>('world-roam').onclick=()=>setPage('roam');
      el<HTMLButtonElement>('world-airports-toggle').onclick=()=>{const list=el('home-world-airports');list.hidden=!list.hidden;el('world-airports-toggle').setAttribute('aria-expanded',String(!list.hidden));};
      const list=el("home-world-airports");
      if(!visited.length)list.textContent=text.emptyWorld;
      for(const iata of visited){
        const a=airport(iata);if(!a)continue;
        const arrivals=state.flights.filter(f=>f.destinationIata===iata),departures=state.flights.filter(f=>f.originIata===iata);
        const last=Math.max(...arrivals.map(f=>f.completedAt),...departures.map(f=>f.startedAt));
        const minutes=arrivals.reduce((total,f)=>total+f.durationSeconds/60,0);
        const details=document.createElement('details');details.className='home-world-airport';
        details.innerHTML=`<summary><span class="airport-visit-copy"><strong>${escape(airportPlanningLabel(a))}</strong><small>${escape(a.ident)} · ${escape(airportNameLabel(a))}</small><span>${new Date(last).toLocaleDateString('zh-CN')}</span><span>抵达 ${arrivals.length} 次 · 累计飞行 ${formatMinutes(minutes)}</span></span><b aria-hidden="true">›</b></summary><p>${iata} · 出发 ${departures.length} 次 · 累计时间按抵达此机场的已完成航程统计</p><button type="button">在地球上查看 ↗</button>`;
        details.querySelector('button')!.onclick=()=>{setPage('roam');showRoamAirport(a);callbacks.roamAirport(a);};
        list.append(details);
      }
    }
  };
  const showRoamAirport=(a:Airport)=>{
    if(page!=="roam")return;
    el<HTMLSelectElement>('roam-airport').value=a.iata;
    el('roam-airport-info').textContent=`${a.iata} · ${a.name} · ${a.country}`;
  };

  return {render,setPage,showRoamAirport,getPage:()=>page};
}
