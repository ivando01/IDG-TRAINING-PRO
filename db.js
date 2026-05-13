const { Pool } = require('pg');

const useDatabaseUrl = Boolean(process.env.DATABASE_URL);

function assertValidDatabaseUrl(connectionString) {
  if (!connectionString) return;

  let url;
  try {
    url = new URL(connectionString);
  } catch (error) {
    throw new Error("DATABASE_URL no es una URL valida. Usa la cadena PostgreSQL de Supabase, no la URL web del proyecto.");
  }

  const validProtocol = url.protocol === "postgresql:" || url.protocol === "postgres:";
  const hasWebUrlInside = connectionString.includes("https://") || connectionString.includes("http://");

  if (!validProtocol || hasWebUrlInside || !url.username || !url.password || !url.hostname || url.hostname === "https") {
    throw new Error(
      "DATABASE_URL debe ser la cadena de conexion PostgreSQL de Supabase. Formato esperado: postgresql://usuario:password@host:5432/postgres. No uses https://.",
    );
  }
}

assertValidDatabaseUrl(process.env.DATABASE_URL);

const pool = new Pool(
  useDatabaseUrl
    ? {
        connectionString: process.env.DATABASE_URL,
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
