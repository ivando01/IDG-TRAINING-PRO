const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();
const pool = require('./db');
const fs = require('fs');
const path = require('path');

console.log("ðŸ”¥ INICIANDO BACKEND...");

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origen no permitido por CORS"));
  },
}));
app.use(express.json({ limit: "25mb" }));

/* ================= CONFIG ================= */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "1046758819137-ao6ablnce565uj89bifcovh2jbfltjin.apps.googleusercontent.com";
const JWT_SECRET = process.env.JWT_SECRET;
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID || "232892";
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI = process.env.STRAVA_REDIRECT_URI || "http://localhost:3000/auth/strava/callback";
const STRAVA_WEBHOOK_VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
const FULL_ACCESS_EMAILS = new Set(
  String(process.env.IDG_FULL_ACCESS_EMAILS || process.env.FULL_ACCESS_EMAILS || "")
    .split(/[,\n;]/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);
const BETA_FULL_ACCESS = /^(1|true|yes|on)$/i.test(String(process.env.PUBLIC_BETA_FULL_ACCESS || process.env.BETA_FULL_ACCESS || ""));
const TRIAL_FULL_ACCESS_UNTIL = process.env.TRIAL_FULL_ACCESS_UNTIL || null;

if (!JWT_SECRET) {
  throw new Error("Falta JWT_SECRET en variables de entorno.");
}

if (!STRAVA_CLIENT_SECRET) {
  throw new Error("Falta STRAVA_CLIENT_SECRET en variables de entorno.");
}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const DATA_DIR = path.join(__dirname, 'data', 'profiles');

async function initDatabase() {
  const schema = await fs.promises.readFile(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeDatabaseTarget() {
  if (!process.env.DATABASE_URL) {
    return "PGHOST/PGDATABASE local config";
  }

  try {
    const url = new URL(process.env.DATABASE_URL);
    return `${url.protocol}//${url.username ? "<user>" : ""}@${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return "invalid DATABASE_URL";
  }
}

async function initDatabaseWithRetry() {
  const maxAttempts = Number(process.env.DB_INIT_RETRIES) || 3;
  const retryDelayMs = Number(process.env.DB_INIT_RETRY_DELAY_MS) || 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await initDatabase();
      return;
    } catch (error) {
      console.error(
        `No se pudo inicializar la base de datos (intento ${attempt}/${maxAttempts}, target ${describeDatabaseTarget()})`,
        error,
      );

      if (attempt === maxAttempts) {
        throw error;
      }

      await wait(retryDelayMs);
    }
  }
}

async function ensureWeeklyPlanTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weekly_plan (
      user_id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE weekly_plan ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE weekly_plan ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
}

async function getUserId(email, fallback = {}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  await pool.query(
    `INSERT INTO users (email, name, picture)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET
       name=COALESCE(EXCLUDED.name, users.name),
       picture=COALESCE(EXCLUDED.picture, users.picture),
       updated_at=now()`,
    [normalizedEmail, fallback.name || null, fallback.picture || null],
  );
  await applyConfiguredAccess(normalizedEmail);
  return normalizedEmail;
}

function validDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isFuture(value) {
  if (!value) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() > Date.now();
}

async function applyConfiguredAccess(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return;

  if (FULL_ACCESS_EMAILS.has(normalizedEmail)) {
    await pool.query(
      `UPDATE users
       SET plan='founder',
           coach_access=true,
           is_founder=true,
           full_access_until=NULL,
           updated_at=now()
       WHERE email=$1`,
      [normalizedEmail],
    );
    return;
  }

  if (BETA_FULL_ACCESS) {
    await pool.query(
      `UPDATE users
       SET plan=CASE WHEN is_founder THEN plan ELSE 'trial' END,
           coach_access=CASE WHEN is_founder THEN coach_access ELSE true END,
           full_access_until=CASE WHEN is_founder THEN full_access_until ELSE $2::timestamptz END,
           updated_at=now()
       WHERE email=$1`,
      [normalizedEmail, validDateOrNull(TRIAL_FULL_ACCESS_UNTIL)],
    );
  }
}

function accessPayload(userRow = {}, email = "") {
  const normalizedEmail = String(email || userRow.email || "").trim().toLowerCase();
  const founder = Boolean(userRow.is_founder || FULL_ACCESS_EMAILS.has(normalizedEmail));
  const until = userRow.full_access_until || null;
  const timedAccess = isFuture(until);
  const betaAccess = BETA_FULL_ACCESS && !founder;
  const coachAccess = Boolean(userRow.coach_access || founder || betaAccess || timedAccess);
  return {
    email: normalizedEmail,
    plan: founder ? "founder" : betaAccess ? "trial" : userRow.plan || "free",
    coachAccess,
    fullAccess: founder || coachAccess || timedAccess || betaAccess,
    isFounder: founder,
    betaFullAccess: betaAccess,
    fullAccessUntil: founder ? null : until,
  };
}

async function getUserAccess(email) {
  const userId = await getUserId(email);
  const result = await pool.query(
    `SELECT email, plan, coach_access, full_access_until, is_founder
     FROM users WHERE email=$1`,
    [userId],
  );
  return accessPayload(result.rows[0] || {}, userId);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function itemDate(item) {
  const value = item?.date || item?.startTime || item?.createdAt || item?.updatedAt || null;
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function numericOrNull(value, decimals = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(decimals));
}

function streamData(streams, key) {
  const data = streams?.[key]?.data;
  return Array.isArray(data) ? data : [];
}

function sampledIndexes(length, maxItems = 1200) {
  if (length <= maxItems) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / (maxItems - 1);
  return Array.from({ length: maxItems }, (_, index) => Math.round(index * step));
}

function stravaPointsFromStreams(summary, streams, sport) {
  const latlng = streamData(streams, "latlng");
  const time = streamData(streams, "time");
  const distance = streamData(streams, "distance");
  const altitude = streamData(streams, "altitude");
  const heartrate = streamData(streams, "heartrate");
  const cadence = streamData(streams, "cadence");
  const watts = streamData(streams, "watts");
  const velocity = streamData(streams, "velocity_smooth");
  const grade = streamData(streams, "grade_smooth");
  const temp = streamData(streams, "temp");
  const length = Math.max(latlng.length, time.length, distance.length, altitude.length, heartrate.length, velocity.length);
  const start = summary?.start_date ? new Date(summary.start_date).getTime() : Date.now();
  const maxHr = Number(summary?.max_heartrate) || null;

  return sampledIndexes(length).map((streamIndex) => {
    const coord = latlng[streamIndex];
    const hr = numericOrNull(heartrate[streamIndex], 0);
    const rawCadence = numericOrNull(cadence[streamIndex], 0);
    return {
      lat: Array.isArray(coord) ? numericOrNull(coord[0], 6) : undefined,
      lon: Array.isArray(coord) ? numericOrNull(coord[1], 6) : undefined,
      ele: numericOrNull(altitude[streamIndex], 1),
      time: Number.isFinite(Number(time[streamIndex])) ? start + Number(time[streamIndex]) * 1000 : undefined,
      distanceKm: Number.isFinite(Number(distance[streamIndex])) ? numericOrNull(Number(distance[streamIndex]) / 1000, 3) || 0 : 0,
      hr: hr && maxHr ? Math.min(hr, maxHr) : hr,
      cad: sport === "running" && rawCadence && rawCadence >= 40 && rawCadence <= 125 ? rawCadence * 2 : rawCadence,
      speedKmh: Number.isFinite(Number(velocity[streamIndex])) ? numericOrNull(Number(velocity[streamIndex]) * 3.6, 1) : null,
      power: sport === "cycling" ? numericOrNull(watts[streamIndex], 0) : null,
      temp: numericOrNull(temp[streamIndex], 0),
      gradePct: grade[streamIndex] === undefined || grade[streamIndex] === null ? null : numericOrNull(grade[streamIndex], 1),
    };
  });
}

function appActivityFromStravaRow(row, sport, streams = null) {
  const distanceKm = numericOrNull(row.distance_km, 3) || 0;
  const durationSec = Math.round((Number(row.duration_min) || Number(row.elapsed_min) || 0) * 60);
  const startMs = row.date ? new Date(row.date).getTime() : Date.now();
  const avgHr = numericOrNull(row.avg_hr, 0);
  const maxHr = numericOrNull(row.max_hr, 0);
  const streamPoints = streams ? stravaPointsFromStreams(row.raw_data || {}, streams, sport) : [];
  const points = streamPoints.length >= 2
    ? streamPoints
    : [
      { distanceKm: 0, time: startMs, hr: avgHr },
      { distanceKm, time: startMs + durationSec * 1000, hr: maxHr || avgHr },
    ];
  return {
    id: `strava-${row.external_id}`,
    sport,
    activityKind: "training",
    activitySubType: row.type || null,
    countsTowardTraining: true,
    source: "STRAVA",
    name: row.name || (sport === "cycling" ? "Actividad de ciclismo" : "Actividad de running"),
    date: row.date ? String(row.date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    startTime: row.date || null,
    points,
    metrics: {
      distanceKm,
      durationSec,
      movingSec: durationSec,
      avgSpeedKmh: numericOrNull(row.avg_speed_kmh, 1),
      maxSpeedKmh: numericOrNull(row.max_speed_kmh, 1),
      pace: null,
      avgPower: null,
      elevationGain: numericOrNull(row.elevation_m, 0) || 0,
      elevationLoss: 0,
      altitudeMax: null,
      altitudeMin: null,
      avgGradePct: null,
      avgHr,
      maxHr,
      avgCadence: null,
      strideMeters: null,
      vo2Estimate: null,
      calories: numericOrNull(row.calories, 0),
      normalizedPower: null,
      powerSource: "none",
      tss: null,
      intensityFactor: null,
      variabilityIndex: null,
    },
    zones: [],
    zoneTotals: [],
    zoneTimeline: [],
    notes: "",
    segments: [],
  };
}

function normalizeStravaActivity(activity, userId, sport) {
  const summary = activity?.summary || activity;
  const streams = activity?.streams || null;
  const externalId = String(summary.id);
  const activityDate = summary.start_date_local || summary.start_date || null;
  const distanceKm = summary.distance ? Number(summary.distance) / 1000 : null;
  const durationMin = summary.moving_time ? Number(summary.moving_time) / 60 : null;
  const elapsedMin = summary.elapsed_time ? Number(summary.elapsed_time) / 60 : null;
  const row = {
    id: `strava-${externalId}`,
    user_id: userId,
    sport,
    source: "strava",
    external_id: externalId,
    type: summary.sport_type || summary.type || null,
    name: summary.name || null,
    date: activityDate,
    activity_date: itemDate({ date: activityDate }),
    distance_km: numericOrNull(distanceKm, 3),
    duration_min: numericOrNull(durationMin, 2),
    elapsed_min: numericOrNull(elapsedMin, 2),
    elevation_m: numericOrNull(summary.total_elevation_gain, 1),
    avg_speed_kmh: summary.average_speed ? numericOrNull(Number(summary.average_speed) * 3.6, 2) : null,
    max_speed_kmh: summary.max_speed ? numericOrNull(Number(summary.max_speed) * 3.6, 2) : null,
    avg_hr: numericOrNull(summary.average_heartrate, 0),
    max_hr: numericOrNull(summary.max_heartrate, 0),
    calories: numericOrNull(summary.calories, 0),
    raw_data: summary,
  };
  return {
    ...row,
    data: appActivityFromStravaRow(row, sport, streams),
  };
}

async function saveStravaActivities(stravaActivities, userId, sport) {
  const rows = asArray(stravaActivities).map((activity) => normalizeStravaActivity(activity, userId, sport));
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const row of chunk) {
        await client.query(
          `INSERT INTO activities (
             id, user_id, sport, source, external_id, type, name, date,
             distance_km, duration_min, elapsed_min, elevation_m, avg_speed_kmh,
             max_speed_kmh, avg_hr, max_hr, calories, raw_data, activity_date, data, updated_at
           )
           VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8,
             $9, $10, $11, $12, $13,
             $14, $15, $16, $17, $18, $19, $20, now()
           )
           ON CONFLICT (user_id, source, external_id) DO UPDATE SET
             id=EXCLUDED.id,
             sport=EXCLUDED.sport,
             type=EXCLUDED.type,
             name=EXCLUDED.name,
             date=EXCLUDED.date,
             distance_km=EXCLUDED.distance_km,
             duration_min=EXCLUDED.duration_min,
             elapsed_min=EXCLUDED.elapsed_min,
             elevation_m=EXCLUDED.elevation_m,
             avg_speed_kmh=EXCLUDED.avg_speed_kmh,
             max_speed_kmh=EXCLUDED.max_speed_kmh,
             avg_hr=EXCLUDED.avg_hr,
             max_hr=EXCLUDED.max_hr,
             calories=EXCLUDED.calories,
             raw_data=EXCLUDED.raw_data,
             activity_date=EXCLUDED.activity_date,
             data=EXCLUDED.data,
             updated_at=now()`,
          [
            row.id, row.user_id, row.sport, row.source, row.external_id, row.type, row.name, row.date,
            row.distance_km, row.duration_min, row.elapsed_min, row.elevation_m, row.avg_speed_kmh,
            row.max_speed_kmh, row.avg_hr, row.max_hr, row.calories, row.raw_data, row.activity_date, row.data,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return rows.length;
}

async function replaceCollection({ table, userId, items, extra = () => ({ columns: [], values: [] }) }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
    for (const item of items) {
      const id = String(item?.id || `${table}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const additional = extra(item);
      const columns = ["id", "user_id", "data", ...additional.columns];
      const placeholders = columns.map((_, index) => `$${index + 1}`);
      const values = [id, userId, item, ...additional.values];
      await client.query(
        `INSERT INTO ${table} (${columns.join(", ")}, updated_at)
         VALUES (${placeholders.join(", ")}, now())`,
        values,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function profilePath(email) {
  const safeEmail = String(email || 'user').replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
  return path.join(DATA_DIR, `${safeEmail}.json`);
}

async function getStravaCredentials(email) {
  const result = await pool.query(
    `SELECT strava_access_token, strava_refresh_token, strava_expires_at, strava_id
     FROM users WHERE email=$1`,
    [email]
  );

  const user = result.rows[0];
  if (!user?.strava_access_token) return null;

  const expiresAt = Number(user.strava_expires_at || 0);
  const shouldRefresh = user.strava_refresh_token && expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + 120;
  if (!shouldRefresh) return user;

  const response = await axios.post("https://www.strava.com/oauth/token", {
    client_id: STRAVA_CLIENT_ID,
    client_secret: STRAVA_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: user.strava_refresh_token,
  });

  const { access_token, refresh_token, expires_at } = response.data;
  await pool.query(
    `UPDATE users SET strava_access_token=$1, strava_refresh_token=$2, strava_expires_at=$3 WHERE email=$4`,
    [access_token, refresh_token, expires_at, email]
  );

  return {
    ...user,
    strava_access_token: access_token,
    strava_refresh_token: refresh_token,
    strava_expires_at: expires_at,
  };
}

function isSportMatch(activity, sport) {
  const sportType = String(activity.sport_type || activity.type || "").toLowerCase();
  const name = String(activity.name || "").toLowerCase();
  const text = `${sportType} ${name}`;
  if (sport === "running") {
    if (/\b(walk|hike|caminar|caminata|senderismo)\b/.test(text)) return false;
    return ["run", "trailrun", "virtualrun", "carrera", "correr"].some((keyword) => text.includes(keyword));
  }
  if (sport === "cycling") {
    return [
      "ride",
      "bike",
      "cycling",
      "bicicleta",
      "ciclismo",
      "ciclistica",
      "ciclÃ­stica",
      "vuelta",
    ].some((keyword) => text.includes(keyword));
  }
  return true;
}

function sportFromStravaActivity(activity) {
  if (isSportMatch(activity, "running")) return "running";
  if (isSportMatch(activity, "cycling")) return "cycling";
  return "";
}

function parseSyncAfter(value) {
  if (!value) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 100000000000 ? numeric : numeric * 1000;
  }
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function externalErrorDetail(error) {
  const status = error.response?.status;
  const data = error.response?.data;
  const providerMessage = typeof data === "string"
    ? data
    : data?.message || data?.error || data?.errors?.[0]?.message || error.message;

  if (status === 400 && String(providerMessage || "").toLowerCase().includes("refresh")) {
    return "Strava rechazo el refresh token. Desconecta Strava y vuelve a conectarlo.";
  }
  if (status === 401) {
    return "Strava rechazo el token de acceso. Vuelve a conectar Strava desde tu perfil.";
  }
  if (status === 403) {
    return "Strava no dio permisos suficientes. Reconecta Strava aceptando activity:read_all.";
  }
  if (status === 429) {
    return "Strava limito temporalmente las solicitudes. Intenta sincronizar de nuevo mas tarde.";
  }
  if (status) {
    return `Strava respondio ${status}: ${providerMessage || "sin detalle"}`;
  }
  if (error.code) {
    return `Error de conexion/base de datos (${error.code}): ${error.message}`;
  }
  return error.message || "Error desconocido sincronizando Strava.";
}

function scopeSet(value) {
  return new Set(
    String(value || "")
      .split(/[,\s]+/)
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}

async function getUserByStravaId(stravaId) {
  const result = await pool.query(
    `SELECT email FROM users WHERE strava_id=$1`,
    [String(stravaId)],
  );
  return result.rows[0]?.email || null;
}

async function importStravaActivityForUser({ userId, credentials, activityId, summary = null }) {
  const streamsKeys = "time,latlng,distance,altitude,heartrate,cadence,watts,velocity_smooth,temp,grade_smooth";
  let detail = summary;
  let streams = null;

  if (!detail) {
    const detailResponse = await axios.get(`https://www.strava.com/api/v3/activities/${activityId}`, {
      headers: { Authorization: `Bearer ${credentials.strava_access_token}` },
    });
    detail = detailResponse.data;
  }

  const sport = sportFromStravaActivity(detail);
  if (!sport) {
    return { saved: 0, skipped: true, reason: "unsupported_sport", type: detail?.sport_type || detail?.type || null };
  }

  try {
    const streamsResponse = await axios.get(`https://www.strava.com/api/v3/activities/${activityId}/streams`, {
      headers: { Authorization: `Bearer ${credentials.strava_access_token}` },
      params: { keys: streamsKeys, key_by_type: true },
    });
    streams = streamsResponse.data;
  } catch (streamError) {
    console.error("No se pudo leer stream Strava", activityId, streamError.response?.data || streamError.message);
  }

  const saved = await saveStravaActivities([{ summary: detail, streams }], userId, sport);
  return { saved, skipped: false, sport };
}

async function processStravaWebhookEvent(event) {
  if (!event || typeof event !== "object") return;

  const objectType = String(event.object_type || "");
  const aspectType = String(event.aspect_type || "");
  const objectId = event.object_id ? String(event.object_id) : "";
  const ownerId = event.owner_id ? String(event.owner_id) : "";

  if (objectType === "athlete" && aspectType === "update" && event.updates?.authorized === "false") {
    await pool.query(
      `UPDATE users SET
        strava_id=NULL,
        strava_access_token=NULL,
        strava_refresh_token=NULL,
        strava_expires_at=NULL
       WHERE strava_id=$1`,
      [objectId],
    );
    console.log("Strava desautorizado por webhook", { athleteId: objectId });
    return;
  }

  if (objectType !== "activity" || !objectId || !ownerId) return;

  const userId = await getUserByStravaId(ownerId);
  if (!userId) {
    console.warn("Webhook Strava sin usuario local", { ownerId, objectId, aspectType });
    return;
  }

  if (aspectType === "delete") {
    await pool.query(
      `DELETE FROM activities WHERE user_id=$1 AND source='strava' AND external_id=$2`,
      [userId, objectId],
    );
    console.log("Actividad Strava eliminada por webhook", { userId, objectId });
    return;
  }

  if (aspectType !== "create" && aspectType !== "update") return;

  const credentials = await getStravaCredentials(userId);
  if (!credentials) {
    console.warn("Webhook Strava sin credenciales activas", { userId, objectId });
    return;
  }

  const result = await importStravaActivityForUser({ userId, credentials, activityId: objectId });
  console.log("Actividad Strava procesada por webhook", { userId, objectId, aspectType, ...result });
}

function isRunningSupportActivity(activity) {
  const text = `${activity?.sport_type || ""} ${activity?.type || ""} ${activity?.activitySubType || ""} ${activity?.name || ""}`.toLowerCase();
  return /\b(walk|hike|caminar|caminata|senderismo)\b/.test(text);
}

async function deleteRunningSupportActivities(userId) {
  await pool.query(
    `DELETE FROM activities
     WHERE user_id=$1
       AND sport='running'
       AND source='strava'
       AND (
         lower(coalesce(type, '')) LIKE '%walk%'
         OR lower(coalesce(type, '')) LIKE '%hike%'
         OR lower(coalesce(name, '')) LIKE '%walk%'
         OR lower(coalesce(name, '')) LIKE '%hike%'
         OR lower(coalesce(name, '')) LIKE '%caminar%'
         OR lower(coalesce(name, '')) LIKE '%caminata%'
         OR lower(coalesce(name, '')) LIKE '%senderismo%'
         OR lower(coalesce(data->>'activitySubType', '')) LIKE '%walk%'
         OR lower(coalesce(data->>'activitySubType', '')) LIKE '%hike%'
       )`,
    [userId],
  );
}

/* ================= TEST ================= */

app.get('/', (req, res) => {
  res.send('API IDG funcionando ðŸš€');
});

/* ================= LOGIN GOOGLE ================= */

app.post('/auth/google', async (req, res) => {
  try {
    const { token } = req.body;

    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { name, email, picture } = payload;

    const userId = await getUserId(email, { name, picture });
    const access = await getUserAccess(userId);

    const tokenJWT = jwt.sign(
      { email: userId, name },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      user: { name, email: userId, picture },
      token: tokenJWT,
      access,
    });

  } catch (error) {
    console.error(error);
    res.status(401).json({ error: "Login fallido" });
  }
});

/* ================= MIDDLEWARE ================= */

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Token requerido" });

  const token = auth.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Token invÃ¡lido" });
  }
}

/* ================= ACCESO ================= */

app.get('/access', authMiddleware, async (req, res) => {
  try {
    const access = await getUserAccess(req.user.email);
    res.json({ access });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo leer el acceso del usuario" });
  }
});

app.post('/auth/supabase', async (req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: "Supabase no esta configurado en Render" });
    }
    const auth = req.headers.authorization || "";
    const supabaseToken = auth.split(" ")[1];
    if (!supabaseToken) return res.status(401).json({ error: "Sesion de Supabase requerida" });

    const userResponse = await axios.get(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${supabaseToken}`,
      },
    });
    const user = userResponse.data || {};
    const email = String(user.email || "").toLowerCase();
    if (!email) return res.status(401).json({ error: "Supabase no devolvio email del usuario" });

    const metadata = user.user_metadata || {};
    const name = metadata.name || metadata.full_name || email;
    const picture = metadata.avatar_url || metadata.picture || "";
    const userId = await getUserId(email, { name, picture });
    const access = await getUserAccess(userId);
    const tokenJWT = jwt.sign({ email: userId, name }, JWT_SECRET, { expiresIn: "7d" });

    res.json({
      user: { name, email: userId, picture },
      token: tokenJWT,
      access,
    });
  } catch (error) {
    console.error("Login Supabase fallido", error.response?.data || error.message);
    res.status(401).json({ error: "Login Supabase fallido" });
  }
});

/* ================= PERFIL ================= */

app.get('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const access = await getUserAccess(userId);
    const profile = await pool.query(`SELECT data, updated_at FROM user_profiles WHERE user_id=$1`, [userId]);
    res.json({ user: req.user, access, profile: profile.rows[0]?.data || null, updatedAt: profile.rows[0]?.updated_at || null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo leer el perfil" });
  }
});

app.get('/profile/data', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const result = await pool.query(`SELECT data, updated_at FROM user_profiles WHERE user_id=$1`, [userId]);
    res.json({ profile: result.rows[0]?.data || null, updatedAt: result.rows[0]?.updated_at || null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo leer el perfil" });
  }
});

app.put('/profile/data', authMiddleware, async (req, res) => {
  try {
    const profile = req.body?.profile;

    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      return res.status(400).json({ error: "Perfil invÃ¡lido" });
    }

    const userId = await getUserId(req.user.email, req.user);
    const payload = {
      ...profile,
      email: req.user.email,
      updatedAt: new Date().toISOString(),
    };

    await pool.query(
      `INSERT INTO user_profiles (user_id, data, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`,
      [userId, payload],
    );
    res.json({ ok: true, profile: payload });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo guardar el perfil" });
  }
});

app.put('/profile', authMiddleware, async (req, res) => {
  try {
    const profile = asObject(req.body?.profile || req.body);
    const userId = await getUserId(req.user.email, req.user);
    const payload = {
      ...profile,
      email: req.user.email,
      updatedAt: new Date().toISOString(),
    };
    await pool.query(
      `INSERT INTO user_profiles (user_id, data, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`,
      [userId, payload],
    );
    res.json({ ok: true, profile: payload });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo guardar el perfil" });
  }
});

/* ================= SINCRONIZACION ================= */

app.get('/gym/sessions', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const result = await pool.query(
      `SELECT data FROM gym_sessions WHERE user_id=$1 ORDER BY session_date DESC NULLS LAST, updated_at DESC`,
      [userId],
    );
    res.json({ sessions: result.rows.map((row) => row.data) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron leer las sesiones de gimnasio" });
  }
});

app.put('/gym/sessions', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const sessions = asArray(req.body?.sessions);
    if (!sessions.length) {
      const result = await pool.query(
        `SELECT data FROM gym_sessions WHERE user_id=$1 ORDER BY session_date DESC NULLS LAST, updated_at DESC`,
        [userId],
      );
      return res.json({ ok: true, preserved: true, sessions: result.rows.map((row) => row.data) });
    }
    for (const item of sessions) {
      const id = String(item.id || `gym-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await pool.query(
        `INSERT INTO gym_sessions (id, user_id, session_date, data, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (user_id, id) DO UPDATE SET
           session_date=EXCLUDED.session_date,
           data=EXCLUDED.data,
           updated_at=now()`,
        [id, userId, itemDate(item), { ...item, id }],
      );
    }
    res.json({ ok: true, sessions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron guardar las sesiones de gimnasio" });
  }
});

app.delete('/gym/sessions/:id', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    await pool.query(`DELETE FROM gym_sessions WHERE user_id=$1 AND id=$2`, [userId, req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo eliminar la sesion de gimnasio" });
  }
});

app.get('/gym/templates', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const result = await pool.query(
      `SELECT data FROM gym_templates WHERE user_id=$1 ORDER BY updated_at DESC`,
      [userId],
    );
    res.json({ templates: result.rows.map((row) => row.data) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron leer las plantillas de gimnasio" });
  }
});

app.put('/gym/templates', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const templates = asArray(req.body?.templates);
    if (!templates.length) {
      const result = await pool.query(
        `SELECT data FROM gym_templates WHERE user_id=$1 ORDER BY updated_at DESC`,
        [userId],
      );
      return res.json({ ok: true, preserved: true, templates: result.rows.map((row) => row.data) });
    }
    for (const item of templates) {
      const id = String(item.id || `template-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await pool.query(
        `INSERT INTO gym_templates (id, user_id, data, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id, id) DO UPDATE SET
           data=EXCLUDED.data,
           updated_at=now()`,
        [id, userId, { ...item, id }],
      );
    }
    res.json({ ok: true, templates });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron guardar las plantillas de gimnasio" });
  }
});

app.delete('/gym/templates/:id', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    await pool.query(`DELETE FROM gym_templates WHERE user_id=$1 AND id=$2`, [userId, req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo eliminar la plantilla de gimnasio" });
  }
});

app.get('/activities', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const sport = req.query.sport === "cycling" ? "cycling" : req.query.sport === "running" ? "running" : null;
    const params = sport ? [userId, sport] : [userId];
    const result = await pool.query(
      `SELECT data FROM activities WHERE user_id=$1 ${sport ? "AND sport=$2" : ""} ORDER BY activity_date DESC NULLS LAST, updated_at DESC`,
      params,
    );
    const activities = result.rows
      .map((row) => row.data)
      .filter((activity) => sport !== "running" || !isRunningSupportActivity(activity));
    res.json({ activities });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron leer las actividades" });
  }
});

app.put('/activities', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const sport = req.body?.sport === "cycling" ? "cycling" : req.body?.sport === "running" ? "running" : null;
    const activities = asArray(req.body?.activities);
    if (!activities.length && req.body?.allowEmpty !== true) {
      const params = sport ? [userId, sport] : [userId];
      const result = await pool.query(
        `SELECT data FROM activities WHERE user_id=$1 ${sport ? "AND sport=$2" : ""} ORDER BY activity_date DESC NULLS LAST, updated_at DESC`,
        params,
      );
      const preserved = result.rows
        .map((row) => row.data)
        .filter((activity) => sport !== "running" || !isRunningSupportActivity(activity));
      return res.json({ ok: true, preserved: true, activities: preserved });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (sport) await client.query(`DELETE FROM activities WHERE user_id=$1 AND sport=$2`, [userId, sport]);
      else await client.query(`DELETE FROM activities WHERE user_id=$1`, [userId]);
      for (const item of activities) {
        const itemSport = item?.sport === "cycling" ? "cycling" : item?.sport === "running" ? "running" : sport;
        if (!itemSport) continue;
        if (itemSport === "running" && isRunningSupportActivity(item)) continue;
        await client.query(
          `INSERT INTO activities (id, user_id, sport, source, activity_date, data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())`,
          [String(item.id || `${itemSport}-${Date.now()}`), userId, itemSport, item.source || null, itemDate(item), item],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.json({ ok: true, activities });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron guardar las actividades" });
  }
});

app.put('/activities/upsert', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const sport = req.body?.sport === "cycling" ? "cycling" : req.body?.sport === "running" ? "running" : null;
    const activities = asArray(req.body?.activities);
    const saved = [];
    for (const item of activities) {
      const itemSport = item?.sport === "cycling" ? "cycling" : item?.sport === "running" ? "running" : sport;
      if (!itemSport) continue;
      if (itemSport === "running" && isRunningSupportActivity(item)) continue;
      const id = String(item.id || `${itemSport}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const source = String(item.source || "").toLowerCase() === "strava" ? "strava" : item.source || null;
      const externalId = source === "strava"
        ? String(item.external_id || item.externalId || id.replace(/^strava-/, ""))
        : item.external_id || item.externalId || null;
      await pool.query(
        `INSERT INTO activities (id, user_id, sport, source, external_id, activity_date, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (user_id, id) DO UPDATE SET
           sport=EXCLUDED.sport,
           source=EXCLUDED.source,
           external_id=COALESCE(EXCLUDED.external_id, activities.external_id),
           activity_date=EXCLUDED.activity_date,
           data=EXCLUDED.data,
           updated_at=now()`,
        [id, userId, itemSport, source, externalId, itemDate(item), { ...item, id }],
      );
      saved.push(id);
    }
    res.json({ ok: true, saved: saved.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron actualizar las actividades" });
  }
});

app.delete('/activities/:id', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ error: "Falta id de actividad" });
    const result = await pool.query(
      `DELETE FROM activities WHERE user_id=$1 AND id=$2`,
      [userId, id],
    );
    res.json({ ok: true, deleted: result.rowCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo eliminar la actividad" });
  }
});

app.get('/weight', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const result = await pool.query(
      `SELECT data FROM weight_records WHERE user_id=$1 ORDER BY record_date DESC NULLS LAST, updated_at DESC`,
      [userId],
    );
    res.json({ records: result.rows.map((row) => row.data) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron leer los registros de peso" });
  }
});

app.put('/weight', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const records = asArray(req.body?.records);
    await replaceCollection({
      table: "weight_records",
      userId,
      items: records,
      extra: (item) => ({ columns: ["record_date"], values: [itemDate(item)] }),
    });
    res.json({ ok: true, records });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron guardar los registros de peso" });
  }
});

