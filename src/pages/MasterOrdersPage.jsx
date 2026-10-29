import { useEffect, useState } from 'react';
import { api } from '../api';

const reportInitial = { report_text: '' };
const reserveInitial = { part_id: '', qty_reserved: '', qty_used: '', unit_price: '' };

export default function MasterOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [parts, setParts] = useState([]);
  const [reportForms, setReportForms] = useState({});
  const [partForms, setPartForms] = useState({});
  const [error, setError] = useState('');

  async function loadData() {
    try {
      const [ordersData, partsData] = await Promise.all([
        api.get('/api/work-orders'),
        api.get('/api/parts'),
      ]);
      setOrders(ordersData.orders);
      setParts(partsData.parts);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function changeStatus(orderId, status) {
    try {
      await api.patch(`/api/work-orders/${orderId}/status`, { status });
      await loadData();
    } catch (e) {
      setError(e.message);
    }
  }

  function handleReportInput(orderId, value) {
    setReportForms((prev) => ({ ...prev, [orderId]: { report_text: value } }));
  }

  async function createReport(orderId) {
    try {
      const payload = reportForms[orderId] || reportInitial;
      await api.post('/api/reports', { order_id: orderId, report_text: payload.report_text });
      setReportForms((prev) => ({ ...prev, [orderId]: reportInitial }));
      await loadData();
    } catch (e) {
      setError(e.message);
    }
  }

  function handlePartInput(orderId, event) {
    setPartForms((prev) => ({
      ...prev,
      [orderId]: {
        ...(prev[orderId] || reserveInitial),
        [event.target.name]: event.target.value,
      },
    }));
  }

  async function saveOrderPart(orderId) {
    try {
      const payload = partForms[orderId] || reserveInitial;
      await api.post(`/api/work-orders/${orderId}/parts`, payload);
      setPartForms((prev) => ({ ...prev, [orderId]: reserveInitial }));
      await loadData();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section>
      <h3>Мои назначенные заказы</h3>
      {error && <div className="error-box">{error}</div>}
      <div className="stack">
        {orders.map((order) => {
          const report = reportForms[order.order_id] || reportInitial;
          const partForm = partForms[order.order_id] || reserveInitial;
          return (
            <div key={order.order_id} className="card">
              <div className="row-between">
                <h4>{order.order_no}</h4>
                <span className={`badge badge-${order.status.toLowerCase()}`}>{order.status}</span>
              </div>
              <p><strong>Клиент:</strong> {order.client_name}</p>
              <p><strong>Авто:</strong> {order.make} {order.model} ({order.plate_no || 'без номера'})</p>
              <p><strong>Описание:</strong> {order.problem_desc}</p>

              <div className="actions-row">
                <button className="secondary-btn" onClick={() => changeStatus(order.order_id, 'IN_WORK')}>Принять в работу</button>
                <button className="secondary-btn" onClick={() => changeStatus(order.order_id, 'WAIT_PARTS')}>Ожидание запчастей</button>
                <button className="secondary-btn" onClick={() => changeStatus(order.order_id, 'DONE')}>Сдать заказ</button>
              </div>

              <div className="sub-card">
                <strong>Резерв / списание запчастей</strong>
                <div className="grid vehicle-grid">
                  <select name="part_id" value={partForm.part_id} onChange={(e) => handlePartInput(order.order_id, e)}>
                    <option value="">Выберите запчасть</option>
                    {parts.map((part) => (
                      <option key={part.part_id} value={part.part_id}>{part.part_name}</option>
                    ))}
                  </select>
                  <input name="qty_reserved" placeholder="Резерв" value={partForm.qty_reserved} onChange={(e) => handlePartInput(order.order_id, e)} />
                  <input name="qty_used" placeholder="Списано" value={partForm.qty_used} onChange={(e) => handlePartInput(order.order_id, e)} />
                  <input name="unit_price" placeholder="Цена" value={partForm.unit_price} onChange={(e) => handlePartInput(order.order_id, e)} />
                </div>
                <button className="primary-btn" type="button" onClick={() => saveOrderPart(order.order_id)}>
                  Сохранить запчасть
                </button>
              </div>

              <div className="sub-card">
                <strong>Отчёт по ремонту</strong>
                <textarea
                  value={report.report_text}
                  onChange={(e) => handleReportInput(order.order_id, e.target.value)}
                  placeholder="Опишите выполненные работы"
                />
                <button className="primary-btn" type="button" onClick={() => createReport(order.order_id)}>
                  Сформировать отчёт
                </button>
              </div>

              {order.reports?.length ? (
                <div className="sub-card">
                  <strong>История отчётов</strong>
                  <ul className="list">
                    {order.reports.map((item) => (
                      <li key={item.report_id}>{item.report_text}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
