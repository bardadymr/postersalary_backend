-- backend/migrations/001_initial_schema.sql
-- Створення початкової схеми бази даних для системи розрахунку зарплати

-- Таблиця закладів
CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  poster_account VARCHAR(100) NOT NULL UNIQUE,
  poster_access_token TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Індекс для швидкого пошуку по account
CREATE INDEX idx_locations_poster_account ON locations(poster_account);

-- Таблиця співробітників
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  poster_id INTEGER NOT NULL,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  position VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Унікальна комбінація poster_id + location_id
  CONSTRAINT unique_employee_location UNIQUE(poster_id, location_id)
);

-- Індекси для employees
CREATE INDEX idx_employees_location_id ON employees(location_id);
CREATE INDEX idx_employees_poster_id ON employees(poster_id);
CREATE INDEX idx_employees_active ON employees(is_active);

-- Таблиця розрахунків зарплати
CREATE TABLE IF NOT EXISTS salary_reports (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  
  -- Період розрахунку
  period_month INTEGER NOT NULL CHECK (period_month >= 1 AND period_month <= 12),
  period_year INTEGER NOT NULL CHECK (period_year >= 2000),
  
  -- Дані для розрахунку
  shifts_count INTEGER NOT NULL DEFAULT 0,
  shift_rate DECIMAL(10, 2) NOT NULL,
  revenue DECIMAL(10, 2) NOT NULL DEFAULT 0,
  revenue_percent DECIMAL(5, 2) NOT NULL,
  
  -- Розрахунки
  base_salary DECIMAL(10, 2) GENERATED ALWAYS AS (shifts_count * shift_rate) STORED,
  revenue_bonus DECIMAL(10, 2) GENERATED ALWAYS AS (revenue * revenue_percent / 100) STORED,
  inventory_loss DECIMAL(10, 2) DEFAULT 0,
  total_salary DECIMAL(10, 2) NOT NULL,
  
  -- Метадані
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  
  -- Унікальність: один звіт на співробітника за період
  CONSTRAINT unique_report_period UNIQUE(employee_id, period_month, period_year)
);

-- Індекси для salary_reports
CREATE INDEX idx_salary_reports_location ON salary_reports(location_id);
CREATE INDEX idx_salary_reports_employee ON salary_reports(employee_id);
CREATE INDEX idx_salary_reports_period ON salary_reports(period_year, period_month);
CREATE INDEX idx_salary_reports_created_at ON salary_reports(created_at DESC);

-- Таблиця результатів інвентаризації
CREATE TABLE IF NOT EXISTS inventory_results (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  
  -- Період інвентаризації
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  year INTEGER NOT NULL CHECK (year >= 2000),
  
  -- Результати
  loss_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  revisions_count INTEGER DEFAULT 0,
  
  -- Додаткові дані
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Унікальність: одна інвентаризація на заклад за місяць
  CONSTRAINT unique_inventory_period UNIQUE(location_id, month, year)
);

-- Індекси для inventory_results
CREATE INDEX idx_inventory_location ON inventory_results(location_id);
CREATE INDEX idx_inventory_period ON inventory_results(year, month);

-- Таблиця користувачів системи (адміністратори)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username VARCHAR(255),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP
);

-- Індекс для telegram_id
CREATE INDEX idx_users_telegram_id ON users(telegram_id);

-- Таблиця прав доступу користувачів до закладів
CREATE TABLE IF NOT EXISTS user_locations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  can_view BOOLEAN DEFAULT TRUE,
  can_calculate BOOLEAN DEFAULT TRUE,
  can_export BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT unique_user_location UNIQUE(user_id, location_id)
);

-- Індекси для user_locations
CREATE INDEX idx_user_locations_user ON user_locations(user_id);
CREATE INDEX idx_user_locations_location ON user_locations(location_id);

-- Таблиця логів активності
CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INTEGER,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Індекси для activity_logs
CREATE INDEX idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX idx_activity_logs_action ON activity_logs(action);

-- Функція для автоматичного оновлення updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ language 'plpgsql';

-- Тригери для автоматичного оновлення updated_at
CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View для швидкого доступу до останніх розрахунків
CREATE OR REPLACE VIEW latest_salary_reports AS
SELECT 
  sr.*,
  e.name as employee_name,
  e.position,
  l.name as location_name,
  l.poster_account
FROM salary_reports sr
JOIN employees e ON sr.employee_id = e.id
JOIN locations l ON sr.location_id = l.id
ORDER BY sr.created_at DESC;

-- View для агрегованих статистик по закладах
CREATE OR REPLACE VIEW location_statistics AS
SELECT 
  l.id as location_id,
  l.name as location_name,
  COUNT(DISTINCT e.id) as total_employees,
  COUNT(DISTINCT sr.id) as total_reports,
  COALESCE(SUM(sr.total_salary), 0) as total_salary_paid,
  COALESCE(AVG(sr.total_salary), 0) as avg_salary
FROM locations l
LEFT JOIN employees e ON l.id = e.location_id AND e.is_active = true
LEFT JOIN salary_reports sr ON l.id = sr.location_id
GROUP BY l.id, l.name;

-- Додавання коментарів до таблиць
COMMENT ON TABLE locations IS 'Заклади (точки Poster)';
COMMENT ON TABLE employees IS 'Співробітники закладів';
COMMENT ON TABLE salary_reports IS 'Звіти розрахунків заробітної плати';
COMMENT ON TABLE inventory_results IS 'Результати інвентаризацій';
COMMENT ON TABLE users IS 'Користувачі системи (Telegram)';
COMMENT ON TABLE user_locations IS 'Права доступу користувачів до закладів';
COMMENT ON TABLE activity_logs IS 'Журнал активності користувачів';

-- Початкові дані для тестування (опціонально)
-- INSERT INTO locations (name, poster_account) VALUES 
--   ('Тестовий заклад 1', 'test-account-1'),
--   ('Тестовий заклад 2', 'test-account-2');

COMMIT;
