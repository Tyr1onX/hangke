import data from "./data/airports.json";
import { distance, type Coordinate } from "./geo.ts";

export interface Airport {
  ident: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
}

export interface ReachableAirport {
  airport: Airport;
  distanceKm: number;
}

type AirportLocale = {
  city: string;
  name: string;
};

// Keep canonical airport data untouched. This small local display layer covers the
// airports most likely to appear around the current China/Japan/Korea routes; the
// generic fallback below still guarantees a truthful Chinese cue for every airport.
const localizedAirports: Record<string, AirportLocale> = {
  PEK: { city: "\u5317\u4eac", name: "\u5317\u4eac\u9996\u90fd\u56fd\u9645\u673a\u573a" },
  PKX: { city: "\u5317\u4eac", name: "\u5317\u4eac\u5927\u5174\u56fd\u9645\u673a\u573a" },
  PVG: { city: "\u4e0a\u6d77", name: "\u4e0a\u6d77\u6d66\u4e1c\u56fd\u9645\u673a\u573a" },
  SHA: { city: "\u4e0a\u6d77", name: "\u4e0a\u6d77\u8679\u6865\u56fd\u9645\u673a\u573a" },
  CAN: { city: "\u5e7f\u5dde", name: "\u5e7f\u5dde\u767d\u4e91\u56fd\u9645\u673a\u573a" },
  SZX: { city: "\u6df1\u5733", name: "\u6df1\u5733\u5b9d\u5b89\u56fd\u9645\u673a\u573a" },
  CTU: { city: "\u6210\u90fd", name: "\u6210\u90fd\u53cc\u6d41\u56fd\u9645\u673a\u573a" },
  TFU: { city: "\u6210\u90fd", name: "\u6210\u90fd\u5929\u5e9c\u56fd\u9645\u673a\u573a" },
  CKG: { city: "\u91cd\u5e86", name: "\u91cd\u5e86\u6c5f\u5317\u56fd\u9645\u673a\u573a" },
  XIY: { city: "\u897f\u5b89", name: "\u897f\u5b89\u54b8\u9633\u56fd\u9645\u673a\u573a" },
  HGH: { city: "\u676d\u5dde", name: "\u676d\u5dde\u8427\u5c71\u56fd\u9645\u673a\u573a" },
  NKG: { city: "\u5357\u4eac", name: "\u5357\u4eac\u7984\u53e3\u56fd\u9645\u673a\u573a" },
  WUH: { city: "\u6b66\u6c49", name: "\u6b66\u6c49\u5929\u6cb3\u56fd\u9645\u673a\u573a" },
  CSX: { city: "\u957f\u6c99", name: "\u957f\u6c99\u9ec4\u82b1\u56fd\u9645\u673a\u573a" },
  KMG: { city: "\u6606\u660e", name: "\u6606\u660e\u957f\u6c34\u56fd\u9645\u673a\u573a" },
  XMN: { city: "\u53a6\u95e8", name: "\u53a6\u95e8\u9ad8\u5d0e\u56fd\u9645\u673a\u573a" },
  FOC: { city: "\u798f\u5dde", name: "\u798f\u5dde\u957f\u4e50\u56fd\u9645\u673a\u573a" },
  TAO: { city: "\u9752\u5c9b", name: "\u9752\u5c9b\u80f6\u4e1c\u56fd\u9645\u673a\u573a" },
  TSN: { city: "\u5929\u6d25", name: "\u5929\u6d25\u6ee8\u6d77\u56fd\u9645\u673a\u573a" },
  CGQ: { city: "\u957f\u6625", name: "\u957f\u6625\u9f99\u5609\u56fd\u9645\u673a\u573a" },
  SHE: { city: "\u6c88\u9633", name: "\u6c88\u9633\u6843\u4ed9\u56fd\u9645\u673a\u573a" },
  DLC: { city: "\u5927\u8fde", name: "\u5927\u8fde\u5468\u6c34\u5b50\u56fd\u9645\u673a\u573a" },
  HRB: { city: "\u54c8\u5c14\u6ee8", name: "\u54c8\u5c14\u6ee8\u592a\u5e73\u56fd\u9645\u673a\u573a" },
  SJW: { city: "\u77f3\u5bb6\u5e84", name: "\u77f3\u5bb6\u5e84\u6b63\u5b9a\u56fd\u9645\u673a\u573a" },
  TNA: { city: "\u6d4e\u5357", name: "\u6d4e\u5357\u9065\u5899\u56fd\u9645\u673a\u573a" },
  KWE: { city: "\u8d35\u9633", name: "\u8d35\u9633\u9f99\u6d1e\u5821\u56fd\u9645\u673a\u573a" },
  NNG: { city: "\u5357\u5b81", name: "\u5357\u5b81\u5434\u5729\u56fd\u9645\u673a\u573a" },
  HAK: { city: "\u6d77\u53e3", name: "\u6d77\u53e3\u7f8e\u5170\u56fd\u9645\u673a\u573a" },
  SYX: { city: "\u4e09\u4e9a", name: "\u4e09\u4e9a\u51e4\u51f0\u56fd\u9645\u673a\u573a" },
  URC: { city: "\u4e4c\u9c81\u6728\u9f50", name: "\u4e4c\u9c81\u6728\u9f50\u5730\u7a9d\u5821\u56fd\u9645\u673a\u573a" },
  HKG: { city: "\u9999\u6e2f", name: "\u9999\u6e2f\u56fd\u9645\u673a\u573a" },
  MFM: { city: "\u6fb3\u95e8", name: "\u6fb3\u95e8\u56fd\u9645\u673a\u573a" },
  TPE: { city: "\u53f0\u5317", name: "\u53f0\u6e7e\u6843\u56ed\u56fd\u9645\u673a\u573a" },
  TSA: { city: "\u53f0\u5317", name: "\u53f0\u5317\u677e\u5c71\u673a\u573a" },
  KHH: { city: "\u9ad8\u96c4", name: "\u9ad8\u96c4\u56fd\u9645\u673a\u573a" },
  MDG: { city: "\u7261\u4e39\u6c5f", name: "\u7261\u4e39\u6c5f\u6d77\u6d6a\u56fd\u9645\u673a\u573a" },
  DQA: { city: "\u5927\u5e86", name: "\u5927\u5e86\u8428\u5c14\u56fe\u673a\u573a" },
  YNJ: { city: "\u5ef6\u5409", name: "\u5ef6\u5409\u671d\u9633\u5ddd\u56fd\u9645\u673a\u573a" },
  TGO: { city: "\u901a\u8fbd", name: "\u901a\u8fbd\u673a\u573a" },
  DBC: { city: "\u767d\u57ce", name: "\u767d\u57ce\u957f\u5b89\u673a\u573a" },
  NBS: { city: "\u767d\u5c71", name: "\u957f\u767d\u5c71\u673a\u573a" },
  HLH: { city: "\u4e4c\u5170\u6d69\u7279", name: "\u4e4c\u5170\u6d69\u7279\u4e49\u52d2\u529b\u7279\u673a\u573a" },
  HLD: { city: "\u547c\u4f26\u8d1d\u5c14", name: "\u547c\u4f26\u8d1d\u5c14\u6d77\u62c9\u5c14\u673a\u573a" },
  BPE: { city: "\u79e6\u7687\u5c9b", name: "\u79e6\u7687\u5c9b\u5317\u6234\u6cb3\u673a\u573a" },
  XIL: { city: "\u9521\u6797\u6d69\u7279", name: "\u9521\u6797\u6d69\u7279\u673a\u573a" },
  JGD: { city: "\u52a0\u683c\u8fbe\u5947", name: "\u5927\u5174\u5b89\u5cad\u9102\u4f26\u6625\u673a\u573a" },
  FUG: { city: "\u961c\u9633", name: "\u961c\u9633\u897f\u5173\u673a\u573a" },
  RLK: { city: "\u5df4\u5f66\u6dd6\u5c14", name: "\u5df4\u5f66\u6dd6\u5c14\u5929\u5409\u6cf0\u673a\u573a" },
  UYN: { city: "\u6986\u6797", name: "\u6986\u6797\u6986\u9633\u673a\u573a" },
  JMU: { city: "\u4f73\u6728\u65af", name: "\u4f73\u6728\u65af\u4e1c\u90ca\u673a\u573a" },
  FYJ: { city: "\u629a\u8fdc", name: "\u629a\u8fdc\u4e1c\u6781\u673a\u573a" },
  DDG: { city: "\u4e39\u4e1c", name: "\u4e39\u4e1c\u6d6a\u5934\u56fd\u9645\u673a\u573a" },
  JSJ: { city: "\u5efa\u4e09\u6c5f", name: "\u5efa\u4e09\u6c5f\u6e7f\u5730\u673a\u573a" },

  HND: { city: "\u4e1c\u4eac", name: "\u4e1c\u4eac\u7fbd\u7530\u56fd\u9645\u673a\u573a" },
  NRT: { city: "\u4e1c\u4eac", name: "\u6210\u7530\u56fd\u9645\u673a\u573a" },
  KIX: { city: "\u5927\u962a", name: "\u5173\u897f\u56fd\u9645\u673a\u573a" },
  ITM: { city: "\u5927\u962a", name: "\u5927\u962a\u56fd\u9645\u673a\u573a" },
  NGO: { city: "\u540d\u53e4\u5c4b", name: "\u4e2d\u90e8\u56fd\u9645\u673a\u573a" },
  FUK: { city: "\u798f\u5188", name: "\u798f\u5188\u673a\u573a" },
  CTS: { city: "\u672d\u5e4c", name: "\u65b0\u5343\u5c81\u673a\u573a" },
  OKD: { city: "\u672d\u5e4c", name: "\u4e18\u73e0\u673a\u573a" },
  OIM: { city: "\u4f0a\u8c46\u5927\u5c9b", name: "\u5927\u5c9b\u673a\u573a" },
  UBE: { city: "\u5b87\u90e8", name: "\u5c71\u53e3\u5b87\u90e8\u673a\u573a" },
  SHM: { city: "\u767d\u6ee8", name: "\u5357\u7eaa\u767d\u6ee8\u673a\u573a" },
  TJH: { city: "\u4e30\u5188", name: "\u4f46\u9a6c\u673a\u573a" },
  TNE: { city: "\u79cd\u5b50\u5c9b", name: "\u65b0\u79cd\u5b50\u5c9b\u673a\u573a" },
  TTJ: { city: "\u9e1f\u53d6", name: "\u9e1f\u53d6\u673a\u573a" },
  IZO: { city: "\u51fa\u4e91", name: "\u51fa\u4e91\u673a\u573a" },
  YGJ: { city: "\u7c73\u5b50", name: "\u7c73\u5b50\u673a\u573a" },
  MMJ: { city: "\u677e\u672c", name: "\u4fe1\u5dde\u677e\u672c\u673a\u573a" },
  SYO: { city: "\u5e84\u5185", name: "\u5e84\u5185\u673a\u573a" },
  ONJ: { city: "\u5927\u9986", name: "\u5927\u9986\u80fd\u4ee3\u673a\u573a" },
  KKJ: { city: "\u5317\u4e5d\u5dde", name: "\u5317\u4e5d\u5dde\u673a\u573a" },
  OIT: { city: "\u5927\u5206", name: "\u5927\u5206\u673a\u573a" },
  HKD: { city: "\u51fd\u9986", name: "\u51fd\u9986\u673a\u573a" },
  KMI: { city: "\u5bab\u5d0e", name: "\u5bab\u5d0e\u673a\u573a" },
  IWJ: { city: "\u76ca\u7530", name: "\u77f3\u89c1\u673a\u573a" },
  OIR: { city: "\u5965\u5c3b", name: "\u5965\u5c3b\u673a\u573a" },
  KMJ: { city: "\u718a\u672c", name: "\u718a\u672c\u673a\u573a" },
  KOJ: { city: "\u9e7f\u513f\u5c9b", name: "\u9e7f\u513f\u5c9b\u673a\u573a" },
  HIJ: { city: "\u5e7f\u5c9b", name: "\u5e7f\u5c9b\u673a\u573a" },
  MYJ: { city: "\u677e\u5c71", name: "\u677e\u5c71\u673a\u573a" },
  TAK: { city: "\u9ad8\u677e", name: "\u9ad8\u677e\u673a\u573a" },
  KCZ: { city: "\u9ad8\u77e5", name: "\u9ad8\u77e5\u9f99\u9a6c\u673a\u573a" },
  TKS: { city: "\u5fb7\u5c9b", name: "\u5fb7\u5c9b\u963f\u6ce2\u821e\u673a\u573a" },
  OKJ: { city: "\u5188\u5c71", name: "\u5188\u5c71\u6843\u592a\u90ce\u673a\u573a" },
  KIJ: { city: "\u65b0\u6f5f", name: "\u65b0\u6f5f\u673a\u573a" },
  SDJ: { city: "\u4ed9\u53f0", name: "\u4ed9\u53f0\u673a\u573a" },
  AXT: { city: "\u79cb\u7530", name: "\u79cb\u7530\u673a\u573a" },
  AOJ: { city: "\u9752\u68ee", name: "\u9752\u68ee\u673a\u573a" },
  HNA: { city: "\u82b1\u5377", name: "\u82b1\u5377\u673a\u573a" },
  GAJ: { city: "\u5c71\u5f62", name: "\u5c71\u5f62\u673a\u573a" },
  FKS: { city: "\u798f\u5c9b", name: "\u798f\u5c9b\u673a\u573a" },
  TOY: { city: "\u5bcc\u5c71", name: "\u5bcc\u5c71\u673a\u573a" },
  KMQ: { city: "\u5c0f\u677e", name: "\u5c0f\u677e\u673a\u573a" },
  FSZ: { city: "\u9759\u5188", name: "\u9759\u5188\u673a\u573a" },
  IBR: { city: "\u8328\u57ce", name: "\u8328\u57ce\u673a\u573a" },
  NGS: { city: "\u957f\u5d0e", name: "\u957f\u5d0e\u673a\u573a" },
  HSG: { city: "\u4f50\u8d3a", name: "\u4f50\u8d3a\u673a\u573a" },
  OKA: { city: "\u51b2\u7ef3", name: "\u90a3\u9738\u673a\u573a" },
  ISG: { city: "\u77f3\u57a3", name: "\u65b0\u77f3\u57a3\u673a\u573a" },
  MMY: { city: "\u5bab\u53e4\u5c9b", name: "\u5bab\u53e4\u673a\u573a" },
  ASJ: { city: "\u5944\u7f8e", name: "\u5944\u7f8e\u673a\u573a" },
  KUM: { city: "\u5c4b\u4e45\u5c9b", name: "\u5c4b\u4e45\u5c9b\u673a\u573a" },
  UBJ: { city: "\u5b87\u90e8", name: "\u5c71\u53e3\u5b87\u90e8\u673a\u573a" },
  NKM: { city: "\u540d\u53e4\u5c4b", name: "\u540d\u53e4\u5c4b\u98de\u884c\u573a" },
  NTQ: { city: "\u80fd\u767b", name: "\u80fd\u767b\u91cc\u5c71\u673a\u573a" },
  SDS: { city: "\u4f50\u6e21", name: "\u4f50\u6e21\u673a\u573a" },
  HAC: { city: "\u516b\u4e08\u5c9b", name: "\u516b\u4e08\u5c9b\u673a\u573a" },
  IWK: { city: "\u5ca9\u56fd", name: "\u5ca9\u56fd\u9526\u5e26\u6865\u673a\u573a" },
  KUH: { city: "\u948f\u8def", name: "\u948f\u8def\u673a\u573a" },
  UKB: { city: "\u795e\u6237", name: "\u795e\u6237\u673a\u573a" },
  UEO: { city: "\u4e45\u7c73\u5c9b", name: "\u4e45\u7c73\u5c9b\u673a\u573a" },
  AGJ: { city: "\u7c9f\u56fd", name: "\u7c9f\u56fd\u673a\u573a" },

  ICN: { city: "\u9996\u5c14", name: "\u4ec1\u5ddd\u56fd\u9645\u673a\u573a" },
  GMP: { city: "\u9996\u5c14", name: "\u91d1\u6d66\u56fd\u9645\u673a\u573a" },
  PUS: { city: "\u91dc\u5c71", name: "\u91d1\u6d77\u56fd\u9645\u673a\u573a" },
  CJU: { city: "\u6d4e\u5dde", name: "\u6d4e\u5dde\u56fd\u9645\u673a\u573a" },
  TAE: { city: "\u5927\u90b1", name: "\u5927\u90b1\u56fd\u9645\u673a\u573a" },
  CJJ: { city: "\u6e05\u5dde", name: "\u6e05\u5dde\u56fd\u9645\u673a\u573a" },
  WJU: { city: "\u539f\u5dde", name: "\u539f\u5dde\u673a\u573a" },
  YNY: { city: "\u8944\u9633", name: "\u8944\u9633\u56fd\u9645\u673a\u573a" },
  KUV: { city: "\u7fa4\u5c71", name: "\u7fa4\u5c71\u673a\u573a" },
  MWX: { city: "\u52a1\u5b89", name: "\u52a1\u5b89\u56fd\u9645\u673a\u573a" },

  SIN: { city: "\u65b0\u52a0\u5761", name: "\u65b0\u52a0\u5761\u6a1f\u5b9c\u56fd\u9645\u673a\u573a" },
  BKK: { city: "\u66fc\u8c37", name: "\u7d20\u4e07\u90a3\u666e\u56fd\u9645\u673a\u573a" },
  KUL: { city: "\u5409\u9686\u5761", name: "\u5409\u9686\u5761\u56fd\u9645\u673a\u573a" },
  MNL: { city: "\u9a6c\u5c3c\u62c9", name: "\u5c3c\u8bfa\u4f0a\u00b7\u963f\u57fa\u8bfa\u56fd\u9645\u673a\u573a" },
  DEL: { city: "\u65b0\u5fb7\u91cc", name: "\u82f1\u8fea\u62c9\u00b7\u7518\u5730\u56fd\u9645\u673a\u573a" },
  DXB: { city: "\u8fea\u62dc", name: "\u8fea\u62dc\u56fd\u9645\u673a\u573a" },
  LHR: { city: "\u4f26\u6566", name: "\u4f26\u6566\u5e0c\u601d\u7f57\u673a\u573a" },
  CDG: { city: "\u5df4\u9ece", name: "\u5df4\u9ece\u6234\u9ad8\u4e50\u673a\u573a" },
  FRA: { city: "\u6cd5\u5170\u514b\u798f", name: "\u6cd5\u5170\u514b\u798f\u673a\u573a" },
  JFK: { city: "\u7ebd\u7ea6", name: "\u7ea6\u7ff0\u00b7F\u00b7\u80af\u5c3c\u8fea\u56fd\u9645\u673a\u573a" },
  LAX: { city: "\u6d1b\u6749\u77f6", name: "\u6d1b\u6749\u77f6\u56fd\u9645\u673a\u573a" },
  SFO: { city: "\u65e7\u91d1\u5c71", name: "\u65e7\u91d1\u5c71\u56fd\u9645\u673a\u573a" },
  BQS: { city: "\u5e03\u62c9\u6208\u7ef4\u7533\u65af\u514b", name: "\u4f0a\u683c\u7eb3\u8482\u8036\u6c83\u673a\u573a" },
  KHV: { city: "\u54c8\u5df4\u7f57\u592b\u65af\u514b", name: "\u54c8\u5df4\u7f57\u592b\u65af\u514b\u65b0\u673a\u573a" },
  EKS: { city: "\u6c99\u8d6b\u4e54\u5c14\u65af\u514b", name: "\u6c99\u8d6b\u4e54\u5c14\u65af\u514b\u673a\u573a" },
  NLI: { city: "\u963f\u7a46\u5c14\u6cb3\u7554\u5c3c\u53e4\u62c9\u8036\u592b\u65af\u514b", name: "\u5c3c\u53e4\u62c9\u8036\u592b\u65af\u514b\u673a\u573a" },
  UBN: { city: "\u4e4c\u5170\u5df4\u6258", name: "\u6210\u5409\u601d\u6c57\u56fd\u9645\u673a\u573a" },
};

const regionNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });
const countryLabel = (country: string) => regionNames.of(country) || country;

export const airports: Airport[] = data;
export const airport = (iata: string | null) =>
  airports.find((a) => a.iata === iata);
export const coordinates = (a: Airport): Coordinate => [
  a.longitude,
  a.latitude,
];

export const focusDistanceKm = (durationMinutes: number) => durationMinutes * 12.5;

export const airportCityLabel = (a: Airport) =>
  localizedAirports[a.iata]?.city ||
  `${countryLabel(a.country)} \u00b7 ${a.city.trim() || a.name.trim()}`;

// Planning surfaces stay compact even when the local Chinese display table does
// not yet contain an airport. Never combine a translated country with a long
// English airport name in the carousel or boarding pass.
export const airportPlanningLabel = (a: Airport) =>
  localizedAirports[a.iata]?.city ||
  (a.city.trim() || a.name.trim())
    .split(/[(/,]/, 1)[0]
    .trim() ||
  a.iata;

export const airportNameLabel = (a: Airport) => {
  const localized = localizedAirports[a.iata]?.name;
  if (localized) return localized;
  const original = a.name.trim();
  const compact = original
    .split(" / ")[0]
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .trim();
  const localizedSuffix = compact
    .replace(/International Airport$/i, "\u56fd\u9645\u673a\u573a")
    .replace(/Regional Airport$/i, "\u5730\u533a\u673a\u573a")
    .replace(/Municipal Airport$/i, "\u5e02\u7acb\u673a\u573a")
    .replace(/Airport$/i, "\u673a\u573a")
    .replace(/Airfield$/i, "\u673a\u573a");
  if (localizedSuffix.length <= 28) return localizedSuffix;
  return `${a.city.trim() || a.iata} \u673a\u573a`;
};

export const airportCompactLabel = (a: Airport) => {
  const localized = localizedAirports[a.iata];
  if (!localized) return airportCityLabel(a);
  if (localized.name === `${localized.city}\u673a\u573a`) return localized.name;
  if (localized.name.startsWith(localized.city))
    return `${localized.city} \u00b7 ${localized.name.slice(localized.city.length)}`;
  return `${localized.city} \u00b7 ${localized.name}`;
};

export const airportSecondaryLabel = (a: Airport) =>
  localizedAirports[a.iata]
    ? `${a.city.trim() || a.name.trim()} \u00b7 ${a.name.trim()}`
    : `${a.city.trim() || a.name.trim()} \u00b7 ${a.country}`;

export function reachable(
  origin: Airport,
  durationMinutes: number,
): ReachableAirport[] {
  const targetDistanceKm = focusDistanceKm(durationMinutes);
  const toleranceKm = Math.max(200, targetDistanceKm * 0.3);
  return airports
    .filter((a) => a.iata !== origin.iata)
    .map((a) => ({
      airport: a,
      distanceKm: distance(coordinates(origin), coordinates(a)),
    }))
    .filter(
      ({ distanceKm }) =>
        Math.abs(distanceKm - targetDistanceKm) <= toleranceKm,
    )
    .sort(
      (a, b) =>
        Math.abs(a.distanceKm - targetDistanceKm) -
          Math.abs(b.distanceKm - targetDistanceKm) ||
        a.airport.iata.localeCompare(b.airport.iata),
    )
    .slice(0, 6);
}

export function search(query: string): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (a: Airport) =>
    a.iata.toLowerCase() === q
      ? 0
      : a.ident.toLowerCase() === q
        ? 1
        : a.iata.toLowerCase().startsWith(q)
          ? 2
          : 3;
  return airports
    .filter((a) =>
      [
        a.iata,
        a.ident,
        a.city,
        a.name,
        airportCityLabel(a),
        airportNameLabel(a),
        airportSecondaryLabel(a),
      ].some((value) => value.toLowerCase().includes(q)),
    )
    .sort((a, b) => score(a) - score(b) || a.iata.localeCompare(b.iata))
    .slice(0, 8);
}
