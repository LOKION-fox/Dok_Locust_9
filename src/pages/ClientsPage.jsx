import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const emptyClient = {
  client_type: 'PERSON',
  name: '',
  phone: '',
  email: '',
  address: '',
  comment: '',
};

function sanitizeClientName(value, clientType) {
  const cleaned = String(value ?? '').replace(/[<>`]/g, '');

  if (clientType === 'PERSON') {
    return cleaned.replace(/[^A-Za-zА-Яа-яЁё\s.'-]/g, '').slice(0, 200);
  }

  return cleaned.replace(/[^A-Za-zА-Яа-яЁё0-9\s"'().,№#&/-]/g, '').slice(0, 200);
}

function sanitizeEmail(value) {
  return String(value ?? '')
    .replace(/\s/g, '')
    .replace(/[^A-Za-z0-9@._%+-]/g, '')
    .slice(0, 120);
}

function sanitizeAddress(value) {
  return String(value ?? '')
    .replace(/[<>`]/g, '')
    .replace(/[^A-Za-zА-Яа-яЁё0-9\s"'().,№#&/-]/g, '')
    .slice(0, 300);
}

function sanitizeComment(value) {
  return String(value ?? '').replace(/[<>`]/g, '');
}

function formatPhoneInput(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  let local = digits;

  if (local.startsWith('8')) {
    local = `7${local.slice(1)}`;
  }

  if (local.startsWith('7')) {
    local = local.slice(1);
  }

  local = local.slice(0, 10);

  if (!local.length) return '';

  const part1 = local.slice(0, 3);
  const part2 = local.slice(3, 6);
  const part3 = local.slice(6, 8);
  const part4 = local.slice(8, 10);

  let formatted = '+7';
  if (part1) formatted += `-${part1}`;
  if (part2) formatted += `-${part2}`;
  if (part3) formatted += `-${part3}`;
  if (part4) formatted += `-${part4}`;

  return formatted;
}

function phoneIsComplete(value) {
  return /^\+7-\d{3}-\d{3}-\d{2}-\d{2}$/.test(String(value ?? ''));
}

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [clientType, setClientType] = useState('ALL');
  const [sort, setSort] = useState('newest');

  const [form, setForm] = useState(emptyClient);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadClients() {
    try {
      const data = await api.get(
        `/api/clients?search=${encodeURIComponent(search)}&client_type=${encodeURIComponent(clientType)}&sort=${encodeURIComponent(sort)}`
      );
      setClients(data.clients || []);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadClients();
  }, [search, clientType, sort]);

  function resetForm() {
    setForm(emptyClient);
    setEditingId(null);
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((prev) => {
      if (name === 'client_type') {
        return {
          ...prev,
          client_type: value,
          name: sanitizeClientName(prev.name, value),
        };
      }

      if (name === 'name') {
        return { ...prev, name: sanitizeClientName(value, prev.client_type) };
      }

      if (name === 'phone') {
        return { ...prev, phone: formatPhoneInput(value) };
      }

      if (name === 'email') {
        return { ...prev, email: sanitizeEmail(value) };
      }

      if (name === 'address') {
        return { ...prev, address: sanitizeAddress(value) };
      }

      if (name === 'comment') {
        return { ...prev, comment: sanitizeComment(value) };
      }

      return { ...prev, [name]: value };
    });
  }

  function startEdit(client) {
    setEditingId(client.client_id);
    setForm({
      client_type: client.client_type,
      name: client.name,
      phone: client.phone || '',
      email: client.email || '',
      address: client.address || '',
      comment: client.comment || '',
    });
    setError('');
    setSuccess('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (form.phone && !phoneIsComplete(form.phone)) {
      setError('Телефон должен быть заполнен в формате +7-999-123-45-67.');
      return;
    }

    try {
      if (editingId) {
        await api.put(`/api/clients/${editingId}`, form);
        setSuccess('Клиент успешно обновлён.');
      } else {
        await api.post('/api/clients', form);
        setSuccess('Клиент успешно добавлен.');
      }
      resetForm();
      await loadClients();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Удалить клиента?')) return;
    try {
      await api.delete(`/api/clients/${id}`);
      if (editingId === id) resetForm();
      await loadClients();
      setSuccess('Клиент удалён.');
    } catch (e) {
      setError(e.message);
    }
  }

  const selectedLabel = useMemo(
    () => (editingId ? 'Редактирование клиента' : 'Создание клиента'),
    [editingId]
  );

  return (
    <section className="page-grid">
      <div className="card">
        <div className="row-between">
          <div>
            <h3>Каталог клиентов</h3>
            <p className="muted">Поиск, фильтрация, сортировка, добавление и редактирование клиентов</p>
          </div>
          <div className="filters-bar">
            <input
              className="search-input"
              placeholder="Поиск клиента"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={clientType} onChange={(e) => setClientType(e.target.value)}>
              <option value="ALL">Все типы</option>
              <option value="PERSON">PERSON</option>
              <option value="COMPANY">COMPANY</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="newest">Сначала новые</option>
              <option value="oldest">Сначала старые</option>
              <option value="name_asc">Имя А-Я</option>
              <option value="name_desc">Имя Я-А</option>
              <option value="vehicles_desc">По количеству авто</option>
            </select>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}
        {success && <div className="success-box">{success}</div>}

        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Наименование / ФИО</th>
                <th>Тип</th>
                <th>Телефон</th>
                <th>Email</th>
                <th>Автомобили</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.client_id}>
                  <td>{client.name}</td>
                  <td>{client.client_type}</td>
                  <td>{client.phone || '—'}</td>
                  <td>{client.email || '—'}</td>
                  <td>{client.vehicles_count}</td>
                  <td>
                    <div className="actions-row">
                      <button className="secondary-btn" type="button" onClick={() => startEdit(client)}>Изменить</button>
                      
                    </div>
                  </td>
                </tr>
              ))}
              {!clients.length && (
                <tr>
                  <td colSpan="6" className="muted">Клиенты не найдены.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <form className="card form-card" onSubmit={handleSubmit}>
        <h3>{selectedLabel}</h3>

        <label>
          Тип клиента
          <select name="client_type" value={form.client_type} onChange={handleChange}>
            <option value="PERSON">PERSON</option>
            <option value="COMPANY">COMPANY</option>
          </select>
        </label>

        <label>
          Наименование / ФИО
          <input
            name="name"
            value={form.name}
            onChange={handleChange}
            required
            maxLength={200}
          />
        </label>

        <label>
          Телефон
          <input
            name="phone"
            value={form.phone}
            onChange={handleChange}
            placeholder="+7-999-123-45-67"
            inputMode="numeric"
            maxLength={16}
          />
        </label>

        <label>
          Email
          <input
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            maxLength={120}
          />
        </label>

        <label>
          Адрес
          <input
            name="address"
            value={form.address}
            onChange={handleChange}
            maxLength={300}
          />
        </label>

        <label>
          Комментарий
          <textarea
            name="comment"
            value={form.comment}
            onChange={handleChange}
          />
        </label>

        <div className="actions-row">
          <button className="primary-btn" type="submit">
            {editingId ? 'Сохранить изменения' : 'Добавить клиента'}
          </button>
          {editingId && (
            <button className="secondary-btn" type="button" onClick={resetForm}>
              Отмена
            </button>
          )}
        </div>
      </form>
    </section>
  );
}