app.get('/sleep', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const result = await pool.query(
      `SELECT data FROM sleep_records WHERE user_id=$1 ORDER BY record_date DESC NULLS LAST, updated_at DESC`,
      [userId],
    );
    res.json({ records: result.rows.map((row) => row.data) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron leer los registros de sueno" });
  }
});

app.put('/sleep', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const records = asArray(req.body?.records);
    await replaceCollection({
      table: "sleep_records",
      userId,
      items: records,
      extra: (item) => ({ columns: ["record_date"], values: [itemDate(item)] }),
    });
    res.json({ ok: true, records });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron guardar los registros de sueno" });
  }
});

app.get('/goals', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const result = await pool.query(
      `SELECT data FROM goals WHERE user_id=$1 ORDER BY goal_date DESC NULLS LAST, updated_at DESC`,
      [userId],
    );
    res.json({ goals: result.rows.map((row) => row.data) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron leer las metas" });
  }
});

app.put('/goals', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const goals = asArray(req.body?.goals);
    await replaceCollection({
      table: "goals",
      userId,
      items: goals,
      extra: (item) => ({ columns: ["goal_date"], values: [itemDate({ date: item.deadline || item.date })] }),
    });
    res.json({ ok: true, goals });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron guardar las metas" });
  }
});

