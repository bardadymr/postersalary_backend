// backend/src/controllers/salaryController.js

const salaryService = require('../services/salaryService');
const posterService = require('../services/posterService');
const db = require('../config/database'); // PostgreSQL connection

class SalaryController {
  /**
   * POST /api/salary/calculate
   * Розрахунок зарплати
   */
  async calculateSalary(req, res) {
    try {
      const {
        locationId,
        month,
        year,
        inventoryMonth,
        inventoryYear,
        shiftRate,
        revenuePercent
      } = req.body;

      // Валідація вхідних даних
      if (!locationId || !month || !year || shiftRate === undefined || revenuePercent === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters'
        });
      }

      // Отримуємо дані закладу з БД
      const location = await db.query(
        'SELECT * FROM locations WHERE id = $1',
        [locationId]
      );

      if (location.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Location not found'
        });
      }

      const { poster_account, poster_access_token } = location.rows[0];

      // Перевірка валідності токена
      const isTokenValid = await posterService.validateToken(poster_account, poster_access_token);
      if (!isTokenValid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired Poster access token. Please re-authenticate.'
        });
      }

      // Параметри для розрахунку
      const calculationParams = {
        account: poster_account,
        accessToken: poster_access_token,
        month: parseInt(month),
        year: parseInt(year),
        inventoryMonth: parseInt(inventoryMonth || month),
        inventoryYear: parseInt(inventoryYear || year),
        shiftRate: parseFloat(shiftRate),
        revenuePercent: parseFloat(revenuePercent)
      };

      // Валідація параметрів
      const validation = salaryService.validateCalculationParams(calculationParams);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          errors: validation.errors
        });
      }

      // Розрахунок зарплати
      const result = await salaryService.calculateSalaries(calculationParams);

      // Зберігаємо результат в БД
      await this.saveSalaryReport(locationId, result);

      res.json(result);

    } catch (error) {
      console.error('Salary calculation error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  /**
   * GET /api/locations
   * Отримання списку закладів
   */
  async getLocations(req, res) {
    try {
      const result = await db.query(
        'SELECT id, name FROM locations ORDER BY name'
      );

      res.json({
        success: true,
        locations: result.rows
      });

    } catch (error) {
      console.error('Error fetching locations:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch locations'
      });
    }
  }

  /**
   * GET /api/salary/history/:locationId
   * Отримання історії розрахунків для закладу
   */
  async getSalaryHistory(req, res) {
    try {
      const { locationId } = req.params;
      const { limit = 10 } = req.query;

      const result = await db.query(`
        SELECT 
          sr.id,
          sr.period_month,
          sr.period_year,
          sr.shift_rate,
          sr.revenue_percent,
          COUNT(DISTINCT sr.employee_id) as employees_count,
          SUM(sr.total_salary) as total_salary,
          sr.created_at
        FROM salary_reports sr
        WHERE sr.location_id = $1
        GROUP BY sr.id, sr.period_month, sr.period_year, sr.shift_rate, sr.revenue_percent, sr.created_at
        ORDER BY sr.created_at DESC
        LIMIT $2
      `, [locationId, limit]);

      res.json({
        success: true,
        history: result.rows
      });

    } catch (error) {
      console.error('Error fetching salary history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch salary history'
      });
    }
  }

  /**
   * GET /api/salary/export/:reportId
   * Експорт звіту в CSV
   */
  async exportReport(req, res) {
    try {
      const { reportId } = req.params;

      // Отримуємо дані звіту з БД
      const result = await db.query(`
        SELECT 
          sr.*,
          e.name as employee_name,
          l.name as location_name
        FROM salary_reports sr
        JOIN employees e ON sr.employee_id = e.id
        JOIN locations l ON sr.location_id = l.id
        WHERE sr.id = $1
        ORDER BY sr.total_salary DESC
      `, [reportId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Report not found'
        });
      }

      // Формуємо дані для експорту
      const salaryData = {
        employees: result.rows.map(row => ({
          employeeName: row.employee_name,
          shiftsCount: row.shifts_count,
          revenue: parseFloat(row.revenue),
          baseSalary: parseFloat(row.shifts_count * row.shift_rate),
          revenueBonus: parseFloat(row.revenue * row.revenue_percent / 100),
          inventoryDeduction: parseFloat(row.inventory_loss || 0),
          totalSalary: parseFloat(row.total_salary)
        }))
      };

      const csv = salaryService.generateCSV(salaryData);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=salary_report_${reportId}.csv`);
      res.send(csv);

    } catch (error) {
      console.error('Error exporting report:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to export report'
      });
    }
  }

  /**
   * POST /api/locations/connect
   * Підключення нового закладу через OAuth
   */
  async connectLocation(req, res) {
    try {
      const { code, account, name } = req.body;

      if (!code || !account) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters'
        });
      }

      // Отримуємо access token
      const authData = await posterService.getAccessToken(account, code);

      // Зберігаємо в БД
      const result = await db.query(`
        INSERT INTO locations (name, poster_account, poster_access_token)
        VALUES ($1, $2, $3)
        ON CONFLICT (poster_account) 
        DO UPDATE SET 
          poster_access_token = $3,
          name = $1
        RETURNING id, name
      `, [name || account, account, authData.access_token]);

      res.json({
        success: true,
        location: result.rows[0]
      });

    } catch (error) {
      console.error('Error connecting location:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to connect location'
      });
    }
  }

  /**
   * Збереження результатів розрахунку в БД
   */
  async saveSalaryReport(locationId, salaryData) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Зберігаємо інформацію про інвентаризацію
      await client.query(`
        INSERT INTO inventory_results (location_id, month, year, loss_amount)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
      `, [
        locationId,
        salaryData.inventory.month,
        salaryData.inventory.year,
        salaryData.inventory.totalLoss
      ]);

      // Зберігаємо дані по кожному співробітнику
      for (const emp of salaryData.employees) {
        // Перевіряємо чи є співробітник в БД
        let employeeResult = await client.query(
          'SELECT id FROM employees WHERE poster_id = $1 AND location_id = $2',
          [emp.employeeId, locationId]
        );

        let dbEmployeeId;
        
        if (employeeResult.rows.length === 0) {
          // Створюємо нового співробітника
          const newEmp = await client.query(`
            INSERT INTO employees (poster_id, location_id, name)
            VALUES ($1, $2, $3)
            RETURNING id
          `, [emp.employeeId, locationId, emp.employeeName]);
          
          dbEmployeeId = newEmp.rows[0].id;
        } else {
          dbEmployeeId = employeeResult.rows[0].id;
        }

        // Зберігаємо звіт по зарплаті
        await client.query(`
          INSERT INTO salary_reports (
            location_id, 
            employee_id, 
            period_month, 
            period_year,
            shifts_count,
            shift_rate,
            revenue,
            revenue_percent,
            inventory_loss,
            total_salary
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          locationId,
          dbEmployeeId,
          salaryData.period.month,
          salaryData.period.year,
          emp.shiftsCount,
          salaryData.parameters.shiftRate,
          emp.revenue,
          salaryData.parameters.revenuePercent,
          emp.inventoryDeduction,
          emp.totalSalary
        ]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * GET /api/auth/poster
   * Отримання URL для авторизації в Poster
   */
  getAuthUrl(req, res) {
    const redirectUri = process.env.POSTER_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/poster/callback`;
    const authUrl = posterService.getAuthUrl(redirectUri);
    
    res.json({
      success: true,
      authUrl
    });
  }
}

module.exports = new SalaryController();
