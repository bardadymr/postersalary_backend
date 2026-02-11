// backend/src/services/salaryService.js

const posterService = require('./posterService');

class SalaryService {
  /**
   * Розрахунок заробітної плати для всіх співробітників закладу
   * @param {Object} params - Параметри розрахунку
   * @param {string} params.account - Poster account
   * @param {string} params.accessToken - Access token
   * @param {number} params.month - Місяць розрахунку (1-12)
   * @param {number} params.year - Рік розрахунку
   * @param {number} params.inventoryMonth - Місяць інвентаризації (1-12)
   * @param {number} params.inventoryYear - Рік інвентаризації
   * @param {number} params.shiftRate - Ставка за одну зміну (грн)
   * @param {number} params.revenuePercent - Процент від виручки (%)
   */
  async calculateSalaries(params) {
    const {
      account,
      accessToken,
      month,
      year,
      inventoryMonth,
      inventoryYear,
      shiftRate,
      revenuePercent
    } = params;

    try {
      // 1. Формуємо дати для запиту транзакцій
      const dateFrom = `${year}${String(month).padStart(2, '0')}01`;
      const lastDay = new Date(year, month, 0).getDate();
      const dateTo = `${year}${String(month).padStart(2, '0')}${lastDay}`;

      // 2. Отримуємо дані з Poster API паралельно
      const [employees, revenueData, inventoryResults] = await Promise.all([
        posterService.getEmployees(account, accessToken),
        posterService.getEmployeeRevenue(account, accessToken, dateFrom, dateTo),
        posterService.getInventoryResults(account, accessToken, inventoryMonth, inventoryYear)
      ]);

      // 3. Створюємо мапу виручки за співробітниками
      const revenueMap = {};
      const shiftsMap = {};
      
      revenueData.forEach(data => {
        revenueMap[data.employeeId] = data.revenue;
        shiftsMap[data.employeeId] = data.shiftsCount;
      });

      // 4. Розраховуємо загальну виручку для пропорційного розподілу нестачі
      const totalRevenue = revenueData.reduce((sum, data) => sum + data.revenue, 0);

      // 5. Розраховуємо зарплату для кожного співробітника
      const salaryResults = employees.map(employee => {
        const employeeId = employee.user_id || employee.id;
        const employeeName = employee.name || employee.user_name || 'Невідомий';
        
        const shiftsCount = shiftsMap[employeeId] || 0;
        const revenue = revenueMap[employeeId] || 0;

        // Базова зарплата (зміни × ставка)
        const baseSalary = shiftsCount * shiftRate;

        // Відсоток від виручки
        const revenueBonus = revenue * (revenuePercent / 100);

        // Розподіл нестачі інвентаризації пропорційно виручці
        let inventoryDeduction = 0;
        if (inventoryResults.totalLoss < 0 && totalRevenue > 0) {
          // Якщо є нестача (від'ємне значення)
          const employeeShare = revenue / totalRevenue;
          inventoryDeduction = Math.abs(inventoryResults.totalLoss) * employeeShare;
        }

        // Підсумкова зарплата
        const totalSalary = baseSalary + revenueBonus - inventoryDeduction;

        return {
          employeeId,
          employeeName,
          shiftsCount,
          revenue: Math.round(revenue * 100) / 100, // Округлюємо до 2 знаків
          baseSalary: Math.round(baseSalary * 100) / 100,
          revenueBonus: Math.round(revenueBonus * 100) / 100,
          inventoryDeduction: Math.round(inventoryDeduction * 100) / 100,
          totalSalary: Math.round(totalSalary * 100) / 100
        };
      });

      // 6. Фільтруємо тільки тих, хто працював
      const workingEmployees = salaryResults.filter(emp => emp.shiftsCount > 0);

      // 7. Формуємо фінальний результат
      return {
        success: true,
        period: {
          month,
          year,
          monthName: this.getMonthName(month)
        },
        parameters: {
          shiftRate,
          revenuePercent
        },
        inventory: {
          month: inventoryMonth,
          year: inventoryYear,
          totalLoss: Math.round(inventoryResults.totalLoss * 100) / 100,
          revisionsCount: inventoryResults.revisionsCount
        },
        summary: {
          employeesCount: workingEmployees.length,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalBaseSalary: Math.round(workingEmployees.reduce((sum, e) => sum + e.baseSalary, 0) * 100) / 100,
          totalRevenueBonus: Math.round(workingEmployees.reduce((sum, e) => sum + e.revenueBonus, 0) * 100) / 100,
          totalInventoryDeduction: Math.round(workingEmployees.reduce((sum, e) => sum + e.inventoryDeduction, 0) * 100) / 100,
          totalSalary: Math.round(workingEmployees.reduce((sum, e) => sum + e.totalSalary, 0) * 100) / 100
        },
        employees: workingEmployees.sort((a, b) => b.totalSalary - a.totalSalary) // Сортуємо за зарплатою
      };

    } catch (error) {
      console.error('Salary calculation error:', error);
      throw new Error('Failed to calculate salaries: ' + error.message);
    }
  }