app.get('/plan', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    await ensureWeeklyPlanTable();
    const result = await pool.query(`SELECT data, updated_at FROM weekly_plan WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1`, [userId]);
    res.json({ plan: result.rows[0]?.data || [], updatedAt: result.rows[0]?.updated_at || null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo leer el plan semanal" });
  }
});

app.put('/plan', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    await ensureWeeklyPlanTable();
    const plan = asArray(req.body?.plan);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM weekly_plan WHERE user_id=$1`, [userId]);
      await client.query(
        `INSERT INTO weekly_plan (user_id, data, updated_at)
         VALUES ($1, $2, now())`,
        [userId, JSON.stringify(plan)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.json({ ok: true, plan });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo guardar el plan semanal" });
  }
});

app.get('/intelligence', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const result = await pool.query(
      `SELECT data FROM intelligence_entries WHERE user_id=$1 ORDER BY updated_at DESC`,
      [userId],
    );
    res.json({ entries: result.rows.map((row) => row.data) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo leer IDG Intelligence" });
  }
});

app.put('/intelligence', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const entries = asArray(req.body?.entries);
    await replaceCollection({
      table: "intelligence_entries",
      userId,
      items: entries,
      extra: (item) => ({ columns: ["entry_type"], values: [item.type || item.entry_type || "global"] }),
    });
    res.json({ ok: true, entries });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo guardar IDG Intelligence" });
  }
});

/* ================= STRAVA ================= */

app.get('/strava/webhook', (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (!STRAVA_WEBHOOK_VERIFY_TOKEN) {
    return res.status(500).json({ error: "Falta STRAVA_WEBHOOK_VERIFY_TOKEN" });
  }

  if (mode === "subscribe" && token === STRAVA_WEBHOOK_VERIFY_TOKEN && challenge) {
    return res.json({ "hub.challenge": challenge });
  }

  res.status(403).json({ error: "Verificacion Strava invalida" });
});

app.post('/strava/webhook', (req, res) => {
  const event = req.body;
  res.status(200).json({ ok: true });

  setImmediate(() => {
    processStravaWebhookEvent(event).catch((error) => {
      console.error("No se pudo procesar webhook Strava", {
        event,
        detail: externalErrorDetail(error),
        status: error.response?.status,
        data: error.response?.data,
        code: error.code,
        message: error.message,
      });
    });
  });
});

// RedirecciÃ³n
app.get('/auth/strava', (req, res) => {
  const { token } = req.query;
  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).send("Token invalido o expirado. Inicia sesion con Google nuevamente antes de conectar Strava.");
  }

  const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${STRAVA_REDIRECT_URI}&scope=read,activity:read_all&approval_prompt=force&state=${token}`;

  res.redirect(url);
});

