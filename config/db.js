import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

console.log('Password Type:', typeof process.env.DB_PASSWORD); // Should output: 'string'

const db = new pg.Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

db.connect()
  .then(() => console.log('Connected to database'))
  .catch(err => console.error('Connection error', err.stack));

export default db;
