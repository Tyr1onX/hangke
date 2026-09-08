import test from "node:test";
import assert from "node:assert/strict";
import { flightTotals, trendStart, trendFlights, trendBuckets, homeGreeting, activeSummary, flyingCalendar, sceneTotals, weekdayAverages } from "../src/home.ts";
import type { CompletedFlight, ActiveFlight } from "../src/state.ts";
const now=new Date(2026,8,7,12,0,0);
const stamp=(day:number,hour=10)=>new Date(2026,8,day,hour).getTime();
const record=(id:string,completedAt:number,minutes:number):CompletedFlight=>({id,originIata:"CGQ",destinationIata:"HND",task:"code",durationSeconds:minutes*60,startedAt:completedAt-minutes*60000,completedAt,distanceKm:500});
const flights=[record("a",stamp(7),30),record("b",stamp(6),60),record("c",stamp(1),90)];
test("home totals use completed records and unique endpoints",()=>{
 assert.deepEqual(flightTotals(flights),{flights:3,minutes:180,distanceKm:1500,airports:2});
});
test("calendar filters use local period boundaries",()=>{
 assert.equal(trendStart("week",now)?.getDay(),1);
 assert.equal(trendFlights(flights,"day",now).length,1);
 assert.equal(trendFlights(flights,"week",now).length,1);
 assert.equal(trendFlights(flights,"month",now).length,3);
});
test("trend buckets preserve minutes without inventing empty data",()=>{
 assert.equal(trendBuckets(flights,"day",now).reduce((s,b)=>s+b.minutes,0),30);
 assert.equal(trendBuckets(flights,"month",now).reduce((s,b)=>s+b.minutes,0),180);
 assert.equal(trendBuckets([],"week",now).every(b=>b.minutes===0),true);
});
test("greeting follows local hour",()=>{
 assert.notEqual(homeGreeting(new Date(2026,8,7,8)),homeGreeting(new Date(2026,8,7,20)));
});
test("active summary freezes on pause and never creates a flight",()=>{
 const start=stamp(7);const f:ActiveFlight={id:"active",originIata:"CGQ",destinationIata:"HND",task:"code",durationSeconds:3600,startedAt:start,endsAt:start+3600000,distanceKm:500,pausedAt:start+600000};
 const first=activeSummary(f,start+700000),later=activeSummary(f,start+900000);
 assert.equal(first?.remainingSeconds,later?.remainingSeconds);
 assert.equal(first?.remainingKm,later?.remainingKm);
 assert.equal(activeSummary(null,start),null);
});

test("flying calendar uses unique local completed days and allows today to remain open",()=>{
 const f=[record("1",stamp(6),30),record("2",stamp(6,12),60),record("3",stamp(5),45)];
 assert.equal(flyingCalendar(f,now).streak,2);
 assert.equal(flyingCalendar(f,now).today,false);
 assert.equal(flyingCalendar([...f,record("4",stamp(7),30)],now).streak,3);
 assert.equal(flyingCalendar([record("old",stamp(5),30)],now).streak,0);
 assert.equal(flyingCalendar([],now).calendar.filter(d=>d.flown).length,0);
 assert.equal(flyingCalendar([record("future",stamp(8),30)],now).streak,0);
});
test("scene totals and weekday averages preserve minutes without counting empty dates",()=>{
 const f=[{...record("1",stamp(7),30),task:"学习"},{...record("2",stamp(7,11),60),task:"写作"}, {...record("3",stamp(14),30),task:"学习"}];
 assert.deepEqual(sceneTotals(f),[{task:"学习",minutes:60},{task:"写作",minutes:60}].sort((a,b)=>a.task.localeCompare(b.task)));
 assert.equal(weekdayAverages(f)[0].minutes,60);
 assert.equal(weekdayAverages(f)[1].minutes,0);
 assert.deepEqual(sceneTotals([]),[]);
});
