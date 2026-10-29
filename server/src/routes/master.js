import express from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';
import {
  validateFullName,
  validatePhone,
  validateEmail,
  validatePassword,
  formatPhoneForStorage,
  sanitizeFreeText,
} from '../utils/validators.js';

const router = express.Router();

router.use(authMiddleware, allowRoles('MASTER'));

async function getOwnOrder(client, orderId, masterId) {
  const result = await client.query(
    `SELECT *
       FROM work_orders
      WHERE order_id = $1
        AND master_id = $2`,
    [orderId, masterId]
  );

  if (result.rowCount === 0) {
    throw new Error('Заказ недоступен мастеру.');
  }

  return result.rows[0];
}

async function buildAutoPartsUsedText(client, orderId) {
  const result = await client.query(
    `
    SELECT
      op.qty_used,
      op.unit_price,
      p.part_name,
      p.unit
    FROM order_parts op
    JOIN parts p ON p.part_id = op.part_id
    WHERE op.order_id = $1
      AND op.qty_used > 0
    ORDER BY p.part_name ASC
    `,
    [orderId]
  );

  if (result.rowCount === 0) {
    return '';
  }

  return result.rows
    .map((row) => {
      const qty = Number(row.qty_used || 0);
      const price = Number(row.unit_price || 0).toFixed(2);
      return `${row.part_name} — ${qty} ${row.unit}, цена: ${price}`;
    })
    .join('\n');
}

function parseLocalDateTimeString(value) {
  if (!value || typeof value !== 'string') {
    throw new Error('Планируемая дата сдачи обязательна.');
  }

  const normalized = value.trim().replace(' ', 'T');
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    throw new Error('Некорректная дата.');
  }

  const now = new Date();
  if (date.getTime() < now.getTime()) {
    throw new Error('Планируемая дата сдачи не может быть в прошлом.');
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

router.get('/profile', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id, login, full_name, role, phone, email, is_active, created_at
         FROM users
        WHERE user_id = $1`,
      [req.user.user_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Пользователь не найден.' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.patch('/profile', async (req, res) => {
  try {
    const { full_name, phone, email, password } = req.body;

    validateFullName(full_name);
    validatePhone(phone);
    validateEmail(email);

    let passwordHash = null;
    if (password && String(password).trim() !== '') {
      validatePassword(password);
      passwordHash = await bcrypt.hash(password, 10);
    }

    const normalizedPhone = phone ? formatPhoneForStorage(phone) : null;

    const result = await pool.query(
      `
      UPDATE users
         SET full_name = $1,
             phone = $2,
             email = $3,
             password_hash = COALESCE($4, password_hash)
       WHERE user_id = $5
       RETURNING user_id, login, full_name, role, phone, email, is_active, created_at
      `,
      [
        String(full_name).trim(),
        normalizedPhone,
        email || null,
        passwordHash,
        req.user.user_id,
      ]
    );

    res.json({ user: result.rows[0] });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/orders', async (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : '%';
    const sort = req.query.sort || 'newest';
    const onlyActive = req.query.only_active !== 'false';

    const params = [req.user.user_id, search];

    let where = `
      WHERE wo.master_id = $1
        AND (
          wo.order_no ILIKE $2
          OR c.name ILIKE $2
          OR COALESCE(v.plate_no, '') ILIKE $2
          OR COALESCE(v.vin, '') ILIKE $2
          OR wo.problem_desc ILIKE $2
        )
    `;

    if (onlyActive) {
      where += ` AND wo.status IN ('Ожидает принятия мастером', 'В работе')`;
    }

    let orderBy = 'wo.order_id DESC';
    if (sort === 'oldest') orderBy = 'wo.order_id ASC';
    if (sort === 'client_asc') orderBy = 'c.name ASC, wo.order_id DESC';
    if (sort === 'client_desc') orderBy = 'c.name DESC, wo.order_id DESC';
    if (sort === 'date_asc') orderBy = 'wo.created_at ASC';
    if (sort === 'date_desc') orderBy = 'wo.created_at DESC';

    const result = await pool.query(
      `
      SELECT
        wo.order_id,
        wo.order_no,
        wo.status,
        wo.problem_desc,
        wo.created_at,
        wo.accepted_at,
        wo.planned_completion_at,
        c.name AS client_name,
        c.phone AS client_phone,
        v.make,
        v.model,
        v.plate_no,
        v.vin
      FROM work_orders wo
      JOIN clients c ON c.client_id = wo.client_id
      JOIN vehicles v ON v.vehicle_id = wo.vehicle_id
      ${where}
      ORDER BY ${orderBy}
      `,
      params
    );

    res.json({ orders: result.rows });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/orders/:id', async (req, res) => {
  try {
    const orderResult = await pool.query(
      `
      SELECT
        wo.*,
        c.name AS client_name,
        c.phone AS client_phone,
        c.email AS client_email,
        c.address AS client_address,
        v.make,
        v.model,
        v.plate_no,
        v.vin,
        v.year,
        v.mileage
      FROM work_orders wo
      JOIN clients c ON c.client_id = wo.client_id
      JOIN vehicles v ON v.vehicle_id = wo.vehicle_id
      WHERE wo.order_id = $1
        AND wo.master_id = $2
      `,
      [req.params.id, req.user.user_id]
    );

    if (orderResult.rowCount === 0) {
      return res.status(404).json({ message: 'Заказ не найден.' });
    }

    const [services, parts, report] = await Promise.all([
      pool.query(
        `
        SELECT os.*, s.service_name, s.unit
          FROM order_services os
          JOIN services s ON s.service_id = os.service_id
         WHERE os.order_id = $1
         ORDER BY os.order_service_id
        `,
        [req.params.id]
      ),
      pool.query(
        `
        SELECT op.*, p.part_name, p.part_code, p.unit
          FROM order_parts op
          JOIN parts p ON p.part_id = op.part_id
         WHERE op.order_id = $1
         ORDER BY op.order_part_id
        `,
        [req.params.id]
      ),
      pool.query(
        `
        SELECT *
          FROM master_reports
         WHERE order_id = $1
        `,
        [req.params.id]
      ),
    ]);

    res.json({
      order: orderResult.rows[0],
      services: services.rows,
      parts: parts.rows,
      masterReport: report.rows[0] || null,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.patch('/orders/:id/accept', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const order = await getOwnOrder(client, req.params.id, req.user.user_id);

    if (order.status === 'Ожидает принятия мастером') {
      const updated = await client.query(
        `
        UPDATE work_orders
           SET status = 'В работе',
               accepted_at = COALESCE(accepted_at, NOW())
         WHERE order_id = $1
         RETURNING *
        `,
        [req.params.id]
      );

      await client.query(
        `
        INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, comment)
        VALUES ($1, 'Ожидает принятия мастером', 'В работе', $2, 'Мастер принял заказ в работу')
        `,
        [req.params.id, req.user.user_id]
      );

      await client.query('COMMIT');
      return res.json({ order: updated.rows[0] });
    }

    await client.query('COMMIT');
    res.json({ order });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ message: error.message });
  } finally {
    client.release();
  }
});

router.patch('/orders/:id/planned-date', async (req, res) => {
  try {
    const { planned_completion_at } = req.body;
    const localSqlDateTime = parseLocalDateTimeString(planned_completion_at);

    await pool.query(
      `
      UPDATE work_orders
         SET planned_completion_at = $1
       WHERE order_id = $2
         AND master_id = $3
      `,
      [localSqlDateTime, req.params.id, req.user.user_id]
    );

    await pool.query(
      `
      INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, comment)
      SELECT order_id, status, status, $2, 'Мастер обновил планируемую дату сдачи'
        FROM work_orders
       WHERE order_id = $1
      `,
      [req.params.id, req.user.user_id]
    );

    const result = await pool.query(
      `SELECT * FROM work_orders WHERE order_id = $1 AND master_id = $2`,
      [req.params.id, req.user.user_id]
    );

    res.json({ order: result.rows[0] });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/parts', async (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : '%';
    const stock = req.query.stock || 'all';
    const sort = req.query.sort || 'name_asc';

    const params = [search];
    let where = `
      WHERE p.is_active = TRUE
        AND (
          p.part_name ILIKE $1
          OR COALESCE(p.part_code, '') ILIKE $1
        )
    `;

    if (stock === 'positive') {
      where += ` AND p.stock_qty > 0`;
    } else if (stock === 'zero') {
      where += ` AND p.stock_qty = 0`;
    }

    let orderBy = 'p.part_name ASC';
    if (sort === 'name_desc') orderBy = 'p.part_name DESC';
    if (sort === 'stock_desc') orderBy = 'p.stock_qty DESC';
    if (sort === 'stock_asc') orderBy = 'p.stock_qty ASC';
    if (sort === 'price_desc') orderBy = 'p.sale_price DESC NULLS LAST';
    if (sort === 'price_asc') orderBy = 'p.sale_price ASC NULLS LAST';

    const result = await pool.query(
      `
      SELECT part_id, part_code, part_name, unit, stock_qty, sale_price
        FROM parts p
      ${where}
      ORDER BY ${orderBy}
      `,
      params
    );

    res.json({ parts: result.rows });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/orders/:id/report', async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      diagnostic_text,
      work_performed_text,
      recommendations_text,
    } = req.body;

    if (!diagnostic_text || !String(diagnostic_text).trim()) {
      return res.status(400).json({ message: 'Поле "Диагностика" обязательно.' });
    }

    if (!work_performed_text || !String(work_performed_text).trim()) {
      return res.status(400).json({ message: 'Поле "Выполненные работы" обязательно.' });
    }

    const orderCheck = await client.query(
      `SELECT order_id FROM work_orders WHERE order_id = $1 AND master_id = $2`,
      [req.params.id, req.user.user_id]
    );

    if (orderCheck.rowCount === 0) {
      return res.status(404).json({ message: 'Заказ недоступен мастеру.' });
    }

    const autoPartsUsedText = await buildAutoPartsUsedText(client, req.params.id);
    const autoResultText = String(work_performed_text).trim();

    const result = await client.query(
      `
      INSERT INTO master_reports (
        order_id,
        master_id,
        diagnostic_text,
        work_performed_text,
        parts_used_text,
        recommendations_text,
        result_text
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (order_id)
      DO UPDATE SET
        master_id = EXCLUDED.master_id,
        diagnostic_text = EXCLUDED.diagnostic_text,
        work_performed_text = EXCLUDED.work_performed_text,
        parts_used_text = EXCLUDED.parts_used_text,
        recommendations_text = EXCLUDED.recommendations_text,
        result_text = EXCLUDED.result_text,
        updated_at = NOW()
      RETURNING *
      `,
      [
        req.params.id,
        req.user.user_id,
        String(diagnostic_text).trim(),
        String(work_performed_text).trim(),
        autoPartsUsedText || null,
        recommendations_text ? sanitizeFreeText(recommendations_text) : null,
        autoResultText,
      ]
    );

    res.json({ report: result.rows[0] });
  } catch (error) {
    res.status(400).json({ message: error.message });
  } finally {
    client.release();
  }
});

router.post('/orders/:id/parts', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const order = await getOwnOrder(client, req.params.id, req.user.user_id);

    if (!['Ожидает принятия мастером', 'В работе'].includes(order.status)) {
      throw new Error('Изменение запчастей доступно только для активного заказа.');
    }

    const { part_id, qty_used, note, unit_price } = req.body;

    const partId = Number(part_id);
    const newQty = Number(qty_used);

    if (!Number.isInteger(partId) || partId <= 0) {
      throw new Error('Запчасть выбрана некорректно.');
    }

    if (!Number.isInteger(newQty) || newQty <= 0) {
      throw new Error('Количество запчастей должно быть целым числом больше нуля.');
    }

    const partResult = await client.query(
      `SELECT * FROM parts WHERE part_id = $1 AND is_active = TRUE`,
      [partId]
    );

    if (partResult.rowCount === 0) {
      throw new Error('Запчасть не найдена.');
    }

    const part = partResult.rows[0];

    const existingResult = await client.query(
      `SELECT * FROM order_parts WHERE order_id = $1 AND part_id = $2`,
      [req.params.id, partId]
    );

    const existing = existingResult.rows[0] || null;
    const oldQty = existing ? Number(existing.qty_used) : 0;
    const delta = newQty - oldQty;

    if (delta > 0) {
      const stockUpdate = await client.query(
        `
        UPDATE parts
           SET stock_qty = stock_qty - $1
         WHERE part_id = $2
           AND stock_qty >= $1
         RETURNING *
        `,
        [delta, partId]
      );

      if (stockUpdate.rowCount === 0) {
        throw new Error('Недостаточно запчастей на складе.');
      }
    } else if (delta < 0) {
      await client.query(
        `UPDATE parts SET stock_qty = stock_qty + $1 WHERE part_id = $2`,
        [Math.abs(delta), partId]
      );
    }

    const priceToUse =
      unit_price !== undefined && unit_price !== null && unit_price !== ''
        ? Number(unit_price)
        : Number(part.sale_price || 0);

    let result;

    if (existing) {
      result = await client.query(
        `
        UPDATE order_parts
           SET qty_reserved = $1,
               qty_used = $2,
               unit_price = $3,
               purchase_unit_price = $4,
               note = $5
         WHERE order_part_id = $5
         RETURNING *
        `,
        [newQty, newQty, priceToUse, Number(part.purchase_price || 0), note ? sanitizeFreeText(note) : null, existing.order_part_id]
      );
    } else {
      result = await client.query(
        `
        INSERT INTO order_parts (order_id, part_id, qty_reserved, qty_used, unit_price, purchase_unit_price, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        `,
        [req.params.id, partId, newQty, newQty, priceToUse, Number(part.purchase_price || 0), note ? sanitizeFreeText(note) : null]
      );
    }

    await client.query('COMMIT');
    res.json({ item: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ message: error.message });
  } finally {
    client.release();
  }
});

router.delete('/orders/:id/parts/:itemId', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await getOwnOrder(client, req.params.id, req.user.user_id);

    const itemResult = await client.query(
      `SELECT * FROM order_parts WHERE order_id = $1 AND order_part_id = $2`,
      [req.params.id, req.params.itemId]
    );

    if (itemResult.rowCount === 0) {
      throw new Error('Позиция запчасти не найдена.');
    }

    const item = itemResult.rows[0];

    await client.query(
      `UPDATE parts SET stock_qty = stock_qty + $1 WHERE part_id = $2`,
      [item.qty_used, item.part_id]
    );

    await client.query(
      `DELETE FROM order_parts WHERE order_part_id = $1`,
      [req.params.itemId]
    );

    await client.query('COMMIT');
    res.json({ message: 'Запчасть удалена из заказа.' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ message: error.message });
  } finally {
    client.release();
  }
});

router.patch('/orders/:id/submit', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const order = await getOwnOrder(client, req.params.id, req.user.user_id);

    if (order.status !== 'В работе') {
      throw new Error('Сдать можно только заказ со статусом "В работе".');
    }

    const reportCheck = await client.query(
      `SELECT 1 FROM master_reports WHERE order_id = $1 AND master_id = $2`,
      [req.params.id, req.user.user_id]
    );

    if (reportCheck.rowCount === 0) {
      throw new Error('Перед сдачей заказа необходимо заполнить отчет мастера.');
    }

    const updated = await client.query(
      `
      UPDATE work_orders
         SET status = 'Сдан мастером',
             master_submitted_at = NOW()
       WHERE order_id = $1
       RETURNING *
      `,
      [req.params.id]
    );

    await client.query(
      `
      INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, comment)
      VALUES ($1, 'В работе', 'Сдан мастером', $2, 'Мастер сдал заказ')
      `,
      [req.params.id, req.user.user_id]
    );

    await client.query('COMMIT');
    res.json({ order: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ message: error.message });
  } finally {
    client.release();
  }
});

export default router;