// Callback
app.get('/auth/strava/callback', async (req, res) => {
  const { code, state, scope } = req.query;

  try {
    const decoded = jwt.verify(state, JWT_SECRET);
    const email = decoded.email;

    const response = await axios.post(
      "https://www.strava.com/oauth/token",
      {
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }
    );

    const { access_token, refresh_token, expires_at, athlete } = response.data;
    const grantedScopes = scopeSet(response.data.scope || scope);
    if (!grantedScopes.has("activity:read_all")) {
      return res.status(403).send(
        "Strava conectado sin permiso de actividades privadas. Vuelve a conectar Strava y marca el permiso para leer todas tus actividades.",
      );
    }

    await pool.query(
      `UPDATE users SET
        strava_id=$1,
        strava_access_token=$2,
        strava_refresh_token=$3,
        strava_expires_at=$4
       WHERE email=$5`,
      [athlete.id, access_token, refresh_token, expires_at, email]
    );

    console.log("âœ… Strava conectado:", email);

    res.send("Strava conectado. Puedes volver a la app.");

  } catch (err) {
    console.error(err);
    res.status(401).send("Token invalido o expirado. Inicia sesion con Google nuevamente antes de conectar Strava.");
  }
});

/* ================= ACTIVIDADES ================= */

app.get('/strava/activities', authMiddleware, async (req, res) => {
  const credentials = await getStravaCredentials(req.user.email);

  if (!credentials) return res.json({ error: "Strava no conectado" });

  const response = await axios.get(
    "https://www.strava.com/api/v3/athlete/activities",
    {
      headers: { Authorization: `Bearer ${credentials.strava_access_token}` },
      params: {
        per_page: Math.min(Number(req.query.per_page) || 30, 100),
        page: Number(req.query.page) || 1,
      },
    }
  );

  res.json(response.data);
});

