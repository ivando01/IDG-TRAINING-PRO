"use client";

import TopNav from "@/components/TopNav";
import { AppIcon } from "@/components/Brand";
import { getCloudCollection, getCloudProfile } from "@/lib/cloud-sync";
import {
  ActivityAnalysis,
  ActivityPoint,
  createActivityFromPoints,
  formatDuration,
  getStoredZones,
  normalizeCadenceValue,
  parseActivityFile,
  SportType,
  storageKeyForSport,
  ZoneTimelineSegment,
} from "@/lib/activity-analysis";
import maplibregl, { Map } from "maplibre-gl";
import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";

const layerLabels = {
  standard: "Standard",
  terrain: "Terrain",
  satellite: "Satellite",
  dark: "Dark",
};

type LayerKey = keyof typeof layerLabels;

type Props = {
  sport: SportType;
};

const PROFILE_KEY = "idg_profile_json";
const LEGACY_PROFILE_KEY = "iv_profile";

type StravaStream = { data?: unknown[] };

type StravaSyncedActivity = {
  summary: {
    id: number | string;
    name?: string;
    sport_type?: string;
    type?: string;
    start_date?: string;
    start_date_local?: string;
    moving_time?: number;
    elapsed_time?: number;
    distance?: number;
    total_elevation_gain?: number;
    average_heartrate?: number;
    max_heartrate?: number;
    average_cadence?: number;
    average_watts?: number;
    weighted_average_watts?: number;
    kilojoules?: number;
    calories?: number;
  };
  streams?: Record<string, StravaStream> | null;
};

type BikeProfile = {
  id: string;
  name?: string;
  brand?: string;
  model?: string;
  type?: "road" | "mtb";
  isPrimary?: boolean;
};

type ChartOption = {
  key: string;
  label: string;
  color: string;
  unit: string;
  values: Array<number | null | undefined>;
  minRange?: number;
};

function sportCopy(sport: SportType) {
  return sport === "cycling"
    ? { title: "Analisis de Actividad", subtitle: "Ciclismo", accent: "#1D4ED8", icon: "bike" }
    : { title: "Analisis de Actividad", subtitle: "Running", accent: "#16A34A", icon: "run" };
}

function tileStyle(layer: LayerKey) {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key) {
    const maptilerStyle = layer === "terrain" ? "outdoor-v2" : layer === "satellite" ? "satellite" : layer === "dark" ? "dataviz-dark" : "streets-v2";
    return `https://api.maptiler.com/maps/${maptilerStyle}/style.json?key=${key}`;
  }
  if (layer === "satellite") {
    return {
      version: 8,
      sources: {
        satellite: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
        },
      },
      layers: [{ id: "satellite", type: "raster", source: "satellite" }],
    } as maplibregl.StyleSpecification;
  }
  const tiles =
    layer === "dark"
      ? ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"]
      : layer === "terrain"
        ? ["https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"]
        : ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png", "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png"];
  return {
    version: 8,
    sources: { osm: { type: "raster", tiles, tileSize: 256, attribution: "OpenStreetMap" } },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  } as maplibregl.StyleSpecification;
}

function metric(value: number | string | null | undefined, unit = "") {
  if (value === null || value === undefined || value === "") return "--";
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function clampIndex(index: number, length: number) {
  return Math.max(0, Math.min(Math.max(0, length - 1), index));
}

function pointTimeLabel(point: ActivityPoint | undefined, activity: ActivityAnalysis) {
  if (!point?.time) return "--";
  const start = activity.points.find((item) => item.time)?.time || point.time;
  return formatDuration(Math.max(0, Math.round((point.time - start) / 1000)));
}

function pointMetricCards(activity: ActivityAnalysis, point: ActivityPoint | undefined) {
  const pace = point?.speedKmh && point.speedKmh > 0.5 ? `${(60 / point.speedKmh).toFixed(2)} min/km` : "--";
  return [
    ["Km", point ? point.distanceKm.toFixed(2) : "--"],
    ["Tiempo", pointTimeLabel(point, activity)],
    ["FC", point?.hr ? `${point.hr} bpm` : "--"],
    [activity.sport === "cycling" ? "Velocidad" : "Ritmo", activity.sport === "cycling" ? (point?.speedKmh ? `${point.speedKmh} km/h` : "--") : pace],
    ["Elevacion", point?.ele ? `${Math.round(point.ele)} m` : "--"],
    ["Cadencia", point?.cad ? `${point.cad} ${activity.sport === "cycling" ? "rpm" : "ppm"}` : "--"],
    ...(activity.sport === "cycling" ? [["Potencia", point?.power ? `${point.power} W` : "--"]] : []),
  ];
}

function displayCadence(activity: ActivityAnalysis) {
  const cadence = activity.metrics.avgCadence;
  if (!cadence) return null;
  return cadence;
}

function heartRateCoverage(activity: ActivityAnalysis) {
  if (!activity.points.length) return 0;
  const valid = activity.points.filter((point) => Number.isFinite(point.hr) && Number(point.hr) >= 40).length;
  return valid / activity.points.length;
}

function hasReliableHeartRate(activity: ActivityAnalysis) {
  const zoneSeconds = activity.zoneTotals
    .filter((zone) => zone.zoneKey !== "NA")
    .reduce((sum, zone) => sum + zone.seconds, 0);
  return heartRateCoverage(activity) >= 0.02 || zoneSeconds > 0 || Boolean(activity.metrics.avgHr || activity.metrics.maxHr);
}

function powerLabel(activity: ActivityAnalysis) {
  if (activity.sport !== "cycling") return "";
  if (activity.metrics.powerSource === "estimated") return "Potencia virtual estimada por IDG";
  if (activity.metrics.powerSource === "real") return activity.source === "FIT" ? "Potencia virtual importada del dispositivo" : "Potencia importada de Strava o dispositivo";
  return "Sin datos suficientes para potencia";
}

function bikeLabel(bike: BikeProfile) {
  const brandModel = `${bike.brand || ""} ${bike.model || ""}`.trim();
  return bike.name || brandModel || (bike.type === "mtb" ? "MTB" : "Bici de ruta");
}

function profileBikesFromStorage(profile?: Record<string, unknown> | null): BikeProfile[] {
  const source = profile || (() => {
    try {
      const raw = localStorage.getItem(PROFILE_KEY) || localStorage.getItem(LEGACY_PROFILE_KEY);
      return raw ? JSON.parse(raw) as Record<string, unknown> : null;
    } catch {
      return null;
    }
  })();
  const bikes = Array.isArray(source?.bikes) ? source.bikes as BikeProfile[] : [];
  if (bikes.length) {
    return bikes.map((bike, index) => ({
      ...bike,
      id: bike.id || `bike-${index + 1}`,
      name: bike.name || `Bici ${index + 1}`,
      isPrimary: index === 0 ? true : Boolean(bike.isPrimary),
    }));
  }
  const fallbackType = source?.bikeType === "mtb" ? "mtb" : "road";
  return [{
    id: "bike-1",
    name: fallbackType === "mtb" ? "MTB principal" : "Ruta principal",
    type: fallbackType,
    isPrimary: true,
  }];
}

function smoothChartValues(values: Array<number | null | undefined>, radius = 4) {
  return values.map((value, index) => {
    if (!Number.isFinite(value)) return null;
    const slice = values
      .slice(Math.max(0, index - radius), Math.min(values.length, index + radius + 1))
      .filter((item): item is number => Number.isFinite(item));
    return slice.length ? Number((slice.reduce((sum, item) => sum + item, 0) / slice.length).toFixed(2)) : Number(value);
  });
}

function apiUrl() {
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
}

async function saveActivityBatchToCloud(sport: SportType, activities: ActivityAnalysis[], token: string) {
  const payload = compactActivitiesForCloud(activities);
  const chunkSize = 4;
  let saved = 0;
  for (let index = 0; index < payload.length; index += chunkSize) {
    const chunk = payload.slice(index, index + chunkSize);
    const response = await fetch(`${apiUrl()}/activities/upsert`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sport, activities: chunk }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "No se pudo guardar el lote de actividades.");
    saved += Number(data.saved || chunk.length || 0);
  }
  return { ok: true, saved };
}

