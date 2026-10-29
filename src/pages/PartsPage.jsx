import { useEffect, useState } from 'react';
import { api } from '../api';

const UNITS = ['шт', 'л', 'мл', 'кг', 'г'];
const SALE_COEFFICIENT = 1.35;

const emptyPart = {
  part_name: '',
  part_code: '',
  unit: 'шт',
  stock_qty: 0,
  purchase_price: '',
  sale_price: '',
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

function sanitizePartName(value) {
  return String(value ?? '')
    .replace(/[<>`]/g, '')
    .replace(/[^A-Za-zА-Яа-яЁё0-9\s"'().,№#&/+%-]/g, '')
    .slice(0, 120);
}

function sanitizePartCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9_.\-\/]/g, '').slice(0, 60);
}

function autoSalePrice(purchasePrice) {
  const num = Number(purchasePrice);
  if (!Number.isFinite(num)) return '';
  return (Math.round(num * SALE_COEFFICIENT * 100) / 100).toFixed(2);
}

function getStockBadgeClass(stockQty) {
  const qty = Number(stockQty || 0);
  if (qty <= 0) return 'stock-zero';
  if (qty <= 5) return 'stock-low';
  if (qty <= 15) return 'stock-medium';
  return 'stock-good';
}

export default function PartsPage() {
  const [parts, setParts] = useState([]);
  const [search, setSearch] = useState('');
  const [stock, setStock] = useState('all');
  const [sort, setSort] = useState('name_asc');
  const [active, setActive] = useState('true');

  const [form, setForm] = useState(emptyPart);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saleEdited, setSaleEdited] = useState(false);

  async function loadParts() {
    try {
      const data = await api.get(
        `/api/parts?search=${encodeURIComponent(search)}&stock=${stock}&sort=${sort}&active=${active}`
      );
      setParts(data.parts || []);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadParts();
  }, [search, stock, sort, active]);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((prev) => {
      if (name === 'part_name') {
        return { ...prev, part_name: sanitizePartName(value) };
      }

      if (name === 'part_code') {
        return { ...prev, part_code: sanitizePartCode(value) };
      }

      if (name === 'stock_qty') {
        return { ...prev, stock_qty: onlyInteger(value) };
      }

      if (name === 'purchase_price') {
        const newValue = onlyMoney(value);
        return {
          ...prev,
          purchase_price: newValue,
          sale_price: saleEdited ? prev.sale_price : autoSalePrice(newValue),
        };
      }

      if (name === 'sale_price') {
        setSaleEdited(true);
        return { ...prev, sale_price: onlyMoney(value) };
      }

      return { ...prev, [name]: value };
    });
  }

  function startEdit(part) {
    setEditingId(part.part_id);
    setForm({
      part_name: part.part_name,
      part_code: part.part_code || '',
      unit: part.unit,
      stock_qty: String(part.stock_qty),
      purchase_price: part.purchase_price ?? '',
      sale_price: part.sale_price ?? '',
    });
    setSaleEdited(true);
    setError('');
    setSuccess('');
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyPart);
    setSaleEdited(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    try {
      if (editingId) {
        await api.put(`/api/parts/${editingId}`, form);
        setSuccess('Запчасть успешно обновлена.');
      } else {
        await api.post('/api/parts', form);
        setSuccess('Запчасть успешно добавлена.');
      }

      resetForm();
      await loadParts();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Скрыть запчасть из системы?')) return;

    try {
      await api.delete(`/api/parts/${id}`);
      if (editingId === id) resetForm();
      setSuccess('Запчасть скрыта из системы.');
      await loadParts();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section className="page-grid">
      <div className="card">
        <div className="row-between">
          <div>
            <h3>Каталог запчастей</h3>
            <p className="muted">Поиск, фильтрация, сортировка и управление складскими позициями</p>
          </div>
          <div className="filters-bar">
            <input
              className="search-input"
              placeholder="Поиск по наименованию или артикулу"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={stock} onChange={(e) => setStock(e.target.value)}>
              <option value="all">Все остатки</option>
              <option value="positive">Есть на складе</option>
              <option value="zero">Нулевой остаток</option>
            </select>
            <select value={active} onChange={(e) => setActive(e.target.value)}>
              <option value="all">Все записи</option>
              <option value="true">Только активные</option>
              <option value="false">Только неактивные</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="name_asc">Наименование А-Я</option>
              <option value="name_desc">Наименование Я-А</option>
              <option value="code_asc">Артикул А-Я</option>
              <option value="code_desc">Артикул Я-А</option>
              <option value="stock_desc">Остаток ↓</option>
              <option value="stock_asc">Остаток ↑</option>
              <option value="sale_price_desc">Розничная цена ↓</option>
              <option value="sale_price_asc">Розничная цена ↑</option>
            </select>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}
        {success && <div className="success-box">{success}</div>}

        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Наименование</th>
                <th>Артикул</th>
                <th>Ед. изм.</th>
                <th>Остаток</th>
                <th>Закупочная цена</th>
                <th>Розничная цена</th>
                <th>Активна</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {parts.map((part) => (
                <tr key={part.part_id}>
                  <td>{part.part_name}</td>
                  <td>{part.part_code || '—'}</td>
                  <td>{part.unit}</td>
                  <td>
                    <span className={`badge stock-badge ${getStockBadgeClass(part.stock_qty)}`}>
                      {part.stock_qty}
                    </span>
                  </td>
                  <td>{part.purchase_price ?? '—'}</td>
                  <td>{part.sale_price ?? '—'}</td>
                  <td>
                    <span className={`badge ${part.is_active ? 'badge-success' : 'badge-danger'}`}>
                      {part.is_active ? 'Да' : 'Нет'}
                    </span>
                  </td>
                  <td>
                    <div className="actions-row">
                      <button className="secondary-btn" type="button" onClick={() => startEdit(part)}>Изменить</button>
                      <button className="danger-btn" type="button" onClick={() => handleDelete(part.part_id)}>Скрыть</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!parts.length && (
                <tr>
                  <td colSpan="8" className="muted">Запчасти не найдены.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <form className="card form-card" onSubmit={handleSubmit}>
        <h3>{editingId ? 'Редактирование запчасти' : 'Добавление запчасти'}</h3>

        <label>
          Наименование
          <input
            name="part_name"
            value={form.part_name}
            onChange={handleChange}
            required
          />
        </label>

        <label>
          Артикул
          <input
            name="part_code"
            value={form.part_code}
            onChange={handleChange}
          />
        </label>

        <label>
          Единица измерения
          <select name="unit" value={form.unit} onChange={handleChange}>
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>{unit}</option>
            ))}
          </select>
        </label>

        <label>
          Остаток
          <input
            name="stock_qty"
            value={form.stock_qty}
            onChange={handleChange}
            inputMode="numeric"
          />
        </label>

        <label>
          Закупочная цена
          <input
            name="purchase_price"
            value={form.purchase_price}
            onChange={handleChange}
            inputMode="decimal"
          />
        </label>

        <label>
          Розничная цена
          <input
            name="sale_price"
            value={form.sale_price}
            onChange={handleChange}
            inputMode="decimal"
          />
        </label>

        <p className="muted">
          Если розничная цена не указана, она рассчитывается автоматически по коэффициенту 1.35.
          Если остаток становится равным 0, запчасть автоматически становится неактивной.
        </p>

        <div className="actions-row">
          <button className="primary-btn" type="submit">
            {editingId ? 'Сохранить изменения' : 'Добавить запчасть'}
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