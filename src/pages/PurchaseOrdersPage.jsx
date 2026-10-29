import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const emptyItem = {
  part_id: '',
  qty: '1',
};

const emptyForm = {
  supplier_id: '',
  expected_date: '',
  comment: '',
};

const emptySupplier = {
  supplier_name: '',
  phone: '',
  email: '',
  comment: '',
};

function onlyInteger(value) {
  return String(value ?? '').replace(/[^\d]/g, '');
}

function sanitizeSupplierText(value) {
  return String(value ?? '')
    .replace(/[<>`]/g, '')
    .replace(/[^A-Za-zА-Яа-яЁё0-9\s"'().,№#&/-]/g, '');
}

function sanitizePhone(value) {
  return String(value ?? '').replace(/[^\d+\-()\s]/g, '').slice(0, 20);
}

function sanitizeEmail(value) {
  return String(value ?? '')
    .replace(/\s/g, '')
    .replace(/[^A-Za-z0-9@._%+-]/g, '')
    .slice(0, 120);
}

function sanitizeComment(value) {
  return String(value ?? '').replace(/[<>`]/g, '');
}

function todayString() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [parts, setParts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sort, setSort] = useState('newest');

  const [form, setForm] = useState(emptyForm);
  const [itemForm, setItemForm] = useState(emptyItem);
  const [items, setItems] = useState([]);
  const [supplierForm, setSupplierForm] = useState(emptySupplier);

  const [loading, setLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [partsError, setPartsError] = useState('');
  const [suppliersError, setSuppliersError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadData() {
    setLoading(true);
    setOrdersError('');
    setPartsError('');
    setSuppliersError('');
    setSubmitError('');

    const [ordersResult, partsResult, suppliersResult] = await Promise.allSettled([
      api.get(
        `/api/purchase-orders?search=${encodeURIComponent(search)}&status=${encodeURIComponent(statusFilter)}&sort=${encodeURIComponent(sort)}`
      ),
      api.get('/api/parts?active=true&stock=positive&sort=name_asc'),
      api.get('/api/suppliers'),
    ]);

    if (ordersResult.status === 'fulfilled') {
      setOrders(Array.isArray(ordersResult.value?.orders) ? ordersResult.value.orders : []);
    } else {
      setOrders([]);
      setOrdersError(ordersResult.reason?.message || 'Не удалось загрузить список заказов запчастей.');
    }

    if (partsResult.status === 'fulfilled') {
      setParts(Array.isArray(partsResult.value?.parts) ? partsResult.value.parts : []);
    } else {
      setParts([]);
      setPartsError(partsResult.reason?.message || 'Не удалось загрузить каталог запчастей.');
    }

    if (suppliersResult.status === 'fulfilled') {
      setSuppliers(Array.isArray(suppliersResult.value?.suppliers) ? suppliersResult.value.suppliers : []);
    } else {
      setSuppliers([]);
      setSuppliersError(suppliersResult.reason?.message || 'Не удалось загрузить поставщиков.');
    }

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, [search, statusFilter, sort]);

  const selectedPart = useMemo(
    () => parts.find((part) => String(part.part_id) === String(itemForm.part_id)),
    [parts, itemForm.part_id]
  );

  function handleFormChange(event) {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function handleItemChange(event) {
    const { name, value } = event.target;

    setItemForm((prev) => {
      if (name === 'qty') {
        return { ...prev, qty: onlyInteger(value) };
      }
      return { ...prev, [name]: value };
    });
  }

  function handleSupplierChange(event) {
    const { name, value } = event.target;

    setSupplierForm((prev) => {
      if (name === 'supplier_name') return { ...prev, supplier_name: sanitizeSupplierText(value) };
      if (name === 'phone') return { ...prev, phone: sanitizePhone(value) };
      if (name === 'email') return { ...prev, email: sanitizeEmail(value) };
      if (name === 'comment') return { ...prev, comment: sanitizeComment(value) };
      return { ...prev, [name]: value };
    });
  }

  function addItem() {
    setSubmitError('');
    setSuccess('');

    if (!itemForm.part_id) {
      setSubmitError('Выберите запчасть.');
      return;
    }

    const qty = Number(itemForm.qty);
    if (!Number.isInteger(qty) || qty <= 0) {
      setSubmitError('Количество должно быть целым числом больше нуля.');
      return;
    }

    const part = parts.find((p) => String(p.part_id) === String(itemForm.part_id));
    if (!part) {
      setSubmitError('Выбранная запчасть не найдена.');
      return;
    }

    const existingIndex = items.findIndex((item) => Number(item.part_id) === Number(part.part_id));

    if (existingIndex >= 0) {
      const updated = [...items];
      updated[existingIndex] = {
        ...updated[existingIndex],
        qty: updated[existingIndex].qty + qty,
      };
      setItems(updated);
    } else {
      setItems((prev) => [
        ...prev,
        {
          part_id: part.part_id,
          qty,
          part_name: part.part_name,
          unit: part.unit,
          unit_cost: part.purchase_price || 0,
        },
      ]);
    }

    setItemForm(emptyItem);
  }

  function removeItem(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError('');
    setSuccess('');

    try {
      await api.post('/api/purchase-orders', {
        ...form,
        items: items.map((item) => ({
          part_id: item.part_id,
          qty: item.qty,
        })),
      });

      setForm(emptyForm);
      setItemForm(emptyItem);
      setItems([]);
      setSuccess('Заказ запчастей создан.');
      await loadData();
    } catch (e) {
      setSubmitError(e.message);
    }
  }

  async function handleCreateSupplier(event) {
    event.preventDefault();
    setSubmitError('');
    setSuccess('');

    try {
      await api.post('/api/suppliers', supplierForm);
      setSupplierForm(emptySupplier);
      setSuccess('Поставщик успешно добавлен.');
      await loadData();
    } catch (e) {
      setSubmitError(e.message);
    }
  }

  async function handleSend(id) {
    setSubmitError('');
    setSuccess('');

    try {
      await api.patch(`/api/purchase-orders/${id}/status`, { status: 'Отправлен' });
      setSuccess('Заказ переведён в статус «Отправлен».');
      await loadData();
    } catch (e) {
      setSubmitError(e.message);
    }
  }

  async function handleReceive(id) {
    setSubmitError('');
    setSuccess('');

    try {
      await api.patch(`/api/purchase-orders/${id}/status`, { status: 'Получен' });
      setSuccess('Заказ переведён в статус «Получен», запчасти добавлены на склад.');
      await loadData();
    } catch (e) {
      setSubmitError(e.message);
    }
  }

  return (
    <section className="page-grid">
      <div className="stack">
        <form className="card form-card" onSubmit={handleSubmit}>
          <h3>Заказ запчастей</h3>

          {submitError && <div className="error-box">{submitError}</div>}
          {success && <div className="success-box">{success}</div>}
          {suppliersError && <div className="error-box">Ошибка поставщиков: {suppliersError}</div>}
          {partsError && <div className="error-box">Ошибка каталога запчастей: {partsError}</div>}

          <label>
            Поставщик
            <select name="supplier_id" value={form.supplier_id} onChange={handleFormChange} required>
              <option value="">Выберите поставщика</option>
              {suppliers.map((supplier) => (
                <option key={supplier.supplier_id} value={supplier.supplier_id}>
                  {supplier.supplier_name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Ожидаемая дата
            <input
              name="expected_date"
              type="date"
              min={todayString()}
              value={form.expected_date}
              onChange={handleFormChange}
            />
          </label>

          <label>
            Комментарий
            <textarea name="comment" value={form.comment} onChange={handleFormChange} />
          </label>

          <div className="inner-card">
            <h4>Позиции заказа</h4>

            <div className="compact-form">
              <select name="part_id" value={itemForm.part_id} onChange={handleItemChange}>
                <option value="">Запчасть</option>
                {parts.map((part) => (
                  <option key={part.part_id} value={part.part_id}>
                    {part.part_name}
                  </option>
                ))}
              </select>

              <input
                name="qty"
                value={itemForm.qty}
                onChange={handleItemChange}
                placeholder="Кол-во"
                inputMode="numeric"
              />

              <input
                value={selectedPart ? `${selectedPart.purchase_price || 0}` : ''}
                placeholder="Цена закупки"
                readOnly
              />

              <input
                value={selectedPart ? selectedPart.unit : ''}
                placeholder="Ед. изм."
                readOnly
              />

              <button className="secondary-btn" type="button" onClick={addItem}>
                Добавить позицию
              </button>
            </div>

            <div className="stack small-stack">
              {items.map((item, index) => (
                <div className="row-between inner-card" key={`${item.part_id}-${index}`}>
                  <span>
                    {item.part_name} — {item.qty} {item.unit} × {item.unit_cost}
                  </span>
                  <button className="danger-btn" type="button" onClick={() => removeItem(index)}>
                    Удалить
                  </button>
                </div>
              ))}
              {!items.length && <p className="muted">Позиции не добавлены.</p>}
            </div>
          </div>

          <button className="primary-btn" type="submit">Создать заказ запчастей</button>
        </form>

        <form className="card form-card" onSubmit={handleCreateSupplier}>
          <h3>Поставщики</h3>

          <label>
            Наименование поставщика
            <input
              name="supplier_name"
              value={supplierForm.supplier_name}
              onChange={handleSupplierChange}
              required
            />
          </label>

          <label>
            Телефон
            <input
              name="phone"
              value={supplierForm.phone}
              onChange={handleSupplierChange}
            />
          </label>

          <label>
            Email
            <input
              name="email"
              value={supplierForm.email}
              onChange={handleSupplierChange}
            />
          </label>

          <label>
            Комментарий
            <textarea
              name="comment"
              value={supplierForm.comment}
              onChange={handleSupplierChange}
            />
          </label>

          <button className="primary-btn" type="submit">Добавить поставщика</button>

          <div className="table-card" style={{ marginTop: '12px' }}>
            <table>
              <thead>
                <tr>
                  <th>Поставщик</th>
                  <th>Телефон</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.supplier_id}>
                    <td>{supplier.supplier_name}</td>
                    <td>{supplier.phone || '—'}</td>
                    <td>{supplier.email || '—'}</td>
                  </tr>
                ))}
                {!suppliers.length && (
                  <tr>
                    <td colSpan="3" className="muted">Поставщики отсутствуют.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="row-between">
          <div>
            <h3>Список заказов запчастей</h3>
            <p className="muted">Поиск, фильтрация и сортировка заказов поставщикам</p>
          </div>
          <div className="filters-bar">
            <input
              className="search-input"
              placeholder="Поиск по номеру, поставщику, комментарию"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="ALL">Все статусы</option>
              <option value="Черновик">Черновик</option>
              <option value="Отправлен">Отправлен</option>
              <option value="Получен">Получен</option>
              <option value="Отменён">Отменён</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="newest">Сначала новые</option>
              <option value="oldest">Сначала старые</option>
              <option value="supplier_asc">Поставщик А-Я</option>
              <option value="supplier_desc">Поставщик Я-А</option>
              <option value="status_asc">По статусу</option>
              <option value="expected_date_asc">Ожидаемая дата ↑</option>
              <option value="expected_date_desc">Ожидаемая дата ↓</option>
            </select>
          </div>
        </div>

        {ordersError && <div className="error-box">Ошибка списка заказов: {ordersError}</div>}
        {loading && <p className="muted">Загрузка...</p>}

        <div className="stack">
          {!loading && orders.map((order) => (
            <div key={order.po_id} className="card inner-card">
              <div className="row-between">
                <div>
                  <h4>{order.po_no}</h4>
                  <p className="muted">{order.supplier_name}</p>
                </div>
                <span className="badge badge-muted">{order.status}</span>
              </div>

              <p><strong>Создал:</strong> {order.created_by_name}</p>
              <p><strong>Ожидаемая дата:</strong> {order.expected_date || '—'}</p>
              <p><strong>Комментарий:</strong> {order.comment || '—'}</p>

              <div className="table-card">
                <table>
                  <thead>
                    <tr>
                      <th>Запчасть</th>
                      <th>Кол-во</th>
                      <th>Ед. изм.</th>
                      <th>Цена закупки</th>
                      <th>Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Array.isArray(order.items) ? order.items : []).map((item) => (
                      <tr key={item.po_item_id}>
                        <td>{item.part_name}</td>
                        <td>{item.qty}</td>
                        <td>{item.unit}</td>
                        <td>{item.unit_cost ?? '—'}</td>
                        <td>{item.amount}</td>
                      </tr>
                    ))}
                    {!order.items?.length && (
                      <tr>
                        <td colSpan="5" className="muted">Позиции отсутствуют.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {order.status === 'Черновик' && (
                <button className="primary-btn" onClick={() => handleSend(order.po_id)}>
                  Отправить
                </button>
              )}

              {order.status === 'Отправлен' && (
                <button className="primary-btn" onClick={() => handleReceive(order.po_id)}>
                  Отметить как «Получен»
                </button>
              )}
            </div>
          ))}

          {!loading && !orders.length && !ordersError && (
            <p className="muted">Заказы запчастей отсутствуют.</p>
          )}
        </div>
      </div>
    </section>
  );
}