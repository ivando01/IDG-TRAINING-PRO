"use client";

import TopNav from "@/components/TopNav";
import { getCloudCollection, saveCloudCollection } from "@/lib/cloud-sync";
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

type StravaStream = { data?: unknown[] };

type StravaSyncedActivity = {
  summary: {
    id: number | string;
    name?: string;
    sport_type?: string;
    type?: string;
    start_date?: string;
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

function powerLabel(activity: ActivityAnalysis) {
  if (activity.sport !== "cycling") return "";
  if (activity.metrics.powerSource === "estimated") return "Potencia estimada por velocidad, pendiente y peso";
  if (activity.metrics.powerSource === "real") return "Potencia registrada por sensor";
  return "Sin datos de potencia";
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
  const streams = item.streams || {};
  const latlng = readStream<[number, number]>(streams, "latlng");
  const time = readStream<number>(streams, "time");
  const distance = readStream<number>(streams, "distance");
  const altitude = readStream<number>(streams, "altitude");
  const heartrate = readStream<number>(streams, "heartrate");
  const cadence = readStream<number>(streams, "cadence");
  const watts = readStream<number>(streams, "watts");
  const velocity = readStream<number>(streams, "velocity_smooth");
  const temp = readStream<number>(streams, "temp");
  const length = Math.max(latlng.length, time.length, distance.length, altitude.length, heartrate.length, velocity.length);
  const start = summary.start_date ? new Date(summary.start_date).getTime() : Date.now();
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
      hr: Number.isFinite(heartrate[index]) ? Number(heartrate[index]) : null,
      cad: normalizeCadenceValue(cad, sport, summary.name),
      speedKmh: Number.isFinite(velocity[index]) ? Number((Number(velocity[index]) * 3.6).toFixed(1)) : null,
      power: sport === "cycling" && Number.isFinite(watts[index]) ? Number(watts[index]) : null,
      temp: Number.isFinite(temp[index]) ? Number(temp[index]) : null,
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
    date: summary.start_date ? summary.start_date.slice(0, 10) : new Date().toISOString().slice(0, 10),
    startTime: summary.start_date,
    points,
    zones: getStoredZones(),
    notes: "",
  });

  return {
    ...parsed,
    metrics: {
      ...parsed.metrics,
      calories: summary.calories ? Math.round(summary.calories) : parsed.metrics.calories,
      avgPower: sport === "cycling" && summary.average_watts ? Math.round(summary.average_watts) : parsed.metrics.avgPower,
      normalizedPower: sport === "cycling" && summary.weighted_average_watts ? Math.round(summary.weighted_average_watts) : parsed.metrics.normalizedPower,
    },
  };
}

function compactActivityForStorage(activity: ActivityAnalysis): ActivityAnalysis {
  const maxPoints = activity.sport === "cycling" ? 900 : 1200;
  if (activity.points.length <= maxPoints) return activity;
  const step = activity.points.length / maxPoints;
  const points = Array.from({ length: maxPoints }, (_, index) => activity.points[Math.min(activity.points.length - 1, Math.round(index * step))]);
  return { ...activity, points };
}

function compactActivitiesForStorage(items: ActivityAnalysis[]) {
  return items.map(compactActivityForStorage);
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
    map.easeTo({
      center: lngLat,
      duration: 320,
      essential: true,
      offset: [0, expanded ? -12 : -18],
    });
  }, [expanded, selectedPoint]);

  const cards = pointMetricCards(activity, selectedPoint);

  return (
    <div className="grid gap-3">
      <div className="relative">
        <div ref={ref} className={`${expanded ? "h-[calc(100vh-190px)] min-h-[430px]" : "h-[340px] min-h-[280px] lg:h-[430px]"} w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100`} />
        {!expanded ? (
          <button className="absolute left-3 top-3 z-10 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs font-black text-slate-700 shadow-sm backdrop-blur hover:bg-white" type="button" onClick={onExpand}>
            Expandir mapa
          </button>
        ) : null}
      </div>
      {showMetricPanel && selectedPoint ? (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-7">
            {cards.map(([label, value]) => (
              <div key={label}>
                <p className="font-black uppercase text-slate-400">{label}</p>
                <p className="mt-1 font-black text-slate-900">{value}</p>
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
    const zone = activity.zones.find((item) => point.hr && point.hr >= item.min && point.hr < item.max);
    const color = zone?.color || (point.hr ? "#EF4444" : "#64748B");
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
    { key: "hr", label: "Frecuencia cardiaca", color: "#EF4444", unit: "bpm", values: activity.points.map((point) => point.hr) },
    { key: "pace", label: activity.sport === "cycling" ? "Velocidad" : "Ritmo", color: "#1D4ED8", unit: activity.sport === "cycling" ? "km/h" : "min/km", values: activity.points.map((point) => activity.sport === "cycling" ? point.speedKmh : point.speedKmh && point.speedKmh > 0.5 ? Number((60 / point.speedKmh).toFixed(2)) : null) },
    { key: "cad", label: "Cadencia", color: "#F97316", unit: activity.sport === "cycling" ? "rpm" : "ppm", values: activity.points.map((point) => point.cad) },
    activity.sport === "cycling" ? { key: "power", label: "Potencia", color: "#7C3AED", unit: "W", values: activity.points.map((point) => point.power) } : null,
  ];
  const options = rawOptions.filter((option): option is ChartOption => Boolean(option));
  const [active, setActive] = useState<string[]>(["ele", "hr"]);
  const selected = options.filter((option) => active.includes(option.key)).slice(0, 2);
  const points = activity.points;
  if (points.length < 2) return <div className="grid h-44 place-items-center text-sm font-bold text-slate-400">Sin datos de grafica</div>;
  const safeIndex = clampIndex(selectedIndex, points.length);
  const cursorPoint = points[safeIndex];
  const w = 900;
  const h = 300;
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,4fr)_minmax(180px,1fr)]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {pointMetricCards(activity, cursorPoint).slice(0, 4).map(([label, value]) => (
              <div className="rounded-lg bg-slate-50 px-3 py-2" key={label}>
                <p className="font-black uppercase text-slate-400">{label}</p>
                <p className="mt-1 font-black text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50" type="button" onClick={onExpand}>
            {expanded ? "Cerrar visor" : "Expandir grafica"}
          </button>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className={`${expanded ? "h-[280px] xl:h-[320px]" : "h-[300px]"} w-full touch-none overflow-visible`} onPointerDown={moveCursorFromPointer} onPointerMove={(event) => { if (event.buttons === 1) moveCursorFromPointer(event); }}>
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
        <div className={`${expanded ? "mt-2" : "mt-4"} grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3`}>
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
  const totalsByZone = new globalThis.Map(activity.zoneTotals.map((zone) => [zone.zoneKey, zone]));
  const zones = activity.zones.map((zone) => {
    const totalZone = totalsByZone.get(zone.key);
    return {
      zoneKey: zone.key,
      label: `${zone.key} ${zone.name}`,
      color: zone.color,
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
              <span className="truncate font-black text-slate-700" title={zone.label}>{zone.label}</span>
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

function ZoneTimeline({ activity }: { activity: ActivityAnalysis }) {
  const total = activity.zoneTimeline.reduce((sum, item) => sum + item.seconds, 0) || 1;
  const strongest = [...activity.zoneTotals].sort((a, b) => b.seconds - a.seconds)[0];
  const peaks = activity.zoneTimeline.filter((item) => item.zoneKey === "Z4" || item.zoneKey === "Z5").length;
  const last = activity.zoneTimeline.at(-1);
  const hasNoZone = activity.zoneTimeline.some((item) => item.zoneKey === "NA");
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-black text-slate-900">Comportamiento por zonas</h2>
        <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-slate-500">Por distancia</span>
      </div>
      <div className="mt-5">
        <div className="flex h-6 overflow-hidden rounded-md bg-slate-100">
          {activity.zoneTimeline.map((segment, index) => (
            <div
              key={`${segment.zoneKey}-${index}`}
              className="group relative min-w-[4px]"
              style={{ width: `${(segment.seconds / total) * 100}%`, backgroundColor: segment.color }}
              title={`${segment.label} | ${formatDuration(segment.seconds)} | FC ${segment.avgHr || "--"} | ${segment.range} | km ${segment.startKm.toFixed(1)}-${segment.endKm.toFixed(1)}`}
            />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs font-bold text-slate-500">
          <span>0 km</span>
          <span>{activity.metrics.distanceKm.toFixed(1)} km</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-slate-500">
          {activity.zones.map((zone) => (
            <span className="inline-flex items-center gap-1.5" key={zone.key}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: zone.color }} />
              {zone.key}
            </span>
          ))}
          {hasNoZone ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
              Sin FC / fuera de zona
            </span>
          ) : null}
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

  useEffect(() => {
    let alive = true;
    try {
      const saved = localStorage.getItem(storageKeyForSport(sport));
      const parsed = saved ? JSON.parse(saved) : [];
      const recalculated = Array.isArray(parsed) ? parsed.map(recalculateActivityZones) : [];
      setActivities(recalculated);
      localStorage.setItem(storageKeyForSport(sport), JSON.stringify(compactActivitiesForStorage(recalculated)));
      setSelectedId(recalculated[0]?.id || "");
    } catch {
      setActivities([]);
    }
    getCloudCollection<ActivityAnalysis>(`/activities?sport=${sport}`, "activities")
      .then((cloudActivities) => {
        if (!alive || !cloudActivities.length) return;
        const recalculated = cloudActivities.map(recalculateActivityZones);
        setActivities(recalculated);
        setSelectedId(recalculated[0]?.id || "");
        localStorage.setItem(storageKeyForSport(sport), JSON.stringify(compactActivitiesForStorage(recalculated)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sport]);

  const selected = useMemo(() => activities.find((activity) => activity.id === selectedId) || activities[0], [activities, selectedId]);

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
    const compact = compactActivitiesForStorage(next);
    setActivities(compact);
    try {
      localStorage.setItem(storageKeyForSport(sport), JSON.stringify(compact));
      saveCloudCollection("/activities", "activities", compact, { sport }).catch(() => undefined);
    } catch {
      const reduced = compact.slice(0, 20).map((activity) => ({
        ...activity,
        points: activity.points.filter((_, index) => index % 2 === 0),
      }));
      setActivities(reduced);
      localStorage.setItem(storageKeyForSport(sport), JSON.stringify(reduced));
      saveCloudCollection("/activities", "activities", reduced, { sport }).catch(() => undefined);
      setStatus("Se guardaron las actividades compactadas para no superar el limite local del navegador.");
    }
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
    setStatus("Sincronizando Strava: ultimos 15 dias, sesiones y actividades de soporte nuevas...");
    try {
      const existingStravaIds = activities
        .filter((activity) => activity.id.startsWith("strava-"))
        .map((activity) => activity.id.replace(/^strava-/, ""))
        .join(",");
      const params = new URLSearchParams({
        sport,
        days: "15",
        limit: "12",
      });
      if (existingStravaIds) params.set("exclude", existingStravaIds);
      const response = await fetch(`${apiUrl()}/strava/sync?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "No se pudo sincronizar Strava.");
      const imported = (data.activities || []).map((item: StravaSyncedActivity) => stravaToActivity(item, sport));
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
        setStatus(`Strava conectado: no hay sesiones nuevas de ${sport === "cycling" ? "ciclismo" : "running"} en los ultimos ${data.days || 15} dias.${scanned}${types}${recent}`);
        return;
      }
      const next = [
        ...imported,
        ...activities.filter((activity) => !imported.some((item: ActivityAnalysis) => item.id === activity.id)),
      ].slice(0, 20);
      saveActivities(next);
      setSelectedId(imported[0].id);
      setStatus(`${imported.length} actividades nuevas sincronizadas desde Strava en los ultimos ${data.days || 15} dias. Las caminatas quedan como soporte y no suman al acumulado de running.`);
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
                ]).map(([label, value, unit]) => (
                  <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2" key={label} title={label === "Potencia" && sport === "cycling" ? powerLabel(selected) : String(label)}>
                    <p className="truncate text-[10px] font-black uppercase tracking-wide text-[#64748B]">{label}</p>
                    <p className="mt-0.5 text-lg font-black leading-tight text-[#0F172A] xl:text-xl">{metric(value, String(unit))}</p>
                  </div>
                ))}
              </div>
              {sport === "cycling" ? <p className="mt-2 text-[11px] font-bold text-slate-400">{powerLabel(selected)}</p> : null}
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
              <section className="relative overflow-hidden rounded-lg border border-[#E2E8F0] bg-white p-3">
                <ActivityMap activity={selected} layer={layer} heatmap={heatmap} selectedPoint={mapPoint} onExpand={() => setExpandedViewer("map")} />
                <div className="mt-3 grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" type="button" onClick={() => setMapPointIndex(clampIndex(safeMapPointIndex - 1, selected.points.length))}>Punto anterior</button>
                    <span className="text-xs font-black text-slate-500">{mapPoint?.distanceKm.toFixed(2) || "0.00"} km</span>
                    <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" type="button" onClick={() => setMapPointIndex(clampIndex(safeMapPointIndex + 1, selected.points.length))}>Punto siguiente</button>
                  </div>
                  <input aria-label="Recorrer puntos sobre el mapa" className="w-full accent-blue-600" max={selected.points.length - 1} min={0} type="range" value={safeMapPointIndex} onChange={(event) => setMapPointIndex(Number(event.target.value))} />
                </div>
                <div className="absolute right-4 top-4 w-36 rounded-lg border border-slate-200 bg-white/95 p-3 backdrop-blur">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Capas</p>
                  <div className="mt-2 grid gap-2">
                    {(Object.keys(layerLabels) as LayerKey[]).map((key) => (
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700" key={key}>
                        <input type="radio" checked={layer === key} onChange={() => setLayer(key)} />
                        {layerLabels[key]}
                      </label>
                    ))}
                  </div>
                  <label className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs font-bold text-slate-700">
                    Heatmap
                    <input type="checkbox" checked={heatmap} onChange={(event) => setHeatmap(event.target.checked)} />
                  </label>
                </div>
              </section>

              <aside className="rounded-lg border border-[#E2E8F0] bg-white p-5">
                <p className="text-xs font-black uppercase tracking-wide text-blue-600">Analisis de zonas</p>
                <h2 className="mt-1 text-lg font-black text-slate-900">Distribucion cardiaca</h2>
                <p className="mt-1 text-xs font-bold leading-5 text-slate-500">Tiempo acumulado por zona para entender la carga real de la sesion.</p>
                <div className="mt-5">
                  <HeartZoneBars activity={selected} />
                </div>
              </aside>
            </div>

            <ZoneTimeline activity={selected} />

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

          <section className="mt-5 rounded-lg border border-[#E2E8F0] bg-white p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-900">Historial de sesiones</h2>
                <p className="text-sm font-semibold text-slate-500">{activities.length} actividades importadas - cada fila conserva su analisis IA</p>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <div className="min-w-[920px]">
                <div className="grid grid-cols-[96px_1.4fr_86px_86px_86px_86px_120px_132px] gap-3 border-b border-slate-100 px-3 pb-2 text-xs font-black uppercase tracking-wide text-slate-400">
                  <span>Fecha</span>
                  <span>Sesion</span>
                  <span>Distancia</span>
                  <span>Tiempo</span>
                  <span>{sport === "cycling" ? "Velocidad" : "Ritmo"}</span>
                  <span>FC</span>
                  <span>Zonas</span>
                  <span className="text-right">Acciones</span>
                </div>
                <div className="grid gap-2 pt-2">
                  {activities.map((activity) => {
                    const strongest = [...activity.zoneTotals].sort((a, b) => b.seconds - a.seconds)[0];
                    const aiLabel = activity.aiAnalysis ? (activity.aiAcknowledgedAt ? "IA leida" : "IA pendiente") : "Sin analisis IA";
                    return (
                      <div className={`grid grid-cols-[96px_1.4fr_86px_86px_86px_86px_120px_132px] items-center gap-3 rounded-lg border px-3 py-3 text-sm transition ${activity.id === selected.id ? "border-blue-200 bg-blue-50/50" : "border-slate-100 bg-white hover:bg-slate-50"}`} key={activity.id}>
                        <div>
                          <p className="font-black text-slate-900">{activity.date.slice(8, 10)}</p>
                          <p className="text-xs font-bold uppercase text-slate-400">{activity.date.slice(5, 7)}/{activity.date.slice(0, 4)}</p>
                        </div>
                        <button className="text-left" type="button" onClick={() => viewActivity(activity)}>
                          <p className="font-black text-slate-900">{activity.name}</p>
                          <p className="text-xs font-bold text-slate-500">{activity.source} - {isSupportActivity(activity) ? "Soporte/recuperacion - " : ""}{aiLabel}</p>
                        </button>
                        <span className="font-black text-slate-900">{activity.metrics.distanceKm.toFixed(2)} km</span>
                        <span className="font-bold text-slate-700">{formatDuration(activity.metrics.durationSec)}</span>
                        <span className="font-bold text-slate-700">{sport === "cycling" ? metric(activity.metrics.avgSpeedKmh, "km/h") : metric(activity.metrics.pace, "/km")}</span>
                        <span className="font-bold text-slate-700">{metric(activity.metrics.avgHr, "bpm")}</span>
                        <div className="flex items-center gap-2">
                          {strongest ? <ZoneBadge segment={strongest} /> : <span className="text-xs font-bold text-slate-400">Sin FC</span>}
                          <span className={`text-xs font-bold ${activity.aiAnalysis && !activity.aiAcknowledgedAt ? "text-blue-600" : "text-slate-500"}`}>{activity.aiAnalysis ? (activity.aiAcknowledgedAt ? "IA leida" : "IA nueva") : "Generar IA"}</span>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button className="rounded-lg border border-slate-200 px-2 py-2 text-xs font-black text-slate-700" type="button" onClick={() => viewActivity(activity)}>Ver</button>
                          <button className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-2 text-xs font-black text-blue-700" type="button" onClick={() => analyzeActivityFromHistory(activity)} disabled={aiLoadingId === activity.id}>{aiLoadingId === activity.id ? "..." : activity.aiAnalysis ? "Ver IA" : "IA"}</button>
                          <button className="rounded-lg border border-red-200 bg-red-50 px-2 py-2 text-xs font-black text-red-600" type="button" onClick={() => deleteActivity(activity)}>Eliminar</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
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
                <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
                  <ActivityMap activity={selected} layer={layer} heatmap={heatmap} selectedPoint={mapPoint} expanded showMetricPanel={false} onExpand={() => setExpandedViewer("")} />
                  <aside className="grid content-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
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
                    <p className="text-[11px] font-bold leading-5 text-slate-500">El zoom queda bajo control del usuario; al cambiar de punto solo se recentra el mapa.</p>
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