app.get('/strava/status', authMiddleware, async (req, res) => {
  try {
    const credentials = await getStravaCredentials(req.user.email);
    let athlete = null;
    if (credentials?.strava_access_token) {
      try {
        const athleteResponse = await axios.get("https://www.strava.com/api/v3/athlete", {
          headers: { Authorization: `Bearer ${credentials.strava_access_token}` },
        });
        athlete = {
          id: athleteResponse.data?.id || credentials?.strava_id || null,
          username: athleteResponse.data?.username || null,
          firstname: athleteResponse.data?.firstname || null,
          lastname: athleteResponse.data?.lastname || null,
          city: athleteResponse.data?.city || null,
          country: athleteResponse.data?.country || null,
        };
      } catch (athleteError) {
        console.error("No se pudo leer atleta Strava", athleteError.response?.data || athleteError.message);
      }
    }
    res.json({
      connected: Boolean(credentials?.strava_access_token),
      athleteId: credentials?.strava_id || null,
      athlete,
      expiresAt: credentials?.strava_expires_at || null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo validar Strava" });
  }
});

app.get('/strava/sync', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const credentials = await getStravaCredentials(req.user.email);
    if (!credentials) return res.status(409).json({ error: "Strava no conectado" });

    const sport = req.query.sport === "cycling" ? "cycling" : req.query.sport === "running" ? "running" : "";
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 120);
    const cutoffMs = Date.now() - days * 86400000;
    let afterMs = cutoffMs;
    const requestedAfterMs = parseSyncAfter(req.query.afterSaved || req.query.after);
    if (sport) {
      if (sport === "running") {
        await deleteRunningSupportActivities(userId);
      }
      const latestResult = await pool.query(
        `SELECT MAX(COALESCE(activity_date, date)) AS latest_date
         FROM activities
         WHERE user_id=$1 AND sport=$2`,
        [userId, sport],
      );
      const latestMs = latestResult.rows[0]?.latest_date ? new Date(latestResult.rows[0].latest_date).getTime() : 0;
      afterMs = Math.max(cutoffMs, requestedAfterMs, Number.isFinite(latestMs) && latestMs > 0 ? latestMs + 1000 : 0);
    }
    const after = Math.floor(afterMs / 1000);
    const excluded = new Set(
      String(req.query.exclude || "")
        .split(",")
        .map((id) => id.replace(/^strava-/, "").trim())
        .filter(Boolean)
    );
    const fetched = [];
    for (let page = 1; page <= 3 && fetched.length < 300; page += 1) {
      const activitiesResponse = await axios.get("https://www.strava.com/api/v3/athlete/activities", {
        headers: { Authorization: `Bearer ${credentials.strava_access_token}` },
        params: { per_page: 100, page, after },
      });
      const batch = Array.isArray(activitiesResponse.data) ? activitiesResponse.data : [];
      fetched.push(...batch);
      if (batch.length < 100) break;
    }

    const inRange = fetched.filter((activity) => {
      const dateMs = activity.start_date ? new Date(activity.start_date).getTime() : 0;
      return dateMs >= afterMs;
    });

    const candidates = fetched
      .filter((activity) => inRange.some((inRangeActivity) => String(inRangeActivity.id) === String(activity.id)))
      .filter((activity) => !sport || isSportMatch(activity, sport))
      .filter((activity) => !excluded.has(String(activity.id)))
      .slice(0, limit);

    const availableTypes = Array.from(new Set(fetched.map((activity) => activity.sport_type || activity.type).filter(Boolean)));
    const recent = fetched.slice(0, 12).map((activity) => ({
      id: activity.id,
      name: activity.name,
      type: activity.sport_type || activity.type,
      start_date: activity.start_date,
      distance_km: activity.distance ? Number((activity.distance / 1000).toFixed(2)) : 0,
      in_range: activity.start_date ? new Date(activity.start_date).getTime() >= afterMs : false,
      matched_sport: !sport || isSportMatch(activity, sport),
      already_registered: excluded.has(String(activity.id)),
    }));

    if (!candidates.length) {
      return res.json({
        sport,
        count: 0,
        days,
        after: new Date(afterMs).toISOString(),
        scanned: fetched.length,
        inRange: inRange.length,
        availableTypes,
        recent,
        activities: [],
      });
    }

    const streamsKeys = "time,latlng,distance,altitude,heartrate,cadence,watts,velocity_smooth,temp,grade_smooth";
    const enriched = [];
    const normalizedForStorage = [];
    for (const activity of candidates) {
      try {
        const [detailResponse, streamsResponse] = await Promise.all([
          axios.get(`https://www.strava.com/api/v3/activities/${activity.id}`, {
            headers: { Authorization: `Bearer ${credentials.strava_access_token}` },
          }),
          axios.get(`https://www.strava.com/api/v3/activities/${activity.id}/streams`, {
            headers: { Authorization: `Bearer ${credentials.strava_access_token}` },
            params: { keys: streamsKeys, key_by_type: true },
          }),
        ]);

        enriched.push({
          summary: detailResponse.data,
          streams: streamsResponse.data,
        });
        normalizedForStorage.push({ summary: detailResponse.data, streams: streamsResponse.data });
      } catch (streamError) {
        console.error("No se pudo leer stream Strava", activity.id, streamError.response?.data || streamError.message);
        enriched.push({ summary: activity, streams: null, streamError: true });
        normalizedForStorage.push({ summary: activity, streams: null });
      }
    }

    const saved = await saveStravaActivities(normalizedForStorage, userId, sport);
    res.json({ sport, days, after: new Date(afterMs).toISOString(), scanned: fetched.length, inRange: inRange.length, availableTypes, recent, count: enriched.length, saved, activities: enriched });
  } catch (error) {
    const detail = externalErrorDetail(error);
    console.error("No se pudo sincronizar Strava", {
      detail,
      status: error.response?.status,
      data: error.response?.data,
      code: error.code,
      message: error.message,
    });
    res.status(500).json({ error: "No se pudo sincronizar Strava", detail });
  }
});

