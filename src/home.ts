import { progress, type ActiveFlight, type CompletedFlight } from "./state.ts";
import { homeText as text } from "./home-copy.ts";
export type HomePage = "home" | "progress" | "trends" | "world" | "roam";
export type TrendPeriod = "total" | "year" | "month" | "week" | "day";
export function flightTotals(flights: readonly CompletedFlight[]) {
  return {flights: flights.length, minutes: flights.reduce((s,f)=>s+f.durationSeconds/60,0),
    distanceKm: flights.reduce((s,f)=>s+f.distanceKm,0),
    airports: new Set(flights.flatMap(f=>[f.originIata,f.destinationIata])).size};
}
export function trendStart(period: TrendPeriod, now: Date): Date | null {
  if(period==="total") return null;
  const d=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if(period==="year") d.setMonth(0,1);
  if(period==="month") d.setDate(1);
  if(period==="week") d.setDate(d.getDate()-(d.getDay()+6)%7);
  return d;
}
export function trendFlights(flights: readonly CompletedFlight[], period: TrendPeriod, now: Date) {
  const start=trendStart(period,now);
  return flights.filter(f=>(!start||f.completedAt>=start.getTime())&&f.completedAt<=now.getTime());
}
export function trendBuckets(flights: readonly CompletedFlight[], period: TrendPeriod, now: Date) {
  const buckets:{label:string;minutes:number;start:number;end:number}[]=[];
  const make=(a:Date,b:Date,label:string)=>buckets.push({label,minutes:0,start:a.getTime(),end:b.getTime()});
  if(period==="day"){
    for(let h=0;h<24;h++)make(new Date(now.getFullYear(),now.getMonth(),now.getDate(),h),new Date(now.getFullYear(),now.getMonth(),now.getDate(),h+1),String(h).padStart(2,"0"));
  }else if(period==="week"){
    const d=trendStart("week",now)!;
    for(let i=0;i<7;i++)make(new Date(d.getFullYear(),d.getMonth(),d.getDate()+i),new Date(d.getFullYear(),d.getMonth(),d.getDate()+i+1),text.weekday[i]);
  }else if(period==="month"){
    const d=trendStart("month",now)!;
    for(let i=0;i<new Date(now.getFullYear(),now.getMonth()+1,0).getDate();i++)make(new Date(d.getFullYear(),d.getMonth(),i+1),new Date(d.getFullYear(),d.getMonth(),i+2),String(i+1));
  }else if(period==="year"){
    for(let i=0;i<12;i++)make(new Date(now.getFullYear(),i,1),new Date(now.getFullYear(),i+1,1),`${i+1}${text.month}`);
  }else{
    const first=Math.min(now.getFullYear(),...flights.map(f=>new Date(f.completedAt).getFullYear()));
    for(let y=first;y<=now.getFullYear();y++)make(new Date(y,0,1),new Date(y+1,0,1),String(y));
  }
  for(const f of flights){const b=buckets.find(b=>f.completedAt>=b.start&&f.completedAt<b.end);if(b)b.minutes+=f.durationSeconds/60;}
  return buckets;
}
export const formatMinutes=(minutes:number)=>{
  const n=Math.max(0,Math.round(minutes));
  return n>=60?`${Math.floor(n/60)} ${text.hours} ${n%60} ${text.minutes}`:`${n} ${text.minutes}`;
};
export const formatDistance=(km:number)=>`${Math.round(km).toLocaleString("zh-CN")} km`;
export function homeGreeting(now:Date){
  const h=now.getHours();return h<5?text.night:h<11?text.morning:h<13?text.noon:h<18?text.afternoon:text.evening;
}
export function activeSummary(f:ActiveFlight|null,now:number){
  if(!f)return null;
  const clock=f.pausedAt??now;
  return {route:`${f.originIata} \u2192 ${f.destinationIata}`,task:f.task,
    remainingSeconds:Math.max(0,Math.ceil((f.endsAt-clock)/1000)),
    remainingKm:f.distanceKm*(1-progress(f,now)),paused:f.pausedAt!==null};
}

// Local calendar dates, not elapsed 24-hour periods, define a completed flying day.
export const flightDay = (time:number) => {const d=new Date(time);return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;};
export function flyingCalendar(flights:readonly CompletedFlight[], now:Date) {
  const days=new Set(flights.filter(f=>f.completedAt<=now.getTime()).map(f=>flightDay(f.completedAt)));
  const today=days.has(flightDay(now.getTime()));
  const cursor=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if(!today)cursor.setDate(cursor.getDate()-1);
  let streak=0;
  while(days.has(flightDay(cursor.getTime()))){streak++;cursor.setDate(cursor.getDate()-1);}
  const calendar=Array.from({length:14},(_,i)=>{const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-13+i);return {label:`${d.getMonth()+1}/${d.getDate()}`,flown:days.has(flightDay(d.getTime())),today:i===13};});
  return {today,streak,calendar};
}
export function sceneTotals(flights:readonly CompletedFlight[]) {
  const groups=new Map<string,number>();
  for(const f of flights)groups.set(f.task,(groups.get(f.task)||0)+f.durationSeconds/60);
  return [...groups].map(([task,minutes])=>({task,minutes})).sort((a,b)=>b.minutes-a.minutes||a.task.localeCompare(b.task));
}
export function weekdayAverages(flights:readonly CompletedFlight[]) {
  return Array.from({length:7},(_,i)=>{
    const matching=flights.filter(f=>(new Date(f.completedAt).getDay()+6)%7===i);
    const days=new Set(matching.map(f=>flightDay(f.completedAt))).size;
    return {label:text.weekday[i],minutes:days?matching.reduce((s,f)=>s+f.durationSeconds/60,0)/days:0};
  });
}
