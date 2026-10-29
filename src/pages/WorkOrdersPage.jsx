import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const ORDER_STATUSES = [
  'Ожидает принятия мастером',
  'В работе',
  'Сдан мастером',
  'Выполнен',
  'Отменён',
];

const ACTIVE_ORDER_STATUSES = [
  'Ожидает принятия мастером',
  'В работе',
  'Сдан мастером',
];

const emptyOrderForm = {
  client_id: '',
  vehicle_id: '',
  master_id: '',
  problem_desc: '',
  admin_comment: '',
};

const emptyServiceForm = {
  service_id: '',
  qty: '1',
  comment: '',
  custom_service_name: '',
  custom_price: '',
  custom_unit: 'усл.',
};

const emptyPartForm = {
  part_id: '',
  qty: '1',
  note: '',
};

function onlyInteger(value) {
  return String(value ?? '').replace(/[^\d]/g, '');
}

function onlyMoney(value) {
  return String(value ?? '')
    .replace(',', '.')
    .replace(/[^0-9.]/g, '')
    .replace(/(\..*)\./g, '$1');
}

function sanitizeText(value) {
  return String(value ?? '').replace(/[<>`]/g, '').trimStart();
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU');
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function money(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

function getOrderStatusBadgeClass(status) {
  switch (status) {
    case 'Ожидает принятия мастером':
      return 'badge-wait';
    case 'В работе':
      return 'badge-progress';
    case 'Сдан мастером':
      return 'badge-submitted';
    case 'Выполнен':
      return 'badge-success';
    case 'Отменён':
      return 'badge-danger';
    default:
      return 'badge-muted';
  }
}

export default function WorkOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState({
    clients: [],
    vehicles: [],
    masters: [],
    parts: [],
    services: [],
    statuses: ORDER_STATUSES,
  });

  const [filters, setFilters] = useState({
    search: '',
    status: 'ALL',
    master_id: 'ALL',
    sort: 'newest',
  });

  const [form, setForm] = useState(emptyOrderForm);
  const [editingId, setEditingId] = useState(null);
  const [clientSearch, setClientSearch] = useState('');

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedDetails, setSelectedDetails] = useState(null);

  const [serviceForm, setServiceForm] = useState(emptyServiceForm);
  const [partForm, setPartForm] = useState(emptyPartForm);
  const [useCustomService, setUseCustomService] = useState(false);

  const [vehicleSearch, setVehicleSearch] = useState('');
  const [adminClosingComment, setAdminClosingComment] = useState('');

  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const clients = safeArray(meta.clients);
  const vehicles = safeArray(meta.vehicles);
  const masters = safeArray(meta.masters);
  const parts = safeArray(meta.parts);
  const services = safeArray(meta.services);

  const filteredClients = useMemo(() => {
    const searchValue = clientSearch.trim().toLowerCase();

    if (!searchValue) return clients;

    return clients.filter((client) =>
      String(client.name || '').toLowerCase().includes(searchValue)
    );
  }, [clients, clientSearch]);

  const availableVehicles = useMemo(() => {
    const currentClientId = Number(form.client_id);
    const searchValue = vehicleSearch.trim().toLowerCase();

    let list = vehicles;

    if (currentClientId) {
      list = list.filter((vehicle) => Number(vehicle.client_id) === currentClientId);
    }

    if (searchValue) {
      list = list.filter((vehicle) => {
        const haystack = [
          vehicle.client_name,
          vehicle.make,
          vehicle.model,
          vehicle.plate_no,
          vehicle.vin,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystack.includes(searchValue);
      });
    }

    return list;
  }, [vehicles, form.client_id, vehicleSearch]);

  const selectedServiceMeta = useMemo(
    () => services.find((service) => String(service.service_id) === String(serviceForm.service_id)),
    [services, serviceForm.service_id]
  );

  const selectedPartMeta = useMemo(
    () => parts.find((part) => String(part.part_id) === String(partForm.part_id)),
    [parts, partForm.part_id]
  );

  const historyRows = safeArray(selectedDetails?.history || selectedDetails?.statusHistory || selectedDetails?.status_history);
  const serviceRows = safeArray(selectedDetails?.services);
  const partRows = safeArray(selectedDetails?.parts);
  const masterReport = selectedDetails?.masterReport || selectedDetails?.master_report || null;

  const servicesTotal = useMemo(
    () => serviceRows.reduce((sum, item) => sum + Number(item.amount || (Number(item.qty || 0) * Number(item.price || 0))), 0),
    [serviceRows]
  );

  const partsTotal = useMemo(
    () => partRows.reduce((sum, item) => sum + Number(item.amount || (Number(item.qty_reserved || 0) * Number(item.unit_price || 0))), 0),
    [partRows]
  );

  const grandTotal = servicesTotal + partsTotal;

  async function loadMeta() {
    try {
      const data = await api.get('/api/work-orders/meta');
      setMeta({
        clients: safeArray(data.clients),
        vehicles: safeArray(data.vehicles),
        masters: safeArray(data.masters),
        parts: safeArray(data.parts),
        services: safeArray(data.services),
        statuses: safeArray(data.statuses).length ? data.statuses : ORDER_STATUSES,
      });
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadOrders() {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        search: filters.search,
        status: filters.status,
        master_id: filters.master_id,
        sort: filters.sort,
        scope: 'active',
      }).toString();

      const data = await api.get(`/api/work-orders?${query}`);
      setOrders(safeArray(data.orders));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadOrderDetails(orderId) {
    setDetailsLoading(true);
    setError('');
    try {
      const data = await api.get(`/api/work-orders/${orderId}`);
      setSelectedDetails(data);
      setSelectedOrder(data.order || null);
      setAdminClosingComment(data?.order?.admin_closing_comment || '');
    } catch (e) {
      setError(e.message);
    } finally {
      setDetailsLoading(false);
    }
  }

  useEffect(() => {
    loadMeta();
  }, []);

  useEffect(() => {
    loadOrders();
  }, [filters]);

  function resetForm() {
    setForm(emptyOrderForm);
    setEditingId(null);
    setVehicleSearch('');
    setClientSearch('');
  }

  function startCreate() {
    resetForm();
    setSuccess('');
    setError('');
  }

  function startEdit(order) {
    setEditingId(order.order_id);
    setForm({
      client_id: String(order.client_id || ''),
      vehicle_id: String(order.vehicle_id || ''),
      master_id: order.master_id ? String(order.master_id) : '',
      problem_desc: order.problem_desc || '',
      admin_comment: order.admin_comment || '',
    });
    setVehicleSearch('');
    setSuccess('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleOrderFieldChange(event) {
    const { name, value } = event.target;

    setForm((prev) => {
      if (name === 'client_id') {
        return { ...prev, client_id: value, vehicle_id: '' };
      }

      if (name === 'problem_desc' || name === 'admin_comment') {
        return { ...prev, [name]: sanitizeText(value) };
      }

      return { ...prev, [name]: value };
    });
  }

  async function handleSubmitOrder(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    try {
      if (editingId) {
        await api.put(`/api/work-orders/${editingId}`, form);
        setSuccess('Заказ-наряд успешно обновлён.');
      } else {
        await api.post('/api/work-orders', form);
        setSuccess('Заказ-наряд успешно создан.');
      }

      resetForm();
      await loadOrders();

      if (selectedOrder?.order_id && editingId === selectedOrder.order_id) {
        await loadOrderDetails(selectedOrder.order_id);
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleCancelOrder(orderId) {
    if (!window.confirm('Отменить заказ-наряд? Заказ не удалится, а перейдёт в архив.')) return;

    setError('');
    setSuccess('');
    try {
      await api.patch(`/api/work-orders/${orderId}/status`, { status: 'Отменён' });
      setSuccess('Заказ-наряд отменён и перенесён в архив.');

      if (selectedOrder?.order_id === orderId) {
        setSelectedOrder(null);
        setSelectedDetails(null);
      }

      if (editingId === orderId) {
        resetForm();
      }

      await loadOrders();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleOpenOrder(orderId) {
    setSelectedOrder(orders.find((item) => item.order_id === orderId) || null);
    await loadOrderDetails(orderId);
  }

  async function handleAddService(event) {
    event.preventDefault();
    if (!selectedOrder) return;

    setError('');
    setSuccess('');

    try {
      const payload = useCustomService
        ? {
            qty: Number(serviceForm.qty),
            comment: serviceForm.comment || '',
            custom_service_name: serviceForm.custom_service_name,
            custom_price: Number(serviceForm.custom_price),
            custom_unit: serviceForm.custom_unit || 'усл.',
          }
        : {
            service_id: serviceForm.service_id,
            qty: Number(serviceForm.qty),
            comment: serviceForm.comment || '',
          };

      await api.post(`/api/work-orders/${selectedOrder.order_id}/services`, payload);
      setServiceForm(emptyServiceForm);
      setUseCustomService(false);
      setSuccess('Услуга добавлена в заказ.');
      await loadMeta();
      await loadOrderDetails(selectedOrder.order_id);
      await loadOrders();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRemoveService(orderServiceId) {
    if (!selectedOrder) return;
    if (!window.confirm('Удалить услугу из заказа?')) return;

    setError('');
    setSuccess('');
    try {
      await api.delete(`/api/work-orders/${selectedOrder.order_id}/services/${orderServiceId}`);
      setSuccess('Услуга удалена из заказа.');
      await loadOrderDetails(selectedOrder.order_id);
      await loadOrders();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAddPart(event) {
    event.preventDefault();
    if (!selectedOrder) return;

    setError('');
    setSuccess('');
    try {
      await api.post(`/api/work-orders/${selectedOrder.order_id}/parts`, {
        part_id: partForm.part_id,
        qty: Number(partForm.qty),
        note: partForm.note || '',
      });

      setPartForm(emptyPartForm);
      setSuccess('Запчасть добавлена в заказ.');
      await loadOrderDetails(selectedOrder.order_id);
      await loadOrders();
      await loadMeta();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRemovePart(orderPartId) {
    if (!selectedOrder) return;
    if (!window.confirm('Удалить запчасть из заказа?')) return;

    setError('');
    setSuccess('');
    try {
      await api.delete(`/api/work-orders/${selectedOrder.order_id}/parts/${orderPartId}`);
      setSuccess('Запчасть удалена из заказа.');
      await loadOrderDetails(selectedOrder.order_id);
      await loadOrders();
      await loadMeta();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleChangeStatus(newStatus) {
    if (!selectedOrder) return;

    setError('');
    setSuccess('');
    try {
      await api.patch(`/api/work-orders/${selectedOrder.order_id}/status`, {
        status: newStatus,
        admin_closing_comment: newStatus === 'Выполнен' ? adminClosingComment : undefined,
      });

      setSuccess(`Статус заказа изменён на «${newStatus}».`);
      await loadOrderDetails(selectedOrder.order_id);
      await loadOrders();
    } catch (e) {
      setError(e.message);
    }
  }

  const statusOptions = ACTIVE_ORDER_STATUSES;

  return (
    <section className="page-grid">
      <div className="stack">
        <form className="card form-card" onSubmit={handleSubmitOrder}>
          <div className="row-between">
            <div>
              <h3>{editingId ? 'Редактирование заказ-наряда' : 'Создание заказ-наряда'}</h3>
              <p className="muted">Создание, редактирование и назначение мастера</p>
            </div>
            <button className="secondary-btn" type="button" onClick={startCreate}>Новый заказ</button>
          </div>

          {error && <div className="error-box">{error}</div>}
          {success && <div className="success-box">{success}</div>}

          <label>
            Поиск клиента
            <input
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder="Введите ФИО или наименование клиента"
            />
          </label>

          <label>
            Клиент
            <select name="client_id" value={form.client_id} onChange={handleOrderFieldChange} required>
              <option value="">Выберите клиента</option>
              {filteredClients.map((client) => (
                <option key={client.client_id} value={client.client_id}>{client.name}</option>
              ))}
            </select>
          </label>

          <label>
            Поиск автомобиля
            <input value={vehicleSearch} onChange={(e) => setVehicleSearch(e.target.value)} placeholder="Марка, модель, гос. номер, VIN" />
          </label>

          <label>
            Автомобиль
            <select name="vehicle_id" value={form.vehicle_id} onChange={handleOrderFieldChange} required>
              <option value="">Выберите автомобиль</option>
              {availableVehicles.map((vehicle) => (
                <option key={vehicle.vehicle_id} value={vehicle.vehicle_id}>
                  {vehicle.client_name ? `${vehicle.client_name} — ` : ''}
                  {vehicle.make} {vehicle.model}{vehicle.plate_no ? ` (${vehicle.plate_no})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            Мастер
            <select name="master_id" value={form.master_id} onChange={handleOrderFieldChange}>
              <option value="">Не назначен</option>
              {masters.map((master) => (
                <option key={master.user_id} value={master.user_id}>
                  {master.full_name} — активных заказов: {master.active_orders_count ?? 0}
                </option>
              ))}
            </select>
          </label>

          <label>
            Описание неисправности
            <textarea name="problem_desc" value={form.problem_desc} onChange={handleOrderFieldChange} required />
          </label>

          <label>
            Комментарий администратора
            <textarea name="admin_comment" value={form.admin_comment} onChange={handleOrderFieldChange} />
          </label>

          <div className="actions-row">
            <button className="primary-btn" type="submit">{editingId ? 'Сохранить изменения' : 'Создать заказ-наряд'}</button>
            {editingId && <button className="secondary-btn" type="button" onClick={resetForm}>Отмена</button>}
          </div>
        </form>

        <div className="card">
          <div className="row-between">
            <div>
              <h3>Каталог заказ-нарядов</h3>
              <p className="muted">Поиск, фильтрация, сортировка и просмотр заказов</p>
            </div>
          </div>

          <div className="filters-bar">
            <input className="search-input" placeholder="Поиск по номеру, клиенту, авто, описанию" value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} />
            <select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}>
              <option value="ALL">Все активные статусы</option>
              {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <select value={filters.master_id} onChange={(e) => setFilters((prev) => ({ ...prev, master_id: e.target.value }))}>
              <option value="ALL">Все мастера</option>
              {masters.map((master) => <option key={master.user_id} value={master.user_id}>{master.full_name}</option>)}
            </select>
            <select value={filters.sort} onChange={(e) => setFilters((prev) => ({ ...prev, sort: e.target.value }))}>
              <option value="newest">Сначала новые</option>
              <option value="oldest">Сначала старые</option>
              <option value="order_no_asc">Номер А-Я</option>
              <option value="order_no_desc">Номер Я-А</option>
              <option value="status_asc">Статус А-Я</option>
              <option value="client_asc">Клиент А-Я</option>
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {!loading && orders.map((order) => (
                  <tr key={order.order_id}>
                    <td>{order.order_no}</td>
                    <td>{order.client_name}</td>
                    <td>{order.make} {order.model}{order.plate_no ? ` (${order.plate_no})` : ''}</td>
                    <td>{order.master_name || 'Не назначен'}</td>
                    <td><span className={`badge ${getOrderStatusBadgeClass(order.status)}`}>{order.status}</span></td>
                    <td>{formatDateTime(order.created_at)}</td>
                    <td>
                      <div className="actions-row">
                        <button className="secondary-btn" type="button" onClick={() => handleOpenOrder(order.order_id)}>Открыть</button>
                        <button className="secondary-btn" type="button" onClick={() => startEdit(order)}>Изменить</button>
                        {order.status !== 'Отменён' && order.status !== 'Выполнен' && (
                          <button className="danger-btn" type="button" onClick={() => handleCancelOrder(order.order_id)}>Отменить</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && !orders.length && <tr><td colSpan="7" className="muted">Заказ-наряды не найдены.</td></tr>}
                {loading && <tr><td colSpan="7" className="muted">Загрузка...</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <h3>Карточка заказ-наряда</h3>

          {!selectedOrder && <p className="muted">Выберите заказ-наряд из списка слева.</p>}
          {detailsLoading && <p className="muted">Загрузка карточки заказа...</p>}

          {selectedOrder && !detailsLoading && (
            <>
              <div className="details-grid">
                <div className="inner-card">
                  <h4>Основная информация</h4>
                  <p><strong>Номер:</strong> {selectedOrder.order_no}</p>
                  <p><strong>Статус:</strong> <span className={`badge ${getOrderStatusBadgeClass(selectedOrder.status)}`}>{selectedOrder.status}</span></p>
                  <p><strong>Клиент:</strong> {selectedOrder.client_name || '—'}</p>
                  <p><strong>Автомобиль:</strong> {selectedOrder.make} {selectedOrder.model}{selectedOrder.plate_no ? ` (${selectedOrder.plate_no})` : ''}</p>
                  <p><strong>Мастер:</strong> {selectedOrder.master_name || 'Не назначен'}</p>
                  <p><strong>Создан:</strong> {formatDateTime(selectedOrder.created_at)}</p>
                  <p><strong>Принят в работу:</strong> {formatDateTime(selectedOrder.accepted_at)}</p>
                  <p><strong>План сдачи:</strong> {formatDateTime(selectedOrder.planned_completion_at)}</p>
                  <p><strong>Сдан мастером:</strong> {formatDateTime(selectedOrder.master_submitted_at)}</p>
                  <p><strong>Завершён:</strong> {formatDateTime(selectedOrder.completed_at)}</p>
                </div>

                <div className="inner-card">
                  <h4>Описание</h4>
                  <p><strong>Неисправность:</strong> {selectedOrder.problem_desc || '—'}</p>
                  <p><strong>Комментарий администратора:</strong> {selectedOrder.admin_comment || '—'}</p>
                  <p><strong>Итоговый комментарий:</strong> {selectedOrder.admin_closing_comment || '—'}</p>
                </div>
              </div>

              <div className="card inner-card">
                <div className="row-between">
                  <h4>Статусы</h4>
                  <div className="actions-row">
                    {selectedOrder.status !== 'Отменён' && selectedOrder.status !== 'Выполнен' && (
                      <button className="danger-btn" type="button" onClick={() => handleChangeStatus('Отменён')}>Отменить заказ</button>
                    )}
                  </div>
                </div>

                {selectedOrder.status === 'Сдан мастером' && (
                  <div className="stack" style={{ marginBottom: 12 }}>
                    <label>
                      Краткий отчёт администратора
                      <textarea value={adminClosingComment} onChange={(e) => setAdminClosingComment(sanitizeText(e.target.value))} placeholder="Например: заказ выполнен в срок, замечаний нет" />
                    </label>
                    <button className="primary-btn" type="button" onClick={() => handleChangeStatus('Выполнен')}>Завершить заказ</button>
                  </div>
                )}

                <div className="table-card">
                  <table>
                    <thead>
                      <tr>
                        <th>Старый статус</th>
                        <th>Новый статус</th>
                        <th>Кто изменил</th>
                        <th>Комментарий</th>
                        <th>Дата</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((row) => (
                        <tr key={row.history_id || `${row.changed_at}-${row.new_status}`}>
                          <td>{row.old_status || '—'}</td>
                          <td><span className={`badge ${getOrderStatusBadgeClass(row.new_status)}`}>{row.new_status}</span></td>
                          <td>{row.changed_by_name || row.full_name || row.changed_by || '—'}</td>
                          <td>{row.comment || '—'}</td>
                          <td>{formatDateTime(row.changed_at)}</td>
                        </tr>
                      ))}
                      {!historyRows.length && <tr><td colSpan="5" className="muted">История статусов отсутствует.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card inner-card">
                <h4>Услуги заказа</h4>

                {selectedOrder.status !== 'Выполнен' && selectedOrder.status !== 'Отменён' && (
                  <>
                    <div className="actions-row" style={{ marginTop: 0, marginBottom: 12 }}>
                      <button className={useCustomService ? 'secondary-btn' : 'primary-btn'} type="button" onClick={() => setUseCustomService(false)}>Из справочника</button>
                      <button className={useCustomService ? 'primary-btn' : 'secondary-btn'} type="button" onClick={() => setUseCustomService(true)}>Своя услуга</button>
                    </div>

                    {useCustomService && (
                      <div className="custom-service-fields">
                        <input
                          placeholder="Название услуги"
                          value={serviceForm.custom_service_name}
                          onChange={(e) => setServiceForm((prev) => ({ ...prev, custom_service_name: sanitizeText(e.target.value) }))}
                        />
                        <input
                          placeholder="Цена"
                          inputMode="decimal"
                          value={serviceForm.custom_price}
                          onChange={(e) => setServiceForm((prev) => ({ ...prev, custom_price: onlyMoney(e.target.value) }))}
                        />
                        <input
                          placeholder="Ед. изм."
                          value={serviceForm.custom_unit}
                          onChange={(e) => setServiceForm((prev) => ({ ...prev, custom_unit: sanitizeText(e.target.value) || 'усл.' }))}
                        />
                      </div>
                    )}

                    <form className={`compact-form ${useCustomService ? 'compact-form-6' : 'compact-form-5'}`} onSubmit={handleAddService}>
                      {!useCustomService && (
                        <select value={serviceForm.service_id} onChange={(e) => setServiceForm((prev) => ({ ...prev, service_id: e.target.value }))} required>
                          <option value="">Услуга</option>
                          {services.map((service) => <option key={service.service_id} value={service.service_id}>{service.service_name}</option>)}
                        </select>
                      )}

                      {useCustomService && (
                        <input value={serviceForm.custom_service_name} readOnly placeholder="Название услуги" />
                      )}

                      <input type="text" inputMode="numeric" placeholder="Кол-во" value={serviceForm.qty} onChange={(e) => setServiceForm((prev) => ({ ...prev, qty: onlyInteger(e.target.value) }))} required />
                      <input value={useCustomService ? serviceForm.custom_price : (selectedServiceMeta ? `${selectedServiceMeta.base_price}` : '')} placeholder="Цена" readOnly={useCustomService ? false : true} onChange={useCustomService ? (e) => setServiceForm((prev) => ({ ...prev, custom_price: onlyMoney(e.target.value) })) : undefined} />
                      <input placeholder="Комментарий" value={serviceForm.comment} onChange={(e) => setServiceForm((prev) => ({ ...prev, comment: sanitizeText(e.target.value) }))} />
                      <button className="primary-btn" type="submit">Добавить</button>
                    </form>
                  </>
                )}

                <div className="table-card">
                  <table>
                    <thead>
                      <tr>
                        <th>Услуга</th>
                        <th>Кол-во</th>
                        <th>Ед. изм.</th>
                        <th>Цена</th>
                        <th>Сумма</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {serviceRows.map((item) => (
                        <tr key={item.order_service_id}>
                          <td>{item.service_name}</td>
                          <td>{item.qty}</td>
                          <td>{item.unit || 'усл.'}</td>
                          <td>{money(item.price)}</td>
                          <td>{money(item.amount || Number(item.qty || 0) * Number(item.price || 0))}</td>
                          <td>
                            {selectedOrder.status !== 'Выполнен' && selectedOrder.status !== 'Отменён' && (
                              <button className="danger-btn" type="button" onClick={() => handleRemoveService(item.order_service_id)}>Удалить</button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!serviceRows.length && <tr><td colSpan="6" className="muted">Услуги не добавлены.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card inner-card">
                <h4>Запчасти заказа</h4>

                {selectedOrder.status !== 'Выполнен' && selectedOrder.status !== 'Отменён' && (
                  <form className="compact-form compact-form-6" onSubmit={handleAddPart}>
                    <select value={partForm.part_id} onChange={(e) => setPartForm((prev) => ({ ...prev, part_id: e.target.value }))} required>
                      <option value="">Запчасть</option>
                      {parts.map((part) => (
                        <option key={part.part_id} value={part.part_id}>
                          {part.part_name} (остаток: {part.stock_qty} {part.unit})
                        </option>
                      ))}
                    </select>
                    <input type="text" inputMode="numeric" placeholder="Кол-во" value={partForm.qty} onChange={(e) => setPartForm((prev) => ({ ...prev, qty: onlyInteger(e.target.value) }))} required />
                    <input value={selectedPartMeta ? `${selectedPartMeta.sale_price || 0}` : ''} placeholder="Цена" readOnly />
                    <input value={selectedPartMeta ? `${partForm.qty || 0}` : ''} placeholder="Резерв" readOnly />
                    <input placeholder="Примечание" value={partForm.note} onChange={(e) => setPartForm((prev) => ({ ...prev, note: sanitizeText(e.target.value) }))} />
                    <button className="primary-btn" type="submit">Добавить</button>
                  </form>
                )}

                <div className="table-card">
                  <table>
                    <thead>
                      <tr>
                        <th>Запчасть</th>
                        <th>Кол-во</th>
                        <th>Резерв</th>
                        <th>Списано</th>
                        <th>Цена</th>
                        <th>Сумма</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {partRows.map((item) => (
                        <tr key={item.order_part_id}>
                          <td>{item.part_name}</td>
                          <td>{item.qty_reserved}</td>
                          <td>{item.qty_reserved}</td>
                          <td>{item.qty_used}</td>
                          <td>{money(item.unit_price)}</td>
                          <td>{money(item.amount || Number(item.qty_reserved || 0) * Number(item.unit_price || 0))}</td>
                          <td>
                            {selectedOrder.status !== 'Выполнен' && selectedOrder.status !== 'Отменён' && (
                              <button className="danger-btn" type="button" onClick={() => handleRemovePart(item.order_part_id)}>Удалить</button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!partRows.length && <tr><td colSpan="7" className="muted">Запчасти не добавлены.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="summary-grid">
                <div className="inner-card summary-card">
                  <h4>Стоимость работ</h4>
                  <p><strong>Услуги:</strong> {money(servicesTotal)}</p>
                  <p><strong>Запчасти:</strong> {money(partsTotal)}</p>
                  <p className="summary-total">Итого: {money(grandTotal)}</p>
                </div>
                <div className="inner-card summary-card">
                  <h4>Отчёт мастера</h4>
                  {!masterReport && <p className="muted">Отчёт мастера пока отсутствует.</p>}
                  {masterReport && (
                    <>
                      <p><strong>Диагностика:</strong> {masterReport.diagnostic_text || '—'}</p>
                      <p><strong>Выполненные работы:</strong> {masterReport.work_performed_text || '—'}</p>
                      <p><strong>Использованные запчасти:</strong> {masterReport.parts_used_text || '—'}</p>
                      <p><strong>Рекомендации:</strong> {masterReport.recommendations_text || '—'}</p>
                      <p><strong>Результат:</strong> {masterReport.result_text || '—'}</p>
                      <p><strong>Создан:</strong> {formatDateTime(masterReport.created_at)}</p>
                      <p><strong>Обновлён:</strong> {formatDateTime(masterReport.updated_at)}</p>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}