  /**
   * Розрахунок зарплати для одного співробітника
   */
  async calculateEmployeeSalary(params) {
    const {
      account,
      accessToken,
      employeeId,
      month,
      year,
      shiftRate,
      revenuePercent
    } = params;

    const dateFrom = `${year}${String(month).padStart(2, '0')}01`;
    const lastDay = new Date(year, month, 0).getDate();
    const dateTo = `${year}${String(month).padStart(2, '0')}${lastDay}`;

    const stats = await posterService.getEmployeeStats(
      account,
      accessToken,
      employeeId,
      dateFrom,
      dateTo
    );

    const baseSalary = stats.shiftsCount * shiftRate;
    const revenueBonus = stats.revenue * (revenuePercent / 100);
    const totalSalary = baseSalary + revenueBonus;

    return {
      employeeId,
      shiftsCount: stats.shiftsCount,
      revenue: stats.revenue,
      baseSalary,
      revenueBonus,
      totalSalary
    };
  }

  /**
   * Експорт результатів у CSV
   */
  generateCSV(salaryData) {
    const headers = [
      'Співробітник',
      'Кількість змін',
      'Виручка (грн)',
      'Базова ЗП (грн)',
      'Відсоток від виручки (грн)',
      'Вирахування за інвентаризацію (грн)',
      'ВСЬОГО (грн)'
    ];

    const rows = salaryData.employees.map(emp => [
      emp.employeeName,
      emp.shiftsCount,
      emp.revenue.toFixed(2),
      emp.baseSalary.toFixed(2),
      emp.revenueBonus.toFixed(2),
      emp.inventoryDeduction.toFixed(2),
      emp.totalSalary.toFixed(2)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    return csvContent;
  }

  /**
   * Генерація детального звіту
   */
  generateDetailedReport(salaryData) {
    const { period, parameters, inventory, summary, employees } = salaryData;

    let report = `
═══════════════════════════════════════════════════════════
            ЗВІТ ПРО РОЗРАХУНОК ЗАРОБІТНОЇ ПЛАТИ
═══════════════════════════════════════════════════════════

ПЕРІОД: ${this.getMonthName(period.month)} ${period.year}

ПАРАМЕТРИ РОЗРАХУНКУ:
  • Ставка за зміну: ${parameters.shiftRate} грн
  • Процент від виручки: ${parameters.revenuePercent}%

ІНВЕНТАРИЗАЦІЯ (${this.getMonthName(inventory.month)} ${inventory.year}):
  • Результат: ${inventory.totalLoss >= 0 ? '+' : ''}${inventory.totalLoss.toFixed(2)} грн
  • Кількість інвентаризацій: ${inventory.revisionsCount}

ЗАГАЛЬНА СТАТИСТИКА:
  • Кількість працюючих співробітників: ${summary.employeesCount}
  • Загальна виручка: ${summary.totalRevenue.toFixed(2)} грн
  • Сума базових зарплат: ${summary.totalBaseSalary.toFixed(2)} грн
  • Сума бонусів: ${summary.totalRevenueBonus.toFixed(2)} грн
  • Вирахування за інвентаризацію: ${summary.totalInventoryDeduction.toFixed(2)} грн
  • ПІДСУМКОВА СУМА ЗАРПЛАТ: ${summary.totalSalary.toFixed(2)} грн

───────────────────────────────────────────────────────────
ДЕТАЛІ ПО СПІВРОБІТНИКАХ:
───────────────────────────────────────────────────────────
`;

    employees.forEach((emp, index) => {
      report += `
${index + 1}. ${emp.employeeName}
   Зміни: ${emp.shiftsCount}
   Виручка: ${emp.revenue.toFixed(2)} грн
   Базова ЗП: ${emp.baseSalary.toFixed(2)} грн
   Бонус (${parameters.revenuePercent}%): ${emp.revenueBonus.toFixed(2)} грн
   Вирахування: -${emp.inventoryDeduction.toFixed(2)} грн
   ─────────────────────────────────────
   ВСЬОГО: ${emp.totalSalary.toFixed(2)} грн
`;
    });

    report += `
═══════════════════════════════════════════════════════════
`;

    return report;
  }

  /**
   * Отримання назви місяця
   */
  getMonthName(month) {
    const months = [
      'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
      'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'
    ];
    return months[month - 1] || 'Невідомий місяць';
  }

  /**
   * Валідація параметрів розрахунку
   */
  validateCalculationParams(params) {
    const errors = [];

    if (!params.account) errors.push('Account is required');
    if (!params.accessToken) errors.push('Access token is required');
    if (!params.month || params.month < 1 || params.month > 12) {
      errors.push('Invalid month (must be 1-12)');
    }
    if (!params.year || params.year < 2000) {
      errors.push('Invalid year');
    }
    if (params.shiftRate === undefined || params.shiftRate < 0) {
      errors.push('Invalid shift rate');
    }
    if (params.revenuePercent === undefined || params.revenuePercent < 0 || params.revenuePercent > 100) {
      errors.push('Invalid revenue percent (must be 0-100)');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = new SalaryService();
