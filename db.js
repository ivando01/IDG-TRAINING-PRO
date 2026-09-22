const { Pool } = require('pg');

let databaseUrl = process.env.DATABASE_URL || "";
let useDatabaseUrl = Boolean(databaseUrl);

function assertValidDatabaseUrl(connectionString) {
  if (!connectionString) return true;

  let url;
  try {
    url = new URL(connectionString);
  } catch (error) {
    console.error("DATABASE_URL no es una URL valida. Usa la cadena PostgreSQL, no la URL web del proyecto.");
    return false;
  }

  const validProtocol = url.protocol === "postgresql:" || url.protocol === "postgres:";
  const hasWebUrlInside = connectionString.includes("https://") || connectionString.includes("http://");

  if (!validProtocol || hasWebUrlInside || !url.username || !url.password || !url.hostname || url.hostname === "https") {
    console.error("DATABASE_URL debe ser PostgreSQL. Formato esperado: postgresql://usuario:password@host:5432/postgres. No uses https://.");
    return false;
  }
  return true;
}

if (!assertValidDatabaseUrl(databaseUrl)) {
  databaseUrl = "";
  useDatabaseUrl = false;
}

const pool = new Pool(
  useDatabaseUrl
    ? {
        connectionString: databaseUrl,
        ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      }
    : {
        user: process.env.PGUSER || 'postgres',
        host: process.env.PGHOST || 'localhost',
        database: process.env.PGDATABASE || 'idg_training',
        password: process.env.PGPASSWORD || '1234',
        port: Number(process.env.PGPORT) || 5432,
      },
);

module.exports = pool;
