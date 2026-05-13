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
app.use(express.json());

/* ================= CONFIG ================= */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "1046758819137-ao6ablnce565uj89bifcovh2jbfltjin.apps.googleusercontent.com";
const JWT_SECRET = process.env.JWT_SECRET;

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID || "232892";
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI = process.env.STRAVA_REDIRECT_URI || "http://localhost:3000/auth/strava/callback";

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

async function getUserId(email, fallback = {}) {
  await pool.query(
    `INSERT INTO users (email, name, picture)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET
       name=COALESCE(EXCLUDED.name, users.name),
       picture=COALESCE(EXCLUDED.picture, users.picture),
       updated_at=now()`,
    [email, fallback.name || null, fallback.picture || null],
  );
  return String(email).toLowerCase();
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
    return [
      "run",
      "trailrun",
      "virtualrun",
      "walk",
      "hike",
      "carrera",
      "correr",
      "caminar",
      "caminata",
      "senderismo",
    ].some((keyword) => text.includes(keyword));
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

    await pool.query(
      `INSERT INTO users (name, email, picture)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET
         name=EXCLUDED.name,
         picture=EXCLUDED.picture,
         updated_at=now()`,
      [name, email, picture]
    );

    const tokenJWT = jwt.sign(
      { email, name },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      user: { name, email, picture },
      token: tokenJWT,
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

/* ================= PERFIL ================= */

app.get('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const profile = await pool.query(`SELECT data, updated_at FROM user_profiles WHERE user_id=$1`, [userId]);
    res.json({ user: req.user, profile: profile.rows[0]?.data || null, updatedAt: profile.rows[0]?.updated_at || null });
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
    await replaceCollection({
      table: "gym_sessions",
      userId,
      items: sessions,
      extra: (item) => ({ columns: ["session_date"], values: [itemDate(item)] }),
    });
    res.json({ ok: true, sessions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron guardar las sesiones de gimnasio" });
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
    res.json({ activities: result.rows.map((row) => row.data) });
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
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (sport) await client.query(`DELETE FROM activities WHERE user_id=$1 AND sport=$2`, [userId, sport]);
      else await client.query(`DELETE FROM activities WHERE user_id=$1`, [userId]);
      for (const item of activities) {
        const itemSport = item?.sport === "cycling" ? "cycling" : item?.sport === "running" ? "running" : sport;
        if (!itemSport) continue;
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
    const result = await pool.query(`SELECT data, updated_at FROM weekly_plan WHERE user_id=$1`, [userId]);
    res.json({ plan: result.rows[0]?.data || [], updatedAt: result.rows[0]?.updated_at || null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo leer el plan semanal" });
  }
});

app.put('/plan', authMiddleware, async (req, res) => {
  try {
    const userId = await getUserId(req.user.email, req.user);
    const plan = asArray(req.body?.plan);
    await pool.query(
      `INSERT INTO weekly_plan (user_id, data, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`,
      [userId, plan],
    );
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

// RedirecciÃ³n
app.get('/auth/strava', (req, res) => {
  const { token } = req.query;

  const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${STRAVA_REDIRECT_URI}&scope=read,activity:read_all&approval_prompt=force&state=${token}`;

  res.redirect(url);
});

// Callback
app.get('/auth/strava/callback', async (req, res) => {
  const { code, state } = req.query;

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
    res.send("Error conectando Strava");
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
    const credentials = await getStravaCredentials(req.user.email);
    if (!credentials) return res.status(409).json({ error: "Strava no conectado" });

    const sport = req.query.sport === "cycling" ? "cycling" : req.query.sport === "running" ? "running" : "";
    const limit = Math.min(Number(req.query.limit) || 12, 30);
    const days = Math.min(Math.max(Number(req.query.days) || 15, 1), 120);
    const cutoffMs = Date.now() - days * 86400000;
    const excluded = new Set(
      String(req.query.exclude || "")
        .split(",")
        .map((id) => id.replace(/^strava-/, "").trim())
        .filter(Boolean)
    );
    const fetched = [];
    for (let page = 1; page <= 2 && fetched.length < 60; page += 1) {
      const activitiesResponse = await axios.get("https://www.strava.com/api/v3/athlete/activities", {
        headers: { Authorization: `Bearer ${credentials.strava_access_token}` },
        params: { per_page: 30, page },
      });
      const batch = Array.isArray(activitiesResponse.data) ? activitiesResponse.data : [];
      fetched.push(...batch);
      if (batch.length < 30) break;
    }

    const inRange = fetched.filter((activity) => {
      const dateMs = activity.start_date ? new Date(activity.start_date).getTime() : 0;
      return dateMs >= cutoffMs;
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
      in_range: activity.start_date ? new Date(activity.start_date).getTime() >= cutoffMs : false,
      matched_sport: !sport || isSportMatch(activity, sport),
      already_registered: excluded.has(String(activity.id)),
    }));

    if (!candidates.length) {
      return res.json({
        sport,
        count: 0,
        days,
        scanned: fetched.length,
        inRange: inRange.length,
        availableTypes,
        recent,
        activities: [],
      });
    }

    const streamsKeys = "time,latlng,distance,altitude,heartrate,cadence,watts,velocity_smooth,temp,grade_smooth";
    const enriched = [];
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
      } catch (streamError) {
        console.error("No se pudo leer stream Strava", activity.id, streamError.response?.data || streamError.message);
        enriched.push({ summary: activity, streams: null, streamError: true });
      }
    }

    res.json({ sport, days, scanned: fetched.length, inRange: inRange.length, availableTypes, recent, count: enriched.length, activities: enriched });
  } catch (error) {
    console.error(error.response?.data || error);
    res.status(500).json({ error: "No se pudo sincronizar Strava" });
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

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend IDG listo en puerto ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("No se pudo inicializar la base de datos", error);
    process.exit(1);
  });