app.delete('/strava/disconnect', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      `UPDATE users SET
        strava_id=NULL,
        strava_access_token=NULL,
        strava_refresh_token=NULL,
        strava_expires_at=NULL
       WHERE email=$1`,
      [req.user.email]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo desconectar Strava" });
  }
});

/* ================= IA PRO ================= */

app.get('/ai/analysis', authMiddleware, async (req, res) => {
  try {
    const { email } = req.user;

    const result = await pool.query(
      `SELECT strava_access_token FROM users WHERE email=$1`,
      [email]
    );

    const token = result.rows[0]?.strava_access_token;

    if (!token) {
      return res.json({ message: "Conecta Strava primero" });
    }

    const response = await axios.get(
      "https://www.strava.com/api/v3/athlete/activities",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const activities = response.data;

    // ðŸ”¥ Ãºltimos 7 dÃ­as
    const last7 = activities.filter(a => {
      const date = new Date(a.start_date);
      return (new Date() - date) <= 7 * 86400000;
    });

    let totalKm = 0;
    let totalTime = 0;
    let sessions = last7.length;

    last7.forEach(a => {
      totalKm += a.distance / 1000;
      totalTime += a.moving_time / 60;
    });

    const loadScore = totalKm * 1.2 + totalTime * 0.3;

    let loadLevel = "baja";
    if (loadScore > 300) loadLevel = "alta";
    else if (loadScore > 150) loadLevel = "media";

    let fatigue = "baja";
    if (sessions >= 5 && totalKm > 40) fatigue = "alta";
    else if (sessions >= 3) fatigue = "media";

    const disabledPrompt = `
Eres entrenador profesional.

Datos:
Km: ${totalKm.toFixed(1)}
Tiempo: ${totalTime.toFixed(0)} min
Sesiones: ${sessions}
Carga: ${loadLevel}
Fatiga: ${fatigue}

Responde EXACTO:

CARGA:
ESTADO:
RECOMENDACIÃ“N:
RIESGO:
`;

    const recommendation =
      fatigue === "alta"
        ? "Reduce intensidad 24-48h y prioriza sueÃ±o, movilidad y zona 2 suave."
        : loadLevel === "alta"
          ? "MantÃ©n volumen, pero evita sumar intensidad hasta estabilizar recuperaciÃ³n."
          : "Puedes progresar con una sesiÃ³n de calidad y una sesiÃ³n aerÃ³bica controlada.";

    const analysis = `CARGA: ${loadLevel.toUpperCase()}
ESTADO: Fatiga ${fatigue}
RECOMENDACIÃ“N: ${recommendation}
RIESGO: ${fatigue === "alta" ? "Elevado" : loadLevel === "alta" ? "Moderado" : "Bajo"}`;

    res.json({
      metrics: {
        km: totalKm,
        time: totalTime,
        sessions,
        load: loadLevel,
        fatigue,
      },
      analysis,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error IA PRO" });
  }
});

/* ================= START ================= */

const PORT = Number(process.env.PORT) || 3001;

initDatabaseWithRetry()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend IDG listo en puerto ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Backend detenido: no se pudo inicializar la base de datos", error);
    process.exit(1);
  });
