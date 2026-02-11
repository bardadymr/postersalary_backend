// backend/src/services/posterService.js

const axios = require('axios');

class PosterService {
  constructor() {
    this.baseUrl = 'https://joinposter.com';
    this.appId = process.env.POSTER_APP_ID;
    this.appSecret = process.env.POSTER_APP_SECRET;
  }

  /**
   * Отримання OAuth access token
   */
  async getAccessToken(account, code) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/auth`, {
        application_id: this.appId,
        application_secret: this.appSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.POSTER_REDIRECT_URI
      });

      return {
        access_token: response.data.access_token,
        account: account
      };
    } catch (error) {
      console.error('Poster Auth Error:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with Poster API');
    }
  }

  /**
   * Створення URL для авторизації
   */
  getAuthUrl(redirectUri) {
    return `${this.baseUrl}/api/auth?application_id=${this.appId}&redirect_uri=${redirectUri}&response_type=code`;
  }

  /**
   * Виконання API запиту до Poster
   */
  async makeRequest(account, accessToken, endpoint, params = {}) {
    try {
      const url = `https://${account}.joinposter.com/api/${endpoint}`;
      
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        params: params
      });

      return response.data;
    } catch (error) {
      console.error(`Poster API Error (${endpoint}):`, error.response?.data || error.message);
      throw new Error(`Failed to fetch data from Poster API: ${endpoint}`);
    }
  }

  /**
   * Отримання списку співробітників
   */
  async getEmployees(account, accessToken) {
    const data = await this.makeRequest(account, accessToken, 'access.getEmployees');
    return data.response || [];
  }

  /**
   * Отримання транзакцій за період
   * @param {string} account - Poster account
   * @param {string} accessToken - Access token
   * @param {string} dateFrom - Дата початку (YYYYMMDD)
   * @param {string} dateTo - Дата кінця (YYYYMMDD)
   */
  async getTransactions(account, accessToken, dateFrom, dateTo) {
    const data = await this.makeRequest(account, accessToken, 'dash.getTransactions', {
      dateFrom,
      dateTo,
      type: 'sale'
    });
    
    return data.response || [];
  }

  /**
   * Отримання даних про виручку співробітників
   */
  async getEmployeeRevenue(account, accessToken, dateFrom, dateTo) {
    const transactions = await this.getTransactions(account, accessToken, dateFrom, dateTo);
    
    // Групуємо транзакції за співробітниками
    const revenueByEmployee = {};
    const shiftsByEmployee = {};

    transactions.forEach(transaction => {
      const employeeId = transaction.user_id || transaction.staff_id;
      const transactionDate = transaction.date_close || transaction.date;
      
      if (!employeeId) return;

      // Підрахунок виручки
      if (!revenueByEmployee[employeeId]) {
        revenueByEmployee[employeeId] = 0;
      }
      revenueByEmployee[employeeId] += parseFloat(transaction.total || 0);

      // Підрахунок унікальних днів роботи (змін)
      if (!shiftsByEmployee[employeeId]) {
        shiftsByEmployee[employeeId] = new Set();
      }
      
      // Додаємо дату до множини (автоматично видаляє дублікати)
      const dateOnly = transactionDate.split(' ')[0]; // Отримуємо тільки дату без часу
      shiftsByEmployee[employeeId].add(dateOnly);
    });

    // Конвертуємо Set в кількість
    const result = Object.keys(revenueByEmployee).map(employeeId => ({
      employeeId: parseInt(employeeId),
      revenue: revenueByEmployee[employeeId],
      shiftsCount: shiftsByEmployee[employeeId].size
    }));

    return result;
  }

  /**
   * Отримання результатів інвентаризації
   * @param {string} account - Poster account
   * @param {string} accessToken - Access token
   * @param {number} month - Місяць (1-12)
   * @param {number} year - Рік
   */
  async getInventoryResults(account, accessToken, month, year) {
    // Формуємо дати для запиту
    const dateFrom = `${year}${String(month).padStart(2, '0')}01`;
    
    // Останній день місяця
    const lastDay = new Date(year, month, 0).getDate();
    const dateTo = `${year}${String(month).padStart(2, '0')}${lastDay}`;

    try {
      const data = await this.makeRequest(account, accessToken, 'storage.getInventoryRevisions', {
        dateFrom,
        dateTo
      });

      const revisions = data.response || [];
      
      // Розрахунок загальної різниці
      let totalLoss = 0;
      
      revisions.forEach(revision => {
        // Poster повертає різницю в копійках або основній валюті
        // Від'ємне значення = нестача
        const difference = parseFloat(revision.difference || 0);
        totalLoss += difference;
      });

      return {
        month,
        year,
        totalLoss,
        revisionsCount: revisions.length,
        revisions: revisions
      };
    } catch (error) {
      console.error('Error fetching inventory:', error);
      return {
        month,
        year,
        totalLoss: 0,
        revisionsCount: 0,
        revisions: []
      };
    }
  }

  /**
   * Отримання детальної статистики співробітника
   */
  async getEmployeeStats(account, accessToken, employeeId, dateFrom, dateTo) {
    const transactions = await this.getTransactions(account, accessToken, dateFrom, dateTo);
    
    const employeeTransactions = transactions.filter(t => 
      (t.user_id === employeeId || t.staff_id === employeeId)
    );

    const revenue = employeeTransactions.reduce((sum, t) => sum + parseFloat(t.total || 0), 0);
    
    const uniqueDates = new Set(
      employeeTransactions.map(t => (t.date_close || t.date).split(' ')[0])
    );

    return {
      employeeId,
      revenue,
      shiftsCount: uniqueDates.size,
      transactionsCount: employeeTransactions.length
    };
  }

  /**
   * Отримання інформації про заклад
   */
  async getSpotInfo(account, accessToken) {
    try {
      const data = await this.makeRequest(account, accessToken, 'settings.getAllSettings');
      return data.response || {};
    } catch (error) {
      console.error('Error fetching spot info:', error);
      return {};
    }
  }

  /**
   * Перевірка валідності access token
   */
  async validateToken(account, accessToken) {
    try {
      await this.makeRequest(account, accessToken, 'settings.getAllSettings');
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new PosterService();
