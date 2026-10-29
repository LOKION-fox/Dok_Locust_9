import { useEffect, useState } from 'react';
import { api } from '../api';

function money(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

function todayMinusMonth() {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return date.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const [rows, setRows] = useState([]);
  const [masters, setMasters] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filters, setFilters] = useState({
    start_date: todayMinusMonth(),
    end_date: today(),
    master_id: 'ALL',
    sort: 'profit_desc',
  });
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  async function loadReport() {
    setLoading(true);
    setError('');

    try {
      const query = new URLSearchParams(filters).toString();
      const data = await api.get(`/api/reports/master-profit?${query}`);
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setMasters(Array.isArray(data.masters) ? data.masters : []);
      setSummary(data.summary || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function downloadExcel() {
    setDownloading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const query = new URLSearchParams(filters).toString();
      const response = await fetch(`http://localhost:5000/api/reports/master-profit/excel?${query}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || `Ошибка выгрузки отчёта (${response.status})`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'master_profit_report.xls';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => {
    loadReport();
  }, [filters]);

  return (
    <section className="card">
      <div className="row-between">
        <div>
          <h3>Отчёт по прибыли мастеров</h3>
          <p className="muted">Чистая прибыль считается как выручка по услугам и наценка по запчастям после вычета закупочной стоимости</p>
        </div>
        <button className="primary-btn" type="button" onClick={downloadExcel} disabled={downloading}>
          {downloading ? 'Формирование...' : 'Скачать Excel'}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="filters-bar">
        <label>
          Дата с
          <input
            type="date"
            value={filters.start_date}
            onChange={(e) => setFilters((prev) => ({ ...prev, start_date: e.target.value }))}
          />
        </label>

        <label>
          Дата по
          <input
            type="date"
            value={filters.end_date}
            onChange={(e) => setFilters((prev) => ({ ...prev, end_date: e.target.value }))}
          />
        </label>

        <label>
          Мастер
          <select
            value={filters.master_id}
            onChange={(e) => setFilters((prev) => ({ ...prev, master_id: e.target.value }))}
          >
            <option value="ALL">Все мастера</option>
            {masters.map((master) => (
              <option key={master.user_id} value={master.user_id}>{master.full_name}</option>
            ))}
          </select>
        </label>

        <label>
          Сортировка
          <select
            value={filters.sort}
            onChange={(e) => setFilters((prev) => ({ ...prev, sort: e.target.value }))}
          >
            <option value="profit_desc">Прибыль ↓</option>
            <option value="profit_asc">Прибыль ↑</option>
            <option value="revenue_desc">Выручка ↓</option>
            <option value="orders_desc">Количество заказов ↓</option>
            <option value="master_asc">Мастер А-Я</option>
          </select>
        </label>
      </div>

      {summary && (
        <div className="summary-grid" style={{ marginTop: 16 }}>
          <div className="inner-card summary-card">
            <p><strong>Заказов:</strong> {summary.orders_count}</p>
            <p><strong>Выручка:</strong> {money(summary.revenue_total)}</p>
          </div>
          <div className="inner-card summary-card">
            <p><strong>Себестоимость запчастей:</strong> {money(summary.parts_cost_total)}</p>
            <p className="summary-total">Чистая прибыль: {money(summary.net_profit)}</p>
          </div>
        </div>
      )}

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Мастер</th>
              <th>Заказов выполнено</th>
              <th>Выручка услуг</th>
              <th>Выручка запчастей</th>
              <th>Общая выручка</th>
              <th>Закупочная стоимость запчастей</th>
              <th>Чистая прибыль</th>
              <th>Средняя прибыль на заказ</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.map((row) => (
              <tr key={row.master_id}>
                <td>{row.master_name}</td>
                <td>{row.orders_count}</td>
                <td>{money(row.services_revenue)}</td>
                <td>{money(row.parts_revenue)}</td>
                <td>{money(row.revenue_total)}</td>
                <td>{money(row.parts_cost_total)}</td>
                <td><strong>{money(row.net_profit)}</strong></td>
                <td>{money(row.avg_profit_per_order)}</td>
              </tr>
            ))}

            {!loading && !rows.length && (
              <tr>
                <td colSpan="8" className="muted">Данные за выбранный период не найдены.</td>
              </tr>
            )}

            {loading && (
              <tr>
                <td colSpan="8" className="muted">Загрузка...</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
