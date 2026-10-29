import { useEffect, useState } from 'react';
import { api } from '../api';

const ARCHIVE_STATUSES = ['Выполнен', 'Отменён'];

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU');
}

function money(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

function getOrderStatusBadgeClass(status) {
  switch (status) {
    case 'Выполнен':
      return 'badge-success';
    case 'Отменён':
      return 'badge-danger';
    default:
      return 'badge-muted';
  }
}

export default function ArchivePage() {
  const [orders, setOrders] = useState([]);
  const [masters, setMasters] = useState([]);
  const [filters, setFilters] = useState({
    search: '',
    status: 'ALL',
    master_id: 'ALL',
    sort: 'completed_desc',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadArchive() {
    setLoading(true);
    setError('');

    try {
      const query = new URLSearchParams(filters).toString();
      const data = await api.get(`/api/work-orders/archive?${query}`);
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setMasters(Array.isArray(data.masters) ? data.masters : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadArchive();
  }, [filters]);

  return (
    <section className="card">
      <div className="row-between">
        <div>
          <h3>Архив заказ-нарядов</h3>
          <p className="muted">Выполненные и отменённые заказы не удаляются, а хранятся в архиве</p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="filters-bar">
        <input
          className="search-input"
          placeholder="Поиск по номеру, клиенту, авто, мастеру"
          value={filters.search}
          onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
        />

        <select
          value={filters.status}
          onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
        >
          <option value="ALL">Все архивные статусы</option>
          {ARCHIVE_STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>

        <select
          value={filters.master_id}
          onChange={(e) => setFilters((prev) => ({ ...prev, master_id: e.target.value }))}
        >
          <option value="ALL">Все мастера</option>
          {masters.map((master) => (
            <option key={master.user_id} value={master.user_id}>{master.full_name}</option>
          ))}
        </select>

        <select
          value={filters.sort}
          onChange={(e) => setFilters((prev) => ({ ...prev, sort: e.target.value }))}
        >
          <option value="completed_desc">Дата закрытия ↓</option>
          <option value="completed_asc">Дата закрытия ↑</option>
          <option value="created_desc">Дата создания ↓</option>
          <option value="created_asc">Дата создания ↑</option>
          <option value="client_asc">Клиент А-Я</option>
          <option value="master_asc">Мастер А-Я</option>
          <option value="profit_desc">Чистая прибыль ↓</option>
          <option value="profit_asc">Чистая прибыль ↑</option>
        </select>
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Номер</th>
              <th>Клиент</th>
              <th>Автомобиль</th>
              <th>Мастер</th>
              <th>Статус</th>
              <th>Создан</th>
              <th>Закрыт / отменён</th>
              <th>Выручка</th>
              <th>Себестоимость</th>
              <th>Чистая прибыль</th>
            </tr>
          </thead>
          <tbody>
            {!loading && orders.map((order) => (
              <tr key={order.order_id}>
                <td>{order.order_no}</td>
                <td>{order.client_name}</td>
                <td>{order.make} {order.model}{order.plate_no ? ` (${order.plate_no})` : ''}</td>
                <td>{order.master_name || '—'}</td>
                <td><span className={`badge ${getOrderStatusBadgeClass(order.status)}`}>{order.status}</span></td>
                <td>{formatDateTime(order.created_at)}</td>
                <td>{formatDateTime(order.archived_at)}</td>
                <td>{money(order.revenue_total)}</td>
                <td>{money(order.parts_cost_total)}</td>
                <td><strong>{money(order.net_profit)}</strong></td>
              </tr>
            ))}

            {!loading && !orders.length && (
              <tr>
                <td colSpan="10" className="muted">Архивные заказы не найдены.</td>
              </tr>
            )}

            {loading && (
              <tr>
                <td colSpan="10" className="muted">Загрузка...</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