async function deleteActivityFromCloud(id: string, token: string) {
  const response = await fetch(`${apiUrl()}/activities/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "No se pudo eliminar la actividad en nube.");
  return data;
}

function stravaActivityText(summary: StravaSyncedActivity["summary"]) {
  return `${summary.sport_type || ""} ${summary.type || ""} ${summary.name || ""}`.toLowerCase();
}

function isSupportActivityText(text: string) {
  return /walk|hike|caminar|caminata|senderismo/.test(text);
}

function isSupportActivity(activity: Pick<ActivityAnalysis, "activityKind" | "activitySubType" | "countsTowardTraining" | "name">) {
  if (activity.countsTowardTraining === false || activity.activityKind === "support") return true;
  return isSupportActivityText(`${activity.activitySubType || ""} ${activity.name || ""}`.toLowerCase());
}

function keepActivityForSport(activity: ActivityAnalysis, sport: SportType) {
  if (sport !== "running") return true;
  return !isSupportActivityText(`${activity.activitySubType || ""} ${activity.name || ""}`.toLowerCase());
}

function readStream<T>(streams: Record<string, StravaStream> | null | undefined, key: string): T[] {
  const data = streams?.[key]?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const compact = text.replace(/\s+/g, " ").slice(0, 180);
    throw new Error(`El servidor no devolvio JSON. Respuesta recibida: ${compact || response.statusText}`);
  }
}

function stravaToActivity(item: StravaSyncedActivity, sport: SportType) {
  const summary = item.summary;
  const support = sport === "running" && isSupportActivityText(stravaActivityText(summary));
  const activeBike = sport === "cycling"
    ? (() => {
      const bikes = profileBikesFromStorage();
      return bikes.find((bike) => bike.isPrimary) || bikes[0];
    })()
    : undefined;
  const streams = item.streams || {};
  const latlng = readStream<[number, number]>(streams, "latlng");
  const time = readStream<number>(streams, "time");
  const distance = readStream<number>(streams, "distance");
  const altitude = readStream<number>(streams, "altitude");
  const heartrate = readStream<number>(streams, "heartrate");
  const cadence = readStream<number>(streams, "cadence");
  const watts = readStream<number>(streams, "watts");
  const velocity = readStream<number>(streams, "velocity_smooth");
  const grade = readStream<number>(streams, "grade_smooth");
  const temp = readStream<number>(streams, "temp");
  const length = Math.max(latlng.length, time.length, distance.length, altitude.length, heartrate.length, velocity.length);
  const activityDate = summary.start_date_local || summary.start_date || null;
  const start = activityDate ? new Date(activityDate).getTime() : Date.now();
  const points: ActivityPoint[] = [];

  for (let index = 0; index < length; index += 1) {
    const coord = latlng[index];
    const cad = cadence[index];
    points.push({
      lat: Array.isArray(coord) ? Number(coord[0]) : undefined,
      lon: Array.isArray(coord) ? Number(coord[1]) : undefined,
      ele: Number.isFinite(altitude[index]) ? Number(altitude[index]) : null,
      time: Number.isFinite(time[index]) ? start + Number(time[index]) * 1000 : undefined,
      distanceKm: Number.isFinite(distance[index]) ? Number(distance[index]) / 1000 : 0,
      hr: Number.isFinite(heartrate[index])
        ? Math.min(Number(heartrate[index]), Number(summary.max_heartrate) || Number(heartrate[index]))
        : null,
      cad: normalizeCadenceValue(cad, sport, summary.name),
      speedKmh: Number.isFinite(velocity[index]) ? Number((Number(velocity[index]) * 3.6).toFixed(1)) : null,
      power: sport === "cycling" && Number.isFinite(watts[index]) && Number(watts[index]) > 0 ? Number(watts[index]) : null,
      temp: Number.isFinite(temp[index]) ? Number(temp[index]) : null,
      gradePct: Number.isFinite(grade[index]) ? Number(Number(grade[index]).toFixed(1)) : null,
    });
  }

  if (points.length < 2) {
    const duration = summary.moving_time || summary.elapsed_time || 0;
    const distanceKm = summary.distance ? summary.distance / 1000 : 0;
    points.push(
      { distanceKm: 0, time: start, hr: summary.average_heartrate || null, cad: normalizeCadenceValue(summary.average_cadence, sport, summary.name) },
      { distanceKm, time: start + duration * 1000, hr: summary.max_heartrate || summary.average_heartrate || null, cad: normalizeCadenceValue(summary.average_cadence, sport, summary.name) },
    );
  }

  const parsed = createActivityFromPoints({
    id: `strava-${summary.id}`,
    sport,
    activityKind: support ? "support" : "training",
    activitySubType: String(summary.sport_type || summary.type || ""),
    countsTowardTraining: !support,
    source: "STRAVA",
    name: summary.name || (sport === "cycling" ? "Actividad de ciclismo" : support ? "Caminata de soporte" : "Actividad de running"),
    date: activityDate ? activityDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
    startTime: activityDate || undefined,
    bikeId: activeBike?.id,
    bikeLabel: activeBike ? bikeLabel(activeBike) : undefined,
    points,
    zones: getStoredZones(),
    notes: "",
  });

  return {
    ...parsed,
    metrics: {
      ...parsed.metrics,
      calories: summary.calories ? Math.round(summary.calories) : parsed.metrics.calories,
      avgPower: sport === "cycling" && Number(summary.average_watts) > 0 ? Math.round(Number(summary.average_watts)) : parsed.metrics.avgPower,
      normalizedPower: sport === "cycling" && Number(summary.weighted_average_watts) > 0 ? Math.round(Number(summary.weighted_average_watts)) : parsed.metrics.normalizedPower,
    },
  };
}

function compactActivityForStorage(activity: ActivityAnalysis): ActivityAnalysis {
  const maxPoints = activity.sport === "cycling" ? 180 : 220;
  if (activity.points.length <= maxPoints) return activity;
  const step = activity.points.length / maxPoints;
  const points = Array.from({ length: maxPoints }, (_, index) => activity.points[Math.min(activity.points.length - 1, Math.round(index * step))]);
  return { ...activity, points };
}

function sampleArray<T>(items: T[], maxItems: number) {
  if (items.length <= maxItems) return items;
  const step = items.length / maxItems;
  return Array.from({ length: maxItems }, (_, index) => items[Math.min(items.length - 1, Math.round(index * step))]);
}

function compactActivitiesForStorage(items: ActivityAnalysis[]) {
  return items.slice(0, 80).map(compactActivityForStorage);
}

function compactActivitiesForCloud(items: ActivityAnalysis[]) {
  return items.map((activity) => ({
    ...activity,
    points: sampleArray(activity.points, activity.sport === "cycling" ? 120 : 150),
    zoneTimeline: sampleArray(activity.zoneTimeline, 120),
    aiAnalysis: activity.aiAnalysis ? activity.aiAnalysis.slice(0, 1400) : undefined,
  }));
}

function activitySessionTime(activity: ActivityAnalysis) {
  const value = activity.startTime || activity.date;
  const text = String(value || "");
  const timestamp = Date.parse(text.includes("T") ? text : `${text.slice(0, 10)}T00:00:00`);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortActivitiesBySessionDate(items: ActivityAnalysis[]) {
  return [...items].sort((a, b) => activitySessionTime(b) - activitySessionTime(a) || String(b.id).localeCompare(String(a.id)));
}

async function syncCloudProfileToLocal() {
  try {
    const localRaw = localStorage.getItem(PROFILE_KEY) || localStorage.getItem(LEGACY_PROFILE_KEY);
    const localProfile = localRaw ? JSON.parse(localRaw) as Record<string, unknown> : null;
    const cloudProfile = await getCloudProfile<Record<string, unknown>>();
    if (!cloudProfile) return localProfile;
    const selected = cloudProfile;
    if (selected) {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(selected));
      localStorage.setItem(LEGACY_PROFILE_KEY, JSON.stringify(selected));
    }
    return selected;
  } catch {
    return null;
  }
}

function hydrateCloudActivity(activity: ActivityAnalysis) {
  if (!activity.points?.length) return activity;
  return recalculateActivityZones(activity);
}

function activityRichness(activity: ActivityAnalysis) {
  const points = activity.points || [];
  const coordinates = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)).length;
  const heartRate = points.filter((point) => Number.isFinite(point.hr) && Number(point.hr) > 0).length;
  const variableDistance = new Set(points.map((point) => Number(point.distanceKm || 0).toFixed(3))).size;
  return coordinates * 4 + heartRate * 2 + variableDistance + points.length;
}

function mergeCloudActivities(cloudActivities: ActivityAnalysis[], currentActivities: ActivityAnalysis[]) {
  const byId = new globalThis.Map<string, ActivityAnalysis>();
  currentActivities.forEach((activity) => byId.set(activity.id, activity));
  cloudActivities.map(hydrateCloudActivity).forEach((activity) => {
    const current = byId.get(activity.id);
    if (!current || activityRichness(activity) >= activityRichness(current)) {
      byId.set(activity.id, activity);
    }
  });
  return sortActivitiesBySessionDate(Array.from(byId.values()));
}

function ultraCompactActivitiesForStorage(items: ActivityAnalysis[]) {
  return items.slice(0, 35).map((activity) => ({
    ...compactActivityForStorage(activity),
    points: activity.points.length > 80
      ? Array.from({ length: 80 }, (_, index) => activity.points[Math.min(activity.points.length - 1, Math.round(index * (activity.points.length / 80)))])
      : activity.points,
    zoneTimeline: activity.zoneTimeline.slice(0, 60),
    aiAnalysis: activity.aiAnalysis ? activity.aiAnalysis.slice(0, 1200) : undefined,
  }));
}

function safeSetActivities(key: string, items: ActivityAnalysis[]) {
  const attempts = [
    compactActivitiesForStorage(items),
    ultraCompactActivitiesForStorage(items),
    ultraCompactActivitiesForStorage(items).slice(0, 15),
  ];
  for (const attempt of attempts) {
    try {
      localStorage.setItem(key, JSON.stringify(attempt));
      return attempt;
    } catch {
      // Try a smaller local snapshot.
    }
  }
  return [];
}

function recalculateActivityZones(activity: ActivityAnalysis) {
  const normalizedPoints = activity.points.map((point) => ({
    ...point,
    cad: normalizeCadenceValue(point.cad, activity.sport, activity.name),
  }));
  const recalculated = createActivityFromPoints({
    id: activity.id,
    sport: activity.sport,
    activityKind: isSupportActivity(activity) ? "support" : activity.activityKind,
    activitySubType: activity.activitySubType,
    countsTowardTraining: isSupportActivity(activity) ? false : activity.countsTowardTraining,
    source: activity.source,
    name: activity.name,
    date: activity.date,
    startTime: activity.startTime,
    points: normalizedPoints,
    zones: getStoredZones(),
    notes: activity.notes || "",
    aiAnalysis: activity.aiAnalysis,
    aiGeneratedAt: activity.aiGeneratedAt,
    aiAcknowledgedAt: activity.aiAcknowledgedAt,
  });
  return {
    ...recalculated,
    metrics: {
      ...recalculated.metrics,
      calories: activity.metrics?.calories ?? recalculated.metrics.calories,
      avgPower: activity.metrics?.avgPower ?? recalculated.metrics.avgPower,
      normalizedPower: activity.metrics?.normalizedPower ?? recalculated.metrics.normalizedPower,
    },
    activityKind: isSupportActivity(activity) ? "support" : recalculated.activityKind,
    activitySubType: activity.activitySubType || recalculated.activitySubType,
    countsTowardTraining: isSupportActivity(activity) ? false : recalculated.countsTowardTraining,
    notes: activity.notes || recalculated.notes,
    aiAnalysis: activity.aiAnalysis,
    aiGeneratedAt: activity.aiGeneratedAt,
    aiAcknowledgedAt: activity.aiAcknowledgedAt,
  };
}

function ZoneBadge({ segment }: { segment: ZoneTimelineSegment }) {
  return (
    <span className="rounded-full px-2 py-1 text-xs font-black text-white" style={{ backgroundColor: segment.color }}>
      {segment.zoneKey}
    </span>
  );
}

function ActivityMap({
  activity,
  layer,
  heatmap,
  selectedPoint,
  expanded = false,
  showMetricPanel = true,
  onExpand,
}: {
  activity: ActivityAnalysis;
  layer: LayerKey;
  heatmap: boolean;
  selectedPoint?: ActivityPoint;
  expanded?: boolean;
  showMetricPanel?: boolean;
  onExpand?: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const coords = activity.points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
    if (coords.length < 2) return;
    const center: [number, number] = [coords[0].lon!, coords[0].lat!];
    const map = new maplibregl.Map({
      container: ref.current,
      style: tileStyle(layer),
      center,
      zoom: 11,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
    map.on("load", () => drawActivity(map, activity, heatmap));
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [activity, layer, heatmap]);

  useEffect(() => {
    const timer = window.setTimeout(() => mapRef.current?.resize(), 50);
    return () => window.clearTimeout(timer);
  }, [expanded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedPoint || !Number.isFinite(selectedPoint.lat) || !Number.isFinite(selectedPoint.lon)) return;
    const lngLat: [number, number] = [selectedPoint.lon!, selectedPoint.lat!];
    if (!markerRef.current) {
      const element = document.createElement("div");
      element.className = "h-5 w-5 rounded-full border-[3px] border-white bg-blue-600 shadow-[0_0_0_4px_rgba(37,99,235,0.25)]";
      markerRef.current = new maplibregl.Marker({ element }).setLngLat(lngLat).addTo(map);
    } else {
      markerRef.current.setLngLat(lngLat);
    }
  }, [expanded, selectedPoint]);

  const cards = pointMetricCards(activity, selectedPoint);

  return (
    <div className="grid gap-3">
      <div className="relative">
        <div ref={ref} className={`${expanded ? "h-[calc(100vh-190px)] min-h-[430px]" : "h-[340px] min-h-[280px] lg:h-[430px]"} w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100`} />
      </div>
      {showMetricPanel && selectedPoint ? (
        <div className="rounded-lg border border-slate-200 bg-white p-2">
          <div className="grid grid-cols-3 gap-2 text-[11px] md:grid-cols-6">
            {cards.filter(([label]) => hasReliableHeartRate(activity) || label !== "FC").slice(0, 6).map(([label, value]) => (
              <div className="min-w-0 rounded-md bg-slate-50 px-2 py-1.5" key={label}>
                <p className="font-black uppercase text-slate-400">{label}</p>
                <p className="mt-0.5 truncate font-black text-slate-900">{value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function drawActivity(map: Map, activity: ActivityAnalysis, heatmap: boolean) {
  const coords = activity.points.filter((point): point is typeof point & { lat: number; lon: number } => Number.isFinite(point.lat) && Number.isFinite(point.lon));
  if (coords.length < 2) return;
  const bounds = new maplibregl.LngLatBounds();
  coords.forEach((point) => bounds.extend([point.lon!, point.lat!]));

  const segments: Array<{ color: string; coordinates: number[][] }> = [];
  let currentColor = "#1D4ED8";
  let current: number[][] = [];
  for (const point of coords) {
    const zone = activity.zones.find((item) => point.hr && point.hr >= item.min && point.hr <= item.max);
    const color = zone?.color || (point.hr ? activity.zones.at(-1)?.color || "#EF4444" : "#64748B");
    const coord = [point.lon!, point.lat!];
    if (!current.length || color === currentColor) {
      current.push(coord);
      currentColor = color;
    } else {
      if (current.length > 1) segments.push({ color: currentColor, coordinates: current });
      current = [current.at(-1)!, coord];
      currentColor = color;
    }
  }
  if (current.length > 1) segments.push({ color: currentColor, coordinates: current });

  map.addSource("route-segments", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: segments.map((segment) => ({
        type: "Feature",
        properties: { color: segment.color },
        geometry: { type: "LineString", coordinates: segment.coordinates },
      })),
    },
  });
  map.addLayer({
    id: "route-shadow",
    type: "line",
    source: "route-segments",
    paint: { "line-width": 8, "line-color": "rgba(15,23,42,0.18)", "line-blur": 1.5 },
  });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route-segments",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-width": 4, "line-color": ["get", "color"] },
  });

  if (heatmap) {
    map.addSource("hr-heat", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: coords
          .filter((point) => point.hr)
          .map((point) => ({
            type: "Feature",
            properties: { hr: point.hr },
            geometry: { type: "Point", coordinates: [point.lon, point.lat] },
          })),
      },
    });
    map.addLayer({
      id: "hr-heat",
      type: "heatmap",
      source: "hr-heat",
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "hr"], 90, 0.1, 180, 1],
        "heatmap-intensity": 0.8,
        "heatmap-radius": 22,
        "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(34,197,94,0)", 0.35, "#22C55E", 0.65, "#F97316", 1, "#EF4444"],
      },
    });
  }

  new maplibregl.Marker({ color: "#22C55E" }).setLngLat([coords[0].lon!, coords[0].lat!]).addTo(map);
  new maplibregl.Marker({ color: "#EF4444" }).setLngLat([coords.at(-1)!.lon!, coords.at(-1)!.lat!]).addTo(map);
  map.fitBounds(bounds, { padding: 56, duration: 900 });
}

function ActivityMetricChart({
  activity,
  selectedIndex,
  onSelectedIndexChange,
  expanded = false,
  onExpand,
}: {
  activity: ActivityAnalysis;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  expanded?: boolean;
  onExpand?: () => void;
}) {
  const rawOptions: Array<ChartOption | null> = [
    { key: "ele", label: "Elevacion", color: "#22C55E", unit: "m", values: smoothChartValues(activity.points.map((point) => point.ele)), minRange: 20 },
    hasReliableHeartRate(activity) ? { key: "hr", label: "Frecuencia cardiaca", color: "#EF4444", unit: "bpm", values: activity.points.map((point) => point.hr) } : null,
    { key: "pace", label: activity.sport === "cycling" ? "Velocidad" : "Ritmo", color: "#1D4ED8", unit: activity.sport === "cycling" ? "km/h" : "min/km", values: activity.points.map((point) => activity.sport === "cycling" ? point.speedKmh : point.speedKmh && point.speedKmh > 0.5 ? Number((60 / point.speedKmh).toFixed(2)) : null) },
    { key: "cad", label: "Cadencia", color: "#F97316", unit: activity.sport === "cycling" ? "rpm" : "ppm", values: activity.points.map((point) => point.cad) },
    activity.sport === "cycling" ? { key: "power", label: "Potencia", color: "#7C3AED", unit: "W", values: activity.points.map((point) => point.power) } : null,
  ];
  const options = rawOptions.filter((option): option is ChartOption => Boolean(option));
  const [active, setActive] = useState<string[]>(() => hasReliableHeartRate(activity) ? ["ele", "hr"] : ["ele", "pace"]);
  useEffect(() => {
    setActive(hasReliableHeartRate(activity) ? ["ele", "hr"] : ["ele", "pace"]);
  }, [activity.id]);
  const selected = options.filter((option) => active.includes(option.key)).slice(0, 2);
  const points = activity.points;
  if (points.length < 2) return <div className="grid h-44 place-items-center text-sm font-bold text-slate-400">Sin datos de grafica</div>;
  const safeIndex = clampIndex(selectedIndex, points.length);
  const cursorPoint = points[safeIndex];
  const w = 900;
  const h = expanded ? 280 : 240;
  const plot = { left: 54, right: 56, top: 22, bottom: 38 };
  const plotWidth = w - plot.left - plot.right;
  const plotHeight = h - plot.top - plot.bottom;
  const maxKm = points.at(-1)?.distanceKm || 1;
  const x = (km: number) => plot.left + (km / maxKm) * plotWidth;
  const makePath = (coords: Array<{ x: number; y: number }>) => coords.map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.y}`).join(" ");
  const seriesScales = selected.map((series) => {
    const valid = series.values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    let minV = valid.length ? Math.min(...valid) : 0;
    let maxV = valid.length ? Math.max(...valid) : 1;
    const minRange = series.minRange || 1;
    if (valid.length && maxV - minV < minRange) {
      const center = (maxV + minV) / 2;
      minV = center - minRange / 2;
      maxV = center + minRange / 2;
    }
    const y = (value: number) => plot.top + plotHeight - ((value - minV) / Math.max(1, maxV - minV)) * plotHeight;
    return { ...series, valid, minV, maxV, y };
  });
  const formatAxisValue = (value: number, unit: string) => {
    if (!Number.isFinite(value)) return "--";
    const rounded = Math.abs(value) >= 10 ? Math.round(value) : Number(value.toFixed(1));
    return `${rounded}${unit === "%" ? "%" : ""}`;
  };
  const moveCursorFromPointer = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * w;
    const ratio = Math.max(0, Math.min(1, (svgX - plot.left) / plotWidth));
    const targetKm = ratio * maxKm;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    points.forEach((point, index) => {
      const distance = Math.abs(point.distanceKm - targetKm);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    onSelectedIndexChange(bestIndex);
  };
  const cursorX = x(cursorPoint?.distanceKm || 0);
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,4fr)_minmax(170px,0.9fr)]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="grid flex-1 grid-cols-3 gap-2 text-xs lg:grid-cols-6">
            {pointMetricCards(activity, cursorPoint).filter(([label]) => hasReliableHeartRate(activity) || label !== "FC").slice(0, 6).map(([label, value]) => (
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2" key={label}>
                <p className="font-black uppercase text-slate-400">{label}</p>
                <p className="mt-1 font-black text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50" type="button" onClick={onExpand}>
            {expanded ? "Cerrar visor" : "Expandir grafica"}
          </button>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className={`${expanded ? "h-[260px] xl:h-[300px]" : "h-[230px]"} w-full touch-none overflow-visible`} onPointerDown={moveCursorFromPointer} onPointerMove={(event) => { if (event.buttons === 1) moveCursorFromPointer(event); }}>
          <defs>
            <linearGradient id={`chart-bg-${activity.id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#F8FAFC" stopOpacity="0" />
              <stop offset="100%" stopColor="#F8FAFC" stopOpacity="1" />
            </linearGradient>
            <filter id={`soft-glow-${activity.id}`} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#0F172A" floodOpacity="0.10" />
            </filter>
            {selected.map((series) => (
              <linearGradient id={`grad-${activity.id}-${series.key}`} key={series.key} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={series.color} stopOpacity="0.34" />
                <stop offset="48%" stopColor={series.color} stopOpacity="0.14" />
                <stop offset="100%" stopColor={series.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          <rect x={plot.left} y={plot.top} width={plotWidth} height={plotHeight} rx="14" fill={`url(#chart-bg-${activity.id})`} />
          {[0.25, 0.5, 0.75].map((tick) => (
            <line key={tick} x1={plot.left} x2={w - plot.right} y1={plot.top + tick * plotHeight} y2={plot.top + tick * plotHeight} stroke="#E2E8F0" strokeDasharray="4 4" />
          ))}
          {[0.2, 0.4, 0.6, 0.8].map((tick) => (
            <line key={`v-${tick}`} x1={plot.left + tick * plotWidth} x2={plot.left + tick * plotWidth} y1={plot.top} y2={h - plot.bottom} stroke="#F1F5F9" />
          ))}
          <line x1={plot.left} x2={plot.left} y1={plot.top} y2={h - plot.bottom} stroke="#CBD5E1" />
          <line x1={plot.left} x2={w - plot.right} y1={h - plot.bottom} y2={h - plot.bottom} stroke="#CBD5E1" />
          {seriesScales.length > 1 ? <line x1={w - plot.right} x2={w - plot.right} y1={plot.top} y2={h - plot.bottom} stroke="#CBD5E1" /> : null}
          {seriesScales.map((series, seriesIndex) => {
            if (series.valid.length < 2) return null;
            const coords = points
              .map((point, index) => {
                const value = series.values[index];
                return typeof value === "number" && Number.isFinite(value) ? { x: x(point.distanceKm), y: series.y(value) } : null;
              })
              .filter((coord): coord is { x: number; y: number } => Boolean(coord));
            const line = makePath(coords);
            const area = coords.length
              ? `${makePath(coords)} L ${coords.at(-1)!.x} ${h - plot.bottom} L ${coords[0]!.x} ${h - plot.bottom} Z`
              : "";
            return (
              <g key={series.key}>
                <path d={area} fill={`url(#grad-${activity.id}-${series.key})`} opacity={seriesIndex === 0 ? 1 : 0.72} />
                <path d={line} fill="none" stroke={series.color} strokeWidth={seriesIndex === 0 ? "3.25" : "2.75"} strokeLinecap="round" strokeLinejoin="round" filter={`url(#soft-glow-${activity.id})`} />
                {coords.length ? <circle cx={coords.at(-1)!.x} cy={coords.at(-1)!.y} r="4" fill="#FFFFFF" stroke={series.color} strokeWidth="2.5" /> : null}
              </g>
            );
          })}
          <line x1={cursorX} x2={cursorX} y1={plot.top} y2={h - plot.bottom} stroke="#0F172A" strokeDasharray="5 4" strokeWidth="1.5" />
          <circle cx={cursorX} cy={h - plot.bottom} r="5" fill="#0F172A" />
          {seriesScales.map((series) => {
            const value = series.values[safeIndex];
            if (typeof value !== "number" || !Number.isFinite(value)) return null;
            return <circle key={`cursor-${series.key}`} cx={cursorX} cy={series.y(value)} r="5" fill="#FFFFFF" stroke={series.color} strokeWidth="3" />;
          })}
          {seriesScales[0] ? (
            <g fill={seriesScales[0].color} fontSize="11" fontWeight="700">
              <text x="8" y={plot.top + 4}>{formatAxisValue(seriesScales[0].maxV, seriesScales[0].unit)}</text>
              <text x="8" y={h - plot.bottom}>{formatAxisValue(seriesScales[0].minV, seriesScales[0].unit)}</text>
              <text x="8" y={plot.top + plotHeight / 2}>{seriesScales[0].unit}</text>
            </g>
          ) : null}
          {seriesScales[1] ? (
            <g fill={seriesScales[1].color} fontSize="11" fontWeight="700" textAnchor="end">
              <text x={w - 8} y={plot.top + 4}>{formatAxisValue(seriesScales[1].maxV, seriesScales[1].unit)}</text>
              <text x={w - 8} y={h - plot.bottom}>{formatAxisValue(seriesScales[1].minV, seriesScales[1].unit)}</text>
              <text x={w - 8} y={plot.top + plotHeight / 2}>{seriesScales[1].unit}</text>
            </g>
          ) : null}
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
            <text key={`x-label-${tick}`} x={plot.left + tick * plotWidth} y={h - 12} fill="#64748B" fontSize="11" fontWeight="700" textAnchor={tick === 0 ? "start" : tick === 1 ? "end" : "middle"}>
              {(maxKm * tick).toFixed(tick === 0 ? 0 : 1)} km
            </text>
          ))}
          <text x={plot.left + plotWidth / 2} y={h - 2} fill="#64748B" fontSize="11" fontWeight="800" textAnchor="middle">Distancia</text>
        </svg>
        <div className="mt-2 flex flex-wrap gap-3 text-xs font-bold text-slate-500">
          {seriesScales.map((series, index) => <span key={series.key} style={{ color: series.color }}>{index === 0 ? "Eje Y izq." : "Eje Y der."} - {series.label} ({series.unit})</span>)}
        </div>
        <div className={`${expanded ? "mt-2" : "mt-3"} grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3`}>
          <div className="flex items-center justify-between gap-3">
            <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" type="button" onClick={() => onSelectedIndexChange(clampIndex(safeIndex - 1, points.length))}>Anterior</button>
            <span className="text-xs font-black text-slate-500">{cursorPoint.distanceKm.toFixed(2)} km / {maxKm.toFixed(2)} km</span>
            <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" type="button" onClick={() => onSelectedIndexChange(clampIndex(safeIndex + 1, points.length))}>Siguiente</button>
          </div>
          <input aria-label="Recorrer distancia de la actividad" className="w-full accent-blue-600" max={points.length - 1} min={0} type="range" value={safeIndex} onChange={(event) => onSelectedIndexChange(Number(event.target.value))} />
        </div>
      </div>

      <div className="grid content-start gap-2 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
        <p className="text-xs font-black uppercase tracking-wide text-slate-500">Metricas</p>
        {options.map((option) => {
          const enabled = active.includes(option.key);
          return (
            <button
              className={`rounded-lg border px-3 py-2 text-left text-xs font-black transition ${enabled ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
              key={option.key}
              type="button"
              onClick={() => {
                setActive((current) => {
                  if (current.includes(option.key)) return current.filter((item) => item !== option.key);
                  return [...current.slice(-1), option.key];
                });
              }}
            >
              {option.label}
            </button>
          );
        })}
        <p className="pt-1 text-[11px] font-bold leading-5 text-slate-500">Puedes comparar hasta 2 metricas a la vez.</p>
      </div>
    </div>
  );
}

function HeartZoneBars({ activity }: { activity: ActivityAnalysis }) {
  const liveActivity = hydrateCloudActivity(activity);
  if (!hasReliableHeartRate(liveActivity)) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-xs font-bold leading-5 text-slate-500">
        Esta actividad no trae suficientes puntos de frecuencia cardiaca. Revisa banda/reloj, bateria o permisos de Strava.
      </div>
    );
  }
  const totalsByZone = new globalThis.Map(liveActivity.zoneTotals.map((zone) => [zone.zoneKey, zone]));
  const zones = liveActivity.zones.map((zone) => {
    const totalZone = totalsByZone.get(zone.key);
    return {
      zoneKey: zone.key,
      label: `${zone.key} ${zone.name}`,
      color: zone.color,
      range: `${zone.min}-${zone.max}`,
      seconds: totalZone?.seconds || 0,
    };
  });
  const zoneTotal = zones.reduce((sum, zone) => sum + zone.seconds, 0);
  const percentages = zones.map((zone) => zoneTotal ? (zone.seconds / zoneTotal) * 100 : 0);
  const rounded = percentages.map(Math.floor);
  let remainder = zoneTotal ? 100 - rounded.reduce((sum, value) => sum + value, 0) : 0;
  percentages
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
    .forEach((item) => {
      if (remainder > 0) {
        rounded[item.index] += 1;
        remainder -= 1;
      }
    });

  return (
    <div className="grid gap-3">
      {zones.map((zone, index) => {
        const pct = rounded[index] || 0;
        return (
          <div key={zone.zoneKey}>
            <div className="mb-1 grid grid-cols-[minmax(0,1fr)_38px_48px] items-center gap-2 text-xs">
              <span className="min-w-0" title={`${zone.label} ${zone.range} bpm`}>
                <span className="block truncate font-black text-slate-700">{zone.label}</span>
                <span className="block truncate text-[10px] font-black uppercase tracking-wide text-slate-400">{zone.range} bpm</span>
              </span>
              <span className="text-right font-black text-slate-900">{pct}%</span>
              <span className="text-right font-semibold text-slate-500">{formatDuration(zone.seconds)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: zone.color }} />
            </div>
          </div>
        );
      })}
      {!zoneTotal ? <p className="rounded-lg bg-slate-50 p-3 text-xs font-bold text-slate-400">Sin datos de frecuencia cardiaca para distribuir zonas.</p> : null}
    </div>
  );
}

function MapLayerControls({
  layer,
  heatmap,
  onLayerChange,
  onHeatmapChange,
}: {
  layer: LayerKey;
  heatmap: boolean;
  onLayerChange: (layer: LayerKey) => void;
  onHeatmapChange: (value: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">Capas del mapa</p>
      <div className="mt-2 grid gap-2">
        {(Object.keys(layerLabels) as LayerKey[]).map((key) => (
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700" key={key}>
            <input type="radio" checked={layer === key} onChange={() => onLayerChange(key)} />
            {layerLabels[key]}
          </label>
        ))}
      </div>
      <label className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs font-bold text-slate-700">
        Heatmap
        <input type="checkbox" checked={heatmap} onChange={(event) => onHeatmapChange(event.target.checked)} />
      </label>
    </div>
  );
}

function ZoneScrubber({
  activity,
  selectedIndex,
  onSelectedIndexChange,
}: {
  activity: ActivityAnalysis;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
}) {
  const liveActivity = hydrateCloudActivity(activity);
  const total = liveActivity.zoneTimeline.reduce((sum, item) => sum + item.seconds, 0) || 1;
  const safeIndex = clampIndex(selectedIndex, liveActivity.points.length);
  const cursor = liveActivity.points[safeIndex];
  const maxKm = liveActivity.metrics.distanceKm || liveActivity.points.at(-1)?.distanceKm || 1;
  const cursorPct = Math.max(0, Math.min(100, ((cursor?.distanceKm || 0) / maxKm) * 100));
  const moveFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const targetKm = ratio * maxKm;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    liveActivity.points.forEach((point, index) => {
      const distance = Math.abs((point.distanceKm || 0) - targetKm);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    onSelectedIndexChange(bestIndex);
  };

  return (
    <div className="grid gap-2">
      <div
        className="relative flex h-8 cursor-pointer overflow-hidden rounded-md bg-slate-100"
        onPointerDown={moveFromPointer}
        onPointerMove={(event) => { if (event.buttons === 1) moveFromPointer(event); }}
      >
        {liveActivity.zoneTimeline.map((segment, index) => (
          <div
            key={`${segment.zoneKey}-${index}`}
            className="group relative min-w-[4px]"
            style={{ width: `${(segment.seconds / total) * 100}%`, backgroundColor: segment.color }}
            title={`${segment.label} | ${formatDuration(segment.seconds)} | FC ${segment.avgHr || "--"} | ${segment.range} | km ${segment.startKm.toFixed(1)}-${segment.endKm.toFixed(1)}`}
          />
        ))}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-slate-950 shadow-[0_0_0_3px_rgba(15,23,42,0.18)]" style={{ left: `${cursorPct}%` }} />
        <div className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow-md" style={{ left: `${cursorPct}%` }} />
      </div>
      <input
        aria-label="Recorrer puntos sobre zonas y mapa"
        className="w-full accent-blue-600"
        max={Math.max(0, liveActivity.points.length - 1)}
        min={0}
        type="range"
        value={safeIndex}
        onChange={(event) => onSelectedIndexChange(Number(event.target.value))}
      />
    </div>
  );
}

function ZoneTimeline({
  activity,
}: {
  activity: ActivityAnalysis;
}) {
  const liveActivity = hydrateCloudActivity(activity);
  const total = liveActivity.zoneTimeline.reduce((sum, item) => sum + item.seconds, 0) || 1;
  const strongest = [...liveActivity.zoneTotals].sort((a, b) => b.seconds - a.seconds)[0];
  const peaks = liveActivity.zoneTimeline.filter((item) => (item.zoneKey === "Z4" || item.zoneKey === "Z5") && item.seconds >= 12).length;
  const last = liveActivity.zoneTimeline.at(-1);
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-black text-slate-900">Comportamiento por zonas</h2>
        <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-slate-500">Por distancia</span>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-emerald-50 p-4">
          <p className="text-xs font-bold text-emerald-700">Mayor permanencia</p>
          <p className="mt-1 font-black text-slate-900">{strongest ? `${strongest.label} - ${Math.round((strongest.seconds / total) * 100)}%` : "--"}</p>
        </div>
        <div className="rounded-lg bg-orange-50 p-4">
          <p className="text-xs font-bold text-orange-700">Picos de intensidad</p>
          <p className="mt-1 font-black text-slate-900">{peaks} entradas a Z4/Z5</p>
        </div>
        <div className="rounded-lg bg-red-50 p-4">
          <p className="text-xs font-bold text-red-700">Ultimo tramo</p>
          <p className="mt-1 font-black text-slate-900">{last?.label || "--"}</p>
        </div>
      </div>
    </section>
  );
}

function CadenceTerrainAnalysis({ activity }: { activity: ActivityAnalysis }) {
  const cadence = activity.metrics.cadenceEfficiency;
  if (activity.sport !== "cycling" || !cadence || cadence.activePedalingSec < 60) return null;
  const terrain = cadence.terrain.filter((item) => item.seconds > 0);
  const overMinutes = Math.round(cadence.overgearedSec / 60);

  return (
    <section className="rounded-lg border border-[#D9EAFE] bg-white p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-blue-600">Cadencia por terreno</p>
          <h2 className="mt-1 text-lg font-black text-slate-900">Eficiencia biomecanica</h2>
          <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
            Compara tu cadencia contra el rango esperado segun inclinacion real, excluyendo bajadas y tramos sin pedaleo.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:min-w-[280px]">
          <div className="rounded-lg bg-blue-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-blue-600">Score</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{cadence.efficiencyPct}%</p>
          </div>
          <div className="rounded-lg bg-orange-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-orange-600">Atrancado</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{overMinutes} min</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-3">
        {terrain.map((item) => (
          <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-4" key={item.key}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-slate-900">{item.label}</p>
                <p className="mt-1 text-[11px] font-black uppercase tracking-wide text-slate-400">
                  {item.range} - optimo {item.optimal}
                </p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-blue-700 ring-1 ring-blue-100">
                {item.efficiencyPct}%
              </span>
            </div>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, item.efficiencyPct)}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-[11px] font-bold text-slate-500">
              <div>
                <p className="font-black uppercase text-slate-400">Tiempo</p>
                <p className="mt-1 text-slate-900">{formatDuration(item.seconds)}</p>
              </div>
              <div>
                <p className="font-black uppercase text-slate-400">Cad.</p>
                <p className="mt-1 text-slate-900">{item.avgCadence ? `${item.avgCadence} rpm` : "--"}</p>
              </div>
              <div>
                <p className="font-black uppercase text-slate-400">Atr.</p>
                <p className="mt-1 text-slate-900">{formatDuration(item.overgearedSeconds)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className={`mt-4 rounded-lg border p-4 ${cadence.overgearedSec >= 12 * 60 ? "border-orange-100 bg-orange-50" : "border-emerald-100 bg-emerald-50"}`}>
        <p className={`text-xs font-black uppercase tracking-wide ${cadence.overgearedSec >= 12 * 60 ? "text-orange-700" : "text-emerald-700"}`}>
          Insight tecnico
        </p>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{cadence.insight}</p>
      </div>
    </section>
  );
}

export default function ActivityAnalysisPage({ sport }: Props) {
  const copy = sportCopy(sport);
  const analysisTopRef = useRef<HTMLDivElement | null>(null);
  const intelligenceRef = useRef<HTMLElement | null>(null);
  const [activities, setActivities] = useState<ActivityAnalysis[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [layer, setLayer] = useState<LayerKey>("terrain");
  const [heatmap, setHeatmap] = useState(false);
  const [status, setStatus] = useState("");
  const [aiLoadingId, setAiLoadingId] = useState("");
  const [syncingStrava, setSyncingStrava] = useState(false);
  const [showAI, setShowAI] = useState(true);
  const [chartPointIndex, setChartPointIndex] = useState(0);
  const [mapPointIndex, setMapPointIndex] = useState(0);
  const [expandedViewer, setExpandedViewer] = useState<"" | "chart" | "map">("");
  const [bikeProfiles, setBikeProfiles] = useState<BikeProfile[]>([]);

  useEffect(() => {
    let alive = true;
    const loadCloudActivities = () => {
      getCloudCollection<ActivityAnalysis>(`/activities?sport=${sport}`, "activities")
        .then((cloudActivities) => {
          if (!alive || !cloudActivities.length) return;
          setActivities((currentActivities) => {
            const merged = mergeCloudActivities(cloudActivities, currentActivities).filter((activity) => keepActivityForSport(activity, sport));
            setSelectedId((current) => current && merged.some((activity) => activity.id === current) ? current : merged[0]?.id || "");
            safeSetActivities(storageKeyForSport(sport), merged);
            return merged;
          });
        })
        .catch(() => undefined);
    };
    try {
      const saved = localStorage.getItem(storageKeyForSport(sport));
      const parsed = saved ? JSON.parse(saved) : [];
      const recalculated = Array.isArray(parsed) ? sortActivitiesBySessionDate(parsed.map(hydrateCloudActivity).filter((activity) => keepActivityForSport(activity, sport))) : [];
      setActivities(recalculated);
      safeSetActivities(storageKeyForSport(sport), recalculated);
      setSelectedId(recalculated[0]?.id || "");
    } catch {
      setActivities([]);
    }
    syncCloudProfileToLocal()
      .then((profile) => {
        if (!alive) return;
        setBikeProfiles(profileBikesFromStorage(profile || undefined));
        setActivities((currentActivities) => {
          const recalculated = sortActivitiesBySessionDate(currentActivities.map(hydrateCloudActivity).filter((activity) => keepActivityForSport(activity, sport)));
          safeSetActivities(storageKeyForSport(sport), recalculated);
          return recalculated;
        });
      })
      .catch(() => undefined);
    loadCloudActivities();
    setBikeProfiles(profileBikesFromStorage());
    const refreshOnFocus = () => loadCloudActivities();
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    const timer = window.setInterval(loadCloudActivities, 30000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [sport]);

  const selected = useMemo(() => {
    const activity = activities.find((item) => item.id === selectedId) || activities[0];
    return activity ? hydrateCloudActivity(activity) : undefined;
  }, [activities, selectedId]);

  useEffect(() => {
    setShowAI(!selected?.aiAcknowledgedAt);
    setChartPointIndex(0);
    setMapPointIndex(0);
    setExpandedViewer("");
  }, [selected?.id, selected?.aiAcknowledgedAt]);

  const safeChartPointIndex = selected ? clampIndex(chartPointIndex, selected.points.length) : 0;
  const safeMapPointIndex = selected ? clampIndex(mapPointIndex, selected.points.length) : 0;
  const mapPoint = selected?.points[safeMapPointIndex];

  const saveActivities = (next: ActivityAnalysis[]) => {
    const ordered = sortActivitiesBySessionDate(next.filter((activity) => keepActivityForSport(activity, sport)));
    const stored = safeSetActivities(storageKeyForSport(sport), ordered);
    setActivities(ordered);
    const token = localStorage.getItem("token");
    if (token) {
      saveActivityBatchToCloud(sport, ordered, token)
        .catch((error) => setStatus(error instanceof Error ? `No se pudo guardar en nube: ${error.message}` : "No se pudo guardar en nube."));
    }
    if (stored.length !== ordered.length) {
      setStatus("Se guardaron las actividades compactadas para no superar el limite local del navegador.");
    }
  };

  const assignBikeToSelectedActivity = (bikeId: string) => {
    if (!selected) return;
    const bike = bikeProfiles.find((item) => item.id === bikeId);
    const next = activities.map((activity) =>
      activity.id === selected.id
        ? { ...activity, bikeId, bikeLabel: bike ? bikeLabel(bike) : undefined }
        : activity,
    );
    saveActivities(next);
    setStatus(bike ? `${selected.name}: bici asignada ${bikeLabel(bike)}.` : `${selected.name}: bici actualizada.`);
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus("Procesando archivo deportivo...");
    try {
      const parsed = await parseActivityFile(file, sport);
      const next = [parsed, ...activities.filter((activity) => activity.id !== parsed.id)];
      saveActivities(next);
      setSelectedId(parsed.id);
      setStatus(`${parsed.name} importado correctamente.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo importar la actividad.");
    } finally {
      event.target.value = "";
    }
  };

  const updateNotes = (value: string) => {
    if (!selected) return;
    const next = activities.map((activity) => (activity.id === selected.id ? { ...activity, notes: value } : activity));
    saveActivities(next);
  };

  const generateAIAnalysis = async (activity: ActivityAnalysis) => {
    setAiLoadingId(activity.id);
    setStatus("IDG Intelligence esta analizando la sesion...");
    try {
      const profileRaw = localStorage.getItem("idg_profile_json") || localStorage.getItem("iv_profile");
      const profile = profileRaw ? JSON.parse(profileRaw) : {};
      const response = await fetch("/api/activity-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activity, profile }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "No se pudo generar el analisis.");
      const next = activities.map((item) =>
        item.id === activity.id
          ? { ...item, aiAnalysis: data.analysis, aiGeneratedAt: new Date().toISOString(), aiAcknowledgedAt: undefined }
          : item,
      );
      saveActivities(next);
      setSelectedId(activity.id);
      setShowAI(true);
      setStatus("Analisis IA guardado en la sesion.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo conectar con IDG Intelligence.");
    } finally {
      setAiLoadingId("");
    }
  };

  const deleteActivity = (activity: ActivityAnalysis) => {
    const next = activities.filter((item) => item.id !== activity.id);
    saveActivities(next);
    const token = localStorage.getItem("token");
    if (token) {
      deleteActivityFromCloud(activity.id, token)
        .catch((error) => setStatus(error instanceof Error ? `No se pudo eliminar en nube: ${error.message}` : "No se pudo eliminar en nube."));
    }
    setSelectedId(next[0]?.id || "");
    setStatus(`${activity.name} eliminado del historial local.`);
  };

  const scrollToAnalysis = () => {
    window.requestAnimationFrame(() => {
      analysisTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const scrollToIntelligence = () => {
    window.requestAnimationFrame(() => {
      intelligenceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const viewActivity = (activity: ActivityAnalysis) => {
    setSelectedId(activity.id);
    setShowAI(!activity.aiAcknowledgedAt);
    setStatus(`${activity.name} cargado en el analisis principal.`);
    scrollToAnalysis();
  };

  const analyzeActivityFromHistory = async (activity: ActivityAnalysis) => {
    setSelectedId(activity.id);
    setShowAI(true);
    scrollToIntelligence();
    if (activity.aiAnalysis) {
      setStatus(`${activity.name}: analisis IA guardado abierto.`);
      return;
    }
    await generateAIAnalysis(activity);
  };

  const syncStrava = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setStatus("Inicia sesion con Google antes de sincronizar Strava.");
      return;
    }
    setSyncingStrava(true);
    setStatus("Sincronizando Strava desde la ultima actividad guardada. Primera sincronizacion: hasta 90 dias.");
    try {
      const params = new URLSearchParams({
        sport,
        days: "90",
        limit: "100",
      });
      const response = await fetch(`${apiUrl()}/strava/sync?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        const detail = data.detail ? ` ${data.detail}` : "";
        throw new Error(`${data.error || "No se pudo sincronizar Strava."}${detail}`);
      }
      const imported = (data.activities || []).map((item: StravaSyncedActivity) => stravaToActivity(item, sport)).filter((activity: ActivityAnalysis) => keepActivityForSport(activity, sport));
      if (!imported.length) {
        const types = Array.isArray(data.availableTypes) && data.availableTypes.length ? ` Tipos recibidos: ${data.availableTypes.join(", ")}.` : "";
        const scanned = typeof data.scanned === "number" ? ` Revise ${data.scanned} actividades; ${data.inRange || 0} estan dentro del rango.` : "";
        const recent = Array.isArray(data.recent) && data.recent.length
          ? ` Recientes: ${data.recent.map((item: { name?: string; type?: string; start_date?: string; in_range?: boolean; matched_sport?: boolean; already_registered?: boolean }) => {
            const flags = [
              item.in_range ? "rango" : "fuera-rango",
              item.matched_sport ? "deporte-ok" : "otro-deporte",
              item.already_registered ? "ya-registrada" : "nueva",
            ].join("/");
            return `${item.start_date?.slice(0, 10) || "sin fecha"} ${item.type || "sin tipo"} ${item.name || ""} (${flags})`.trim();
          }).join(" | ")}.`
          : "";
        const since = data.after ? ` desde ${String(data.after).slice(0, 10)}` : "";
        setStatus(`Strava conectado: no hay sesiones nuevas de ${sport === "cycling" ? "ciclismo" : "running"}${since}. Primera sincronizacion revisa hasta ${data.days || 90} dias.${scanned}${types}${recent}`);
        return;
      }
      const next = [
        ...imported,
        ...activities.filter((activity) => !imported.some((item: ActivityAnalysis) => item.id === activity.id)),
      ];
      const ordered = sortActivitiesBySessionDate(next.map(hydrateCloudActivity).filter((activity) => keepActivityForSport(activity, sport)));
      safeSetActivities(storageKeyForSport(sport), ordered);
      setActivities(ordered);
      setSelectedId(imported[0].id);
      setStatus(`${imported.length} actividades sincronizadas desde Strava. El backend las guardo en Supabase como filas individuales.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo sincronizar Strava.");
    } finally {
      setSyncingStrava(false);
    }
  };

  const acknowledgeAI = (activity: ActivityAnalysis) => {
    const next = activities.map((item) =>
      item.id === activity.id ? { ...item, aiAcknowledgedAt: new Date().toISOString() } : item,
    );
    saveActivities(next);
    setShowAI(false);
  };

  return (
    <>
      <TopNav title={copy.subtitle} />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#F8FAFC] p-4 text-[#0F172A] lg:p-6" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-bold text-[#64748B]">{copy.subtitle} - Analisis fisiologico</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-[#0F172A]" style={{ fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>{copy.title}</h1>
          </div>
          <div className="flex flex-wrap gap-3">
            {activities.length ? (
              <select className="h-11 rounded-lg border border-[#E2E8F0] bg-white px-3 text-sm font-bold text-slate-700" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                {activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.date} - {isSupportActivity(activity) ? "Soporte - " : ""}{activity.name}</option>)}
              </select>
            ) : null}
            {sport === "cycling" && selected && bikeProfiles.length ? (
              <select
                aria-label="Bici usada en la ruta"
                className="h-11 rounded-lg border border-[#E2E8F0] bg-white px-3 text-sm font-bold text-slate-700"
                value={selected.bikeId || bikeProfiles.find((bike) => bike.isPrimary)?.id || bikeProfiles[0]?.id || ""}
                onChange={(event) => assignBikeToSelectedActivity(event.target.value)}
              >
                {bikeProfiles.map((bike) => (
                  <option key={bike.id} value={bike.id}>
                    {bikeLabel(bike)}
                  </option>
                ))}
              </select>
            ) : null}
            <label className="grid h-11 cursor-pointer place-items-center rounded-lg bg-[#1D4ED8] px-4 text-sm font-black text-white">
              Importar GPX/FIT
              <input className="hidden" type="file" accept=".gpx,.fit" onChange={onFile} />
            </label>
            <button
              className="h-11 rounded-lg border border-orange-200 bg-orange-50 px-4 text-sm font-black text-[#fc4c02] disabled:opacity-60"
              type="button"
              onClick={syncStrava}
              disabled={syncingStrava}
            >
              {syncingStrava ? "Sincronizando..." : "Sincronizar Strava"}
            </button>
          </div>
        </div>

        {status ? <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{status}</div> : null}

        {!selected ? (
          <div className="grid min-h-[520px] place-items-center rounded-lg border border-dashed border-[#CBD5E1] bg-white">
            <div className="max-w-md text-center">
              <h2 className="text-2xl font-black text-slate-900">Importa una actividad</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">Sube un GPX o FIT para ver mapa, zonas cardiacas, elevacion, metricas y segmentos con experiencia premium.</p>
            </div>
          </div>
        ) : (
          <>
          <div ref={analysisTopRef} className="grid scroll-mt-4 gap-5">
            <section className="rounded-lg border border-[#E2E8F0] bg-white p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
                {(sport === "cycling" ? [
                  ["Distancia", selected.metrics.distanceKm.toFixed(2), "km"],
                  ["Tiempo", formatDuration(selected.metrics.durationSec), ""],
                  ["Desnivel +", selected.metrics.elevationGain, "m"],
                  ["Vel. promedio", selected.metrics.avgSpeedKmh, "km/h"],
                  ["FC promedio", selected.metrics.avgHr, "bpm"],
                  ["FC maxima", selected.metrics.maxHr, "bpm"],
                  ["Potencia", selected.metrics.avgPower || selected.metrics.normalizedPower, "W"],
                  ["Cadencia", selected.metrics.avgCadence, "rpm"],
                  ["Calorias", selected.metrics.calories, "kcal"],
                  ["Potencia NP", selected.metrics.normalizedPower, "W"],
                  ["FTP est.", selected.metrics.estimatedFtp, "W"],
                  ["TSS", selected.metrics.tss, ""],
                  ["IF", selected.metrics.intensityFactor, ""],
                ] : [
                  ["Distancia", selected.metrics.distanceKm.toFixed(2), "km"],
                  ["Tiempo", formatDuration(selected.metrics.durationSec), ""],
                  ["Desnivel +", selected.metrics.elevationGain, "m"],
                  ["Ritmo", selected.metrics.pace, "/km"],
                  ["FC promedio", selected.metrics.avgHr, "bpm"],
                  ["FC maxima", selected.metrics.maxHr, "bpm"],
                  ["Cadencia", displayCadence(selected), "ppm"],
                  ["Calorias", selected.metrics.calories, "kcal"],
                  ["Desnivel -", selected.metrics.elevationLoss, "m"],
                  ["Altitud Max.", selected.metrics.altitudeMax, "m"],
                  ["Pendiente Prom.", selected.metrics.avgGradePct, "%"],
                ]).filter(([label]) => hasReliableHeartRate(selected) || !String(label).startsWith("FC")).map(([label, value, unit]) => (
                  <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2" key={label} title={label === "Potencia" && sport === "cycling" ? powerLabel(selected) : String(label)}>
                    <p className="truncate text-[10px] font-black uppercase tracking-wide text-[#64748B]">{label}</p>
                    <p className="mt-0.5 text-lg font-black leading-tight text-[#0F172A] xl:text-xl">{metric(value, String(unit))}</p>
                  </div>
                ))}
              </div>
              {sport === "cycling" ? (
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-slate-400">
                  <span>{powerLabel(selected)}</span>
                  {selected.bikeLabel ? <span className="text-slate-500">Bici: {selected.bikeLabel}</span> : null}
                </div>
              ) : null}
              {isSupportActivity(selected) ? (
                <p className="mt-2 w-fit rounded-full bg-amber-50 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-amber-700">
                  Actividad de soporte: visible para analisis, excluida del acumulado de running
                </p>
              ) : null}
              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-lg font-black text-slate-900">Grafica multimetricas</h2>
                    <p className="text-xs font-bold text-slate-500">Eje X por distancia; cada metrica usa su propio eje Y para comparar tendencias sin deformar unidades.</p>
                  </div>
                </div>
                <ActivityMetricChart activity={selected} selectedIndex={safeChartPointIndex} onSelectedIndexChange={setChartPointIndex} onExpand={() => setExpandedViewer("chart")} />
              </div>
            </section>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <section className="grid gap-3 rounded-lg border border-[#E2E8F0] bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-black text-slate-900">Mapa de ruta</h2>
                    <p className="text-xs font-bold text-slate-500">El zoom y posicion quedan bajo tu control.</p>
                  </div>
                  <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50" type="button" onClick={() => setExpandedViewer("map")}>
                    Expandir mapa
                  </button>
                </div>
                <ActivityMap activity={selected} layer={layer} heatmap={heatmap} selectedPoint={mapPoint} onExpand={() => setExpandedViewer("map")} />
                <div className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" type="button" onClick={() => setMapPointIndex(clampIndex(safeMapPointIndex - 1, selected.points.length))}>Punto anterior</button>
                    <span className="text-xs font-black text-slate-500">{mapPoint?.distanceKm.toFixed(2) || "0.00"} km</span>
                    <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" type="button" onClick={() => setMapPointIndex(clampIndex(safeMapPointIndex + 1, selected.points.length))}>Punto siguiente</button>
                  </div>
                  <ZoneScrubber activity={selected} selectedIndex={safeMapPointIndex} onSelectedIndexChange={setMapPointIndex} />
                </div>
              </section>

              <aside className="grid content-start gap-4 rounded-lg border border-[#E2E8F0] bg-white p-5">
                <MapLayerControls layer={layer} heatmap={heatmap} onLayerChange={setLayer} onHeatmapChange={setHeatmap} />
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-blue-600">Analisis de zonas</p>
                  <h2 className="mt-1 text-lg font-black text-slate-900">Distribucion cardiaca</h2>
                  <p className="mt-1 text-xs font-bold leading-5 text-slate-500">Tiempo acumulado por zona para entender la carga real de la sesion.</p>
                </div>
                <div>
                  <HeartZoneBars activity={selected} />
                </div>
              </aside>
            </div>

            <ZoneTimeline activity={selected} />
            <CadenceTerrainAnalysis activity={selected} />

            <section className="rounded-lg border border-[#E2E8F0] bg-white p-5">
              <h2 className="text-lg font-black text-slate-900">Notas de la actividad</h2>
              <textarea className="mt-4 min-h-28 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-500" value={selected.notes} onChange={(event) => updateNotes(event.target.value)} placeholder="Sensaciones, observaciones, clima, alimentacion o molestias." />
            </section>
          </div>

          <section ref={intelligenceRef} className="mt-5 scroll-mt-4 rounded-lg border border-blue-100 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-blue-600">IDG Intelligence</p>
                <h2 className="mt-1 text-lg font-black text-slate-900">IDG Intelligence</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {selected.aiAnalysis && selected.aiAcknowledgedAt && !showAI
                    ? "Analisis leido. Puedes abrirlo de nuevo o reanalizar la sesion cuando cambie tu perfil."
                    : "Analisis guardado para esta sesion. Se conserva en el historial y puede ocultarse despues de leerlo."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selected.aiAnalysis && !showAI ? (
                  <button
                    className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-black text-blue-700"
                    type="button"
                    onClick={() => setShowAI(true)}
                  >
                    Ver analisis
                  </button>
                ) : null}
                <button
                  className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:bg-blue-300"
                  type="button"
                  disabled={aiLoadingId === selected.id}
                  onClick={() => generateAIAnalysis(selected)}
                >
                  {aiLoadingId === selected.id ? "Analizando..." : selected.aiAnalysis ? "Reanalizar sesion" : "Generar analisis IA"}
                </button>
              </div>
            </div>
            {selected.aiAnalysis && selected.aiAcknowledgedAt && !showAI ? (
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-emerald-100 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-black text-emerald-800">Analisis confirmado como leido</p>
                  <p className="mt-1 text-xs font-bold text-emerald-700">La lectura IA sigue disponible en esta sesion y en el historial.</p>
                </div>
                <button className="rounded-lg bg-white px-3 py-2 text-xs font-black text-emerald-700" type="button" onClick={() => setShowAI(true)}>
                  Abrir de nuevo
                </button>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="whitespace-pre-wrap text-sm font-semibold leading-7 text-slate-700">
                  {selected.aiAnalysis || "Aun no hay analisis IA para esta sesion. Genera uno para guardar lectura fisiologica, tecnica, alertas y proxima sesion recomendada."}
                </p>
                {selected.aiAnalysis ? (
                  <div className="mt-4 flex justify-end border-t border-slate-200 pt-4">
                    <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white" type="button" onClick={() => acknowledgeAI(selected)}>
                      Enterado
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section className="mt-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-black text-slate-900">Historial de sesiones</h2>
              <p className="text-sm font-bold text-slate-500">{activities.length} registros totales</p>
            </div>
            <div className="grid gap-3">
              {activities.map((activity) => {
                const strongest = [...activity.zoneTotals].sort((a, b) => b.seconds - a.seconds)[0];
                const aiLabel = activity.aiAnalysis ? (activity.aiAcknowledgedAt ? "IA leida" : "IA nueva") : "IA pendiente";
                return (
                  <article className={`rounded-lg border bg-white p-4 transition hover:border-blue-100 hover:shadow-md ${activity.id === selected.id ? "border-blue-200 shadow-sm" : "border-slate-200"}`} key={activity.id}>
                    <div className="grid gap-4 lg:grid-cols-[minmax(260px,1.2fr)_minmax(430px,1fr)_auto] lg:items-center">
                      <button className="flex min-w-0 items-center gap-3 text-left" type="button" onClick={() => viewActivity(activity)}>
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">
                          <AppIcon name={sport === "cycling" ? "cycling" : "running"} className="h-5 w-5" />
                        </span>
                        <span className="min-w-0">
                          <strong className="block truncate font-black text-slate-900">{activity.name}</strong>
                          <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">
                            {activity.date.slice(8, 10)}/{activity.date.slice(5, 7)}/{activity.date.slice(0, 4)} · {activity.source}{isSupportActivity(activity) ? " · Soporte/recuperacion" : ""}
                          </span>
                        </span>
                      </button>

                      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                        <div>
                          <p className="font-semibold text-slate-500">Distancia</p>
                          <p className="font-black text-slate-900">{activity.metrics.distanceKm.toFixed(2)} km</p>
                        </div>
                        <div>
                          <p className="font-semibold text-slate-500">Duracion</p>
                          <p className="font-black text-slate-900">{formatDuration(activity.metrics.durationSec)}</p>
                        </div>
                        <div>
                          <p className="font-semibold text-slate-500">{sport === "cycling" ? "Velocidad" : "Ritmo"}</p>
                          <p className="font-black text-slate-900">{sport === "cycling" ? metric(activity.metrics.avgSpeedKmh, "km/h") : metric(activity.metrics.pace, "/km")}</p>
                        </div>
                        <div>
                          <p className="font-semibold text-slate-500">FC promedio</p>
                          <p className="font-black text-slate-900">{metric(activity.metrics.avgHr, "bpm")}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
                        {strongest ? <ZoneBadge segment={strongest} /> : <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-500">Sin FC</span>}
                        <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-black text-green-700">Completada</span>
                        <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50" type="button" onClick={() => viewActivity(activity)}>Ver</button>
                        <button className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100" type="button" onClick={() => analyzeActivityFromHistory(activity)} disabled={aiLoadingId === activity.id}>{aiLoadingId === activity.id ? "..." : aiLabel}</button>
                        <button className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-600 hover:bg-red-100" type="button" onClick={() => deleteActivity(activity)}>Eliminar</button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
          </>
        )}
        {selected && expandedViewer ? (
          <div className="fixed inset-3 z-50 grid rounded-xl border border-slate-200 bg-white shadow-2xl md:inset-8">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-blue-600">{expandedViewer === "chart" ? "Visor de grafica" : "Visor de mapa"}</p>
                <h2 className="mt-1 text-lg font-black text-slate-900">{selected.name}</h2>
              </div>
              <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white" type="button" onClick={() => setExpandedViewer("")}>Cerrar</button>
            </div>
            <div className="min-h-0 overflow-y-auto p-4">
              {expandedViewer === "chart" ? (
                <ActivityMetricChart activity={selected} selectedIndex={safeChartPointIndex} onSelectedIndexChange={setChartPointIndex} expanded onExpand={() => setExpandedViewer("")} />
              ) : (
                <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <ActivityMap activity={selected} layer={layer} heatmap={heatmap} selectedPoint={mapPoint} expanded showMetricPanel={false} onExpand={() => setExpandedViewer("")} />
                  <aside className="grid content-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <MapLayerControls layer={layer} heatmap={heatmap} onLayerChange={setLayer} onHeatmapChange={setHeatmap} />
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-blue-600">Punto seleccionado</p>
                      <h3 className="mt-1 text-lg font-black text-slate-900">{mapPoint?.distanceKm.toFixed(2) || "0.00"} km</h3>
                      <p className="mt-1 text-xs font-bold text-slate-500">{pointTimeLabel(mapPoint, selected)} / {selected.metrics.distanceKm.toFixed(2)} km</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {pointMetricCards(selected, mapPoint).map(([label, value]) => (
                        <div className="rounded-lg bg-white p-3" key={label}>
                          <p className="text-[10px] font-black uppercase text-slate-400">{label}</p>
                          <p className="mt-1 text-sm font-black text-slate-900">{value}</p>
                        </div>
                      ))}
                    </div>
                    <div className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" type="button" onClick={() => setMapPointIndex(clampIndex(safeMapPointIndex - 1, selected.points.length))}>Anterior</button>
                        <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" type="button" onClick={() => setMapPointIndex(clampIndex(safeMapPointIndex + 1, selected.points.length))}>Siguiente</button>
                      </div>
                      <input aria-label="Recorrer puntos en visor de mapa" className="w-full accent-blue-600" max={selected.points.length - 1} min={0} type="range" value={safeMapPointIndex} onChange={(event) => setMapPointIndex(Number(event.target.value))} />
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="mb-3 text-xs font-black uppercase tracking-wide text-blue-600">Zonas FC</p>
                      <HeartZoneBars activity={selected} />
                    </div>
                    <p className="text-[11px] font-bold leading-5 text-slate-500">El zoom queda bajo control del usuario; al cambiar de punto solo se mueve el marcador.</p>
                  </aside>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
