import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const emptyVehicle = {
  client_id: '',
  vin: '',
  plate_no: '',
  make: '',
  model: '',
  year: '',
  mileage: '',
};

function onlyInteger(value) {
  return value.replace(/[^\d]/g, '');
}

function sanitizeVin(value) {
  return value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17);
}

function sanitizePlate(value) {
  return value.toUpperCase().replace(/[^A-Za-zА-Яа-яЁё0-9\s-]/g, '').slice(0, 15);
}

function sanitizeVehicleText(value) {
  return value.replace(/[<>`]/g, '').replace(/[^A-Za-zА-Яа-яЁё0-9\s.'()/-]/g, '').slice(0, 60);
}

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState('');

  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState('ALL');
  const [makeFilter, setMakeFilter] = useState('ALL');
  const [sort, setSort] = useState('newest');

  const [form, setForm] = useState(emptyVehicle);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  async function loadData() {
    try {
      const [vehiclesData, clientsData] = await Promise.all([
        api.get(
          `/api/vehicles?search=${encodeURIComponent(search)}&client_id=${encodeURIComponent(clientId)}&make=${encodeURIComponent(makeFilter)}&sort=${encodeURIComponent(sort)}`
        ),
        api.get('/api/clients'),
      ]);
      setVehicles(vehiclesData.vehicles);
      setClients(clientsData.clients);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadData();
  }, [search, clientId, makeFilter, sort]);

  const makes = useMemo(() => {
    const set = new Set(vehicles.map((v) => v.make).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [vehicles]);

  const filteredClients = useMemo(() => {
    const searchValue = clientSearch.trim().toLowerCase();
    if (!searchValue) return clients;

    return clients.filter((client) =>
      String(client.name).toLowerCase().includes(searchValue)
    );
  }, [clients, clientSearch]);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((prev) => {
      if (name === 'vin') return { ...prev, vin: sanitizeVin(value) };
      if (name === 'plate_no') return { ...prev, plate_no: sanitizePlate(value) };
      if (name === 'make') return { ...prev, make: sanitizeVehicleText(value) };
      if (name === 'model') return { ...prev, model: sanitizeVehicleText(value) };
      if (name === 'year') return { ...prev, year: onlyInteger(value).slice(0, 4) };
      if (name === 'mileage') return { ...prev, mileage: onlyInteger(value) };

      return { ...prev, [name]: value };
    });
  }

  function startEdit(vehicle) {
    setEditingId(vehicle.vehicle_id);
    setForm({
      client_id: String(vehicle.client_id),
      vin: vehicle.vin || '',
      plate_no: vehicle.plate_no || '',
      make: vehicle.make || '',
      model: vehicle.model || '',
      year: vehicle.year || '',
      mileage: vehicle.mileage || '',
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyVehicle);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      if (editingId) {
        await api.put(`/api/vehicles/${editingId}`, form);
      } else {
        await api.post('/api/vehicles', form);
      }
      resetForm();
      await loadData();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Удалить автомобиль?')) return;
    try {
      await api.delete(`/api/vehicles/${id}`);
      if (editingId === id) resetForm();
      await loadData();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section className="page-grid">
      <div className="card">
        <div className="row-between">
          <div>
            <h3>Каталог автомобилей</h3>
            <p className="muted">Поиск, фильтрация, сортировка и полный список характеристик автомобилей</p>
          </div>
          <div className="filters-bar">
            <input
              className="search-input"
              placeholder="Поиск по VIN, номеру, марке, модели"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="ALL">Все клиенты</option>
              {clients.map((client) => (
                <option key={client.client_id} value={client.client_id}>{client.name}</option>
              ))}
            </select>
            <select value={makeFilter} onChange={(e) => setMakeFilter(e.target.value)}>
              <option value="ALL">Все марки</option>
              {makes.map((make) => (
                <option key={make} value={make}>{make}</option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="newest">Сначала новые</option>
              <option value="oldest">Сначала старые</option>
              <option value="make_asc">Марка А-Я</option>
              <option value="make_desc">Марка Я-А</option>
              <option value="year_desc">Год убыв.</option>
              <option value="year_asc">Год возр.</option>
              <option value="mileage_desc">Пробег убыв.</option>
              <option value="mileage_asc">Пробег возр.</option>
            </select>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Клиент</th>
                <th>VIN</th>
                <th>Гос. номер</th>
                <th>Марка</th>
                <th>Модель</th>
                <th>Год</th>
                <th>Пробег</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((vehicle) => (
                <tr key={vehicle.vehicle_id}>
                  <td>{vehicle.client_name}</td>
                  <td>{vehicle.vin || '—'}</td>
                  <td>{vehicle.plate_no || '—'}</td>
                  <td>{vehicle.make}</td>
                  <td>{vehicle.model}</td>
                  <td>{vehicle.year || '—'}</td>
                  <td>{vehicle.mileage || '—'}</td>
                  <td>
                    <div className="actions-row">
                      <button className="secondary-btn" onClick={() => startEdit(vehicle)}>Изменить</button>
                      <button className="danger-btn" onClick={() => handleDelete(vehicle.vehicle_id)}>Удалить</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!vehicles.length && (
                <tr>
                  <td colSpan="8" className="muted">Автомобили не найдены.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <form className="card form-card" onSubmit={handleSubmit}>
        <h3>{editingId ? 'Редактирование автомобиля' : 'Создание автомобиля'}</h3>

        <label>
          Поиск клиента
          <input
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            placeholder="Поиск по имени клиента"
          />
        </label>

        <label>
          Клиент
          <select name="client_id" value={form.client_id} onChange={handleChange} required>
            <option value="">Выберите клиента</option>
            {filteredClients.map((client) => (
              <option key={client.client_id} value={client.client_id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          VIN
          <input
            name="vin"
            value={form.vin}
            onChange={handleChange}
            pattern="^[A-HJ-NPR-Z0-9]{17}$"
            maxLength={17}
          />
        </label>

        <label>
          Гос. номер
          <input name="plate_no" value={form.plate_no} onChange={handleChange} maxLength={15} />
        </label>

        <label>
          Марка
          <input name="make" value={form.make} onChange={handleChange} required maxLength={60} />
        </label>

        <label>
          Модель
          <input name="model" value={form.model} onChange={handleChange} required maxLength={60} />
        </label>

        <label>
          Год выпуска
          <input name="year" type="number" min="1950" max="2100" value={form.year} onChange={handleChange} />
        </label>

        <label>
          Пробег
          <input name="mileage" type="number" min="0" value={form.mileage} onChange={handleChange} />
        </label>

        <div className="actions-row">
          <button className="primary-btn" type="submit">
            {editingId ? 'Сохранить изменения' : 'Добавить автомобиль'}
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