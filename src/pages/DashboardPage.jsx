import { useEffect, useState } from 'react';
import { api } from '../api';

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/dashboard')
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <section className="page-grid">
      <div className="card">
        <h3>Главная панель</h3>
        <p className="muted">Сводная информация по автомастерской</p>

        {error && <div className="error-box">{error}</div>}

        {stats && (
          <div className="grid cards-grid">
            {stats.cards.map((card) => (
              <div key={card.label} className="card stat-card inner-card">
                <strong>{card.label}: {card.value}</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Последние заказ-наряды</h3>
        {!stats?.recentOrders?.length && <p className="muted">Данных нет.</p>}
        {!!stats?.recentOrders?.length && (
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Клиент</th>
                  <th>Авто</th>
                  <th>Статус</th>
                  <th>Мастер</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentOrders.map((order) => (
                  <tr key={order.order_id}>
                    <td>{order.order_no}</td>
                    <td>{order.client_name}</td>
                    <td>{order.make} {order.model}</td>
                    <td>{order.status}</td>
                    <td>{order.master_name || 'Не назначен'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}