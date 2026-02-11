// backend/src/config/database.js

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'salary_calculator',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20, // максимальна кількість з'єднань в пулі
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Обробка помилок підключення
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Тестування підключення
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection error:', err);
  } else {
    console.log('✅ Database connected successfully');
  }
});

// Функція для виконання запитів
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

// Функція для отримання клієнта (для транзакцій)
const getClient = async () => {
  const client = await pool.connect();
  const query = client.query;
  const release = client.release;

  // Перевизначаємо release для логування
  client.release = () => {
    client.query = query;
    client.release = release;
    return release.apply(client);
  };

  return client;
};

module.exports = {
  query,
  pool,
  getClient
};
