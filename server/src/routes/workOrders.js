import express from 'express';
import { pool } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';
import {
  validateWorkOrderPayload,
  validateAdminClosingComment,
  sanitizeSingleLine,
  sanitizeFreeText,
} from '../utils/validators.js';

const router = express.Router();

const STATUSES = [
  'Ожидает принятия мастером',
  'В работе',
  'Сдан мастером',
  'Выполнен',
  'Отменён',
];

const ARCHIVE_STATUSES = ['Выполнен', 'Отменён'];
const ACTIVE_STATUSES = ['Ожидает принятия мастером', 'В работе', 'Сдан мастером'];

function isPositiveInteger(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0;
}

function parseMoney(value, fieldName) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Поле «${fieldName}» заполнено некорректно.`);
  }
  return Math.round(num * 100) / 100;
}

async function getWorkOrderById(orderId) {
  const orderResult = await pool.query(
    `SELECT
       wo.*,
       c.name AS client_name,
       c.phone AS client_phone,
       c.email AS client_email,
       c.address AS client_address,
       v.make, v.model, v.plate_no, v.vin, v.year, v.mileage,
       u.full_name AS master_name
     FROM work_orders wo
     JOIN clients c ON c.client_id = wo.client_id
     JOIN vehicles v ON v.vehicle_id = wo.vehicle_id
     LEFT JOIN users u ON u.user_id = wo.master_id
     WHERE wo.order_id = $1`,
    [orderId]
  );

  if (orderResult.rowCount === 0) {
    return null;
  }

  const [services, parts, history, masterReport] = await Promise.all([
    pool.query(
      `SELECT os.*, s.service_name, s.unit
         FROM order_services os
         JOIN services s ON s.service_id = os.service_id
        WHERE os.order_id = $1
        ORDER BY os.order_service_id DESC`,
      [orderId]
    ),
    pool.query(
      `SELECT op.*, p.part_name, p.part_code, p.unit
         FROM order_parts op
         JOIN parts p ON p.part_id = op.part_id
        WHERE op.order_id = $1
        ORDER BY op.order_part_id DESC`,
      [orderId]
    ),
    pool.query(
      `SELECT h.*, u.full_name AS changed_by_name
         FROM order_status_history h
         JOIN users u ON u.user_id = h.changed_by
        WHERE h.order_id = $1
        ORDER BY h.history_id DESC`,
      [orderId]
    ),
    pool.query(
      `SELECT mr.*, u.full_name AS master_name
         FROM master_reports mr
         JOIN users u ON u.user_id = mr.master_id
        WHERE mr.order_id = $1`,
      [orderId]
    ),
  ]);

  return {
    order: orderResult.rows[0],
    services: services.rows,
    parts: parts.rows,
    history: history.rows,
    masterReport: masterReport.rows[0] || null,
  };
}

router.get('/meta', authMiddleware, allowRoles('ADMIN'), async (_req, res) => {
  try {
    const [clients, vehicles, masters, parts, services] = await Promise.all([
      pool.query('SELECT client_id, name FROM clients ORDER BY name'),
      pool.query(
        `SELECT v.vehicle_id, v.client_id, v.make, v.model, v.plate_no, c.name AS client_name
           FROM vehicles v
           JOIN clients c ON c.client_id = v.client_id
          ORDER BY c.name, v.make, v.model`
      ),
      pool.query(
        `SELECT
           u.user_id,
           u.full_name,
           COALESCE(COUNT(wo.order_id) FILTER (
             WHERE wo.status IN ('Ожидает принятия мастером', 'В работе')
           ), 0)::int AS active_orders_count
         FROM users u
         LEFT JOIN work_orders wo ON wo.master_id = u.user_id
         WHERE u.role = 'MASTER' AND u.is_active = TRUE
         GROUP BY u.user_id
         ORDER BY active_orders_count ASC, u.full_name ASC`
      ),
      pool.query(
        `SELECT part_id, part_name, stock_qty, sale_price, purchase_price, unit
           FROM parts
          WHERE is_active = TRUE
            AND stock_qty > 0
          ORDER BY part_name`
      ),
      pool.query(
        `SELECT service_id, service_name, base_price, unit
           FROM services
          WHERE is_active = TRUE
          ORDER BY service_name`
      ),
    ]);

    res.json({
      clients: clients.rows,
      vehicles: vehicles.rows,
      masters: masters.rows,
      parts: parts.rows,
      services: services.rows,
      statuses: STATUSES,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    const params = [];
    const scope = req.query.scope || 'active';
    let where = 'WHERE 1=1';

    if (scope === 'archive') {
      where += ` AND wo.status = ANY(ARRAY['Выполнен', 'Отменён'])`;
    } else if (scope === 'active') {
      where += ` AND wo.status = ANY(ARRAY['Ожидает принятия мастером', 'В работе', 'Сдан мастером'])`;
    }

    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      where += ` AND (
        wo.order_no ILIKE $${params.length}
        OR c.name ILIKE $${params.length}
        OR COALESCE(v.plate_no, '') ILIKE $${params.length}
        OR COALESCE(v.vin, '') ILIKE $${params.length}
        OR wo.problem_desc ILIKE $${params.length}
      )`;
    }

    if (req.query.status && req.query.status !== 'ALL') {
      params.push(req.query.status);
      where += ` AND wo.status = $${params.length}`;
    }

    if (req.query.client_id && req.query.client_id !== 'ALL') {
      params.push(Number(req.query.client_id));
      where += ` AND wo.client_id = $${params.length}`;
    }

    if (req.query.master_id && req.query.master_id !== 'ALL') {
      params.push(Number(req.query.master_id));
      where += ` AND wo.master_id = $${params.length}`;
    }

    const sort = req.query.sort || 'newest';
    let orderBy = 'wo.order_id DESC';
    if (sort === 'oldest') orderBy = 'wo.order_id ASC';
    if (sort === 'status_asc') orderBy = 'wo.status ASC, wo.order_id DESC';
    if (sort === 'client_asc') orderBy = 'c.name ASC, wo.order_id DESC';
    if (sort === 'client_desc') orderBy = 'c.name DESC, wo.order_id DESC';
    if (sort === 'master_asc') orderBy = 'u.full_name ASC NULLS LAST, wo.order_id DESC';
    if (sort === 'master_desc') orderBy = 'u.full_name DESC NULLS LAST, wo.order_id DESC';
    if (sort === 'created_at_asc') orderBy = 'wo.created_at ASC';
    if (sort === 'created_at_desc') orderBy = 'wo.created_at DESC';
    if (sort === 'newest') orderBy = 'wo.created_at DESC, wo.order_id DESC';

    const result = await pool.query(
      `
      SELECT
        wo.*,
        c.name AS client_name,
        v.make, v.model, v.plate_no, v.vin,
        u.full_name AS master_name
      FROM work_orders wo
      JOIN clients c ON c.client_id = wo.client_id
      JOIN vehicles v ON v.vehicle_id = wo.vehicle_id
      LEFT JOIN users u ON u.user_id = wo.master_id
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

router.get('/archive', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : '%';
    const status = req.query.status || 'ALL';
    const masterId = req.query.master_id || 'ALL';
    const sort = req.query.sort || 'completed_desc';

    const params = [search];
    let where = `
      WHERE wo.status IN ('Выполнен', 'Отменён')
        AND (
          wo.order_no ILIKE $1
          OR c.name ILIKE $1
          OR COALESCE(v.plate_no, '') ILIKE $1
          OR COALESCE(v.vin, '') ILIKE $1
          OR COALESCE(u.full_name, '') ILIKE $1
        )
    `;

    if (status !== 'ALL') {
      params.push(status);
      where += ` AND wo.status = $${params.length}`;
    }

    if (masterId !== 'ALL') {
      params.push(Number(masterId));
      where += ` AND wo.master_id = $${params.length}`;
    }

    let orderBy = 'archived_at DESC NULLS LAST, wo.order_id DESC';
    if (sort === 'completed_asc') orderBy = 'archived_at ASC NULLS LAST, wo.order_id ASC';
    if (sort === 'created_desc') orderBy = 'wo.created_at DESC, wo.order_id DESC';
    if (sort === 'created_asc') orderBy = 'wo.created_at ASC, wo.order_id ASC';
    if (sort === 'client_asc') orderBy = 'c.name ASC, wo.order_id DESC';
    if (sort === 'master_asc') orderBy = 'u.full_name ASC NULLS LAST, wo.order_id DESC';
    if (sort === 'profit_desc') orderBy = 'net_profit DESC NULLS LAST';
    if (sort === 'profit_asc') orderBy = 'net_profit ASC NULLS LAST';

    const ordersResult = await pool.query(
      `
      WITH service_totals AS (
        SELECT order_id, SUM(qty * price)::numeric(12,2) AS services_revenue
        FROM order_services
        GROUP BY order_id
      ),
      part_totals AS (
        SELECT
          op.order_id,
          SUM(COALESCE(NULLIF(op.qty_used, 0), op.qty_reserved) * op.unit_price)::numeric(12,2) AS parts_revenue,
          SUM(COALESCE(NULLIF(op.qty_used, 0), op.qty_reserved) * COALESCE(op.purchase_unit_price, p.purchase_price, 0))::numeric(12,2) AS parts_cost_total
        FROM order_parts op
        JOIN parts p ON p.part_id = op.part_id
        GROUP BY op.order_id
      )
      SELECT
        wo.*,
        COALESCE(wo.completed_at, wo.master_submitted_at, wo.created_at) AS archived_at,
        c.name AS client_name,
        v.make, v.model, v.plate_no, v.vin,
        u.full_name AS master_name,
        COALESCE(st.services_revenue, 0) AS services_revenue,
        COALESCE(pt.parts_revenue, 0) AS parts_revenue,
        COALESCE(pt.parts_cost_total, 0) AS parts_cost_total,
        (COALESCE(st.services_revenue, 0) + COALESCE(pt.parts_revenue, 0))::numeric(12,2) AS revenue_total,
        (COALESCE(st.services_revenue, 0) + COALESCE(pt.parts_revenue, 0) - COALESCE(pt.parts_cost_total, 0))::numeric(12,2) AS net_profit
      FROM work_orders wo
      JOIN clients c ON c.client_id = wo.client_id
      JOIN vehicles v ON v.vehicle_id = wo.vehicle_id
      LEFT JOIN users u ON u.user_id = wo.master_id
      LEFT JOIN service_totals st ON st.order_id = wo.order_id
      LEFT JOIN part_totals pt ON pt.order_id = wo.order_id
      ${where}
      ORDER BY ${orderBy}
      `,
      params
    );

    const mastersResult = await pool.query(
      `SELECT user_id, full_name FROM users WHERE role = 'MASTER' AND is_active = TRUE ORDER BY full_name ASC`
    );

    res.json({ orders: ordersResult.rows, masters: mastersResult.rows });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    const data = await getWorkOrderById(req.params.id);
    if (!data) {
      return res.status(404).json({ message: 'Заказ-наряд не найден.' });
    }
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    validateWorkOrderPayload(req.body);

    const clientId = Number(req.body.client_id);
    const vehicleId = Number(req.body.vehicle_id);
    const masterId = req.body.master_id ? Number(req.body.master_id) : null;
    const problemDesc = sanitizeFreeText(req.body.problem_desc);
    const adminComment = req.body.admin_comment ? sanitizeFreeText(req.body.admin_comment) : null;

    await client.query('BEGIN');

    const vehicleCheck = await client.query(
      `SELECT vehicle_id, client_id FROM vehicles WHERE vehicle_id = $1`,
      [vehicleId]
    );

    if (vehicleCheck.rowCount === 0) {
      throw new Error('Выбранный автомобиль не найден.');
    }

    if (Number(vehicleCheck.rows[0].client_id) !== clientId) {
      throw new Error('Выбранный автомобиль не принадлежит указанному клиенту.');
    }

    if (masterId) {
      const masterCheck = await client.query(
        `SELECT user_id FROM users WHERE user_id = $1 AND role = 'MASTER' AND is_active = TRUE`,
        [masterId]
      );

      if (masterCheck.rowCount === 0) {
        throw new Error('Выбранный мастер не найден.');
      }
    }

    const result = await client.query(
      `INSERT INTO work_orders (client_id, vehicle_id, master_id, status, problem_desc, admin_comment)
       VALUES ($1, $2, $3, 'Ожидает принятия мастером', $4, $5)
       RETURNING *`,
      [clientId, vehicleId, masterId, problemDesc, adminComment]
    );

    await client.query(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, comment)
       VALUES ($1, NULL, 'Ожидает принятия мастером', $2, 'Создание заказ-наряда')`,
      [result.rows[0].order_id, req.user.user_id]
    );

    await client.query('COMMIT');
    res.status(201).json({ order: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ message: error.message });
  } finally {
    client.release();
  }
});

router.put('/:id', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    validateWorkOrderPayload(req.body);

    const clientId = Number(req.body.client_id);
    const vehicleId = Number(req.body.vehicle_id);
    const masterId = req.body.master_id ? Number(req.body.master_id) : null;
    const problemDesc = sanitizeFreeText(req.body.problem_desc);
    const adminComment = req.body.admin_comment ? sanitizeFreeText(req.body.admin_comment) : null;

    const current = await pool.query('SELECT * FROM work_orders WHERE order_id = $1', [req.params.id]);
    if (current.rowCount === 0) {
      return res.status(404).json({ message: 'Заказ-наряд не найден.' });
    }

    const vehicleCheck = await pool.query(
      `SELECT vehicle_id, client_id FROM vehicles WHERE vehicle_id = $1`,
      [vehicleId]
    );

    if (vehicleCheck.rowCount === 0) {
      throw new Error('Выбранный автомобиль не найден.');
    }

    if (Number(vehicleCheck.rows[0].client_id) !== clientId) {
      throw new Error('Выбранный автомобиль не принадлежит указанному клиенту.');
    }

    if (masterId) {
      const masterCheck = await pool.query(
        `SELECT user_id FROM users WHERE user_id = $1 AND role = 'MASTER' AND is_active = TRUE`,
        [masterId]
      );

      if (masterCheck.rowCount === 0) {
        throw new Error('Выбранный мастер не найден.');
      }
    }

    const result = await pool.query(
      `UPDATE work_orders
          SET client_id = $1,
              vehicle_id = $2,
              master_id = $3,
              problem_desc = $4,
              admin_comment = $5
        WHERE order_id = $6
        RETURNING *`,
      [clientId, vehicleId, masterId, problemDesc, adminComment, Number(req.params.id)]
    );

    res.json({ order: result.rows[0] });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.patch('/:id/status', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    const nextStatus = sanitizeSingleLine(req.body.status);
    if (!STATUSES.includes(nextStatus)) {
      throw new Error('Некорректный статус заказа.');
    }

    await client.query('BEGIN');

    const current = await client.query('SELECT * FROM work_orders WHERE order_id = $1', [req.params.id]);
    if (current.rowCount === 0) {
      throw new Error('Заказ-наряд не найден.');
    }

    const order = current.rows[0];
    if (nextStatus === order.status) {
      await client.query('COMMIT');
      return res.json({ order });
    }

    if (nextStatus === 'Отменён') {
      const updated = await client.query(
        `UPDATE work_orders SET status = 'Отменён', completed_at = NOW() WHERE order_id = $1 RETURNING *`,
        [req.params.id]
      );
      await client.query(
        `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, comment)
         VALUES ($1, $2, 'Отменён', $3, 'Отмена заказ-наряда администратором')`,
        [req.params.id, order.status, req.user.user_id]
      );
      await client.query('COMMIT');
      return res.json({ order: updated.rows[0] });
    }

    if (nextStatus === 'Выполнен') {
      validateAdminClosingComment(req.body.admin_closing_comment);

      if (order.status !== 'Сдан мастером') {
        throw new Error('Выполнить можно только заказ со статусом «Сдан мастером».');
      }

      const reportCheck = await client.query('SELECT 1 FROM master_reports WHERE order_id = $1', [req.params.id]);
      if (reportCheck.rowCount === 0) {
        throw new Error('Нельзя завершить заказ без отчета мастера.');
      }

      const updated = await client.query(
        `UPDATE work_orders
            SET status = 'Выполнен',
                admin_closing_comment = $1,
                completed_at = NOW()
          WHERE order_id = $2
          RETURNING *`,
        [sanitizeFreeText(req.body.admin_closing_comment), req.params.id]
      );

      await client.query(
        `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, comment)
         VALUES ($1, 'Сдан мастером', 'Выполнен', $2, 'Заказ завершен администратором')`,
        [req.params.id, req.user.user_id]
      );

      await client.query('COMMIT');
      return res.json({ order: updated.rows[0] });
    }

    throw new Error('Данный статус нельзя установить из веб-приложения администратора.');
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ message: error.message });
  } finally {
    client.release();
  }
});

router.post('/:id/services', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    const qty = Number(req.body.qty);
    const comment = req.body.comment ? sanitizeFreeText(req.body.comment) : null;
    const serviceIdRaw = req.body.service_id ? Number(req.body.service_id) : null;
    const customServiceName = sanitizeSingleLine(req.body.custom_service_name || '');
    const customUnit = sanitizeSingleLine(req.body.custom_unit || 'усл.') || 'усл.';
    const hasCustomService = Boolean(customServiceName);

    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error('Количество услуги должно быть целым числом больше нуля.');
    }

    await client.query('BEGIN');

    let serviceId = serviceIdRaw;
    let price = null;

    if (hasCustomService) {
      const customPrice = parseMoney(req.body.custom_price, 'Цена услуги');

      const existingService = await client.query(
        `SELECT service_id, base_price FROM services WHERE LOWER(service_name) = LOWER($1) LIMIT 1`,
        [customServiceName]
      );

      if (existingService.rowCount > 0) {
        serviceId = existingService.rows[0].service_id;
        price = customPrice;

        await client.query(
          `UPDATE services
              SET base_price = $1,
                  unit = $2,
                  is_active = TRUE
            WHERE service_id = $3`,
          [customPrice, customUnit, serviceId]
        );
      } else {
        const createdService = await client.query(
          `INSERT INTO services (service_name, unit, base_price, is_active)
           VALUES ($1, $2, $3, TRUE)
           RETURNING service_id, base_price`,
          [customServiceName, customUnit, customPrice]
        );
        serviceId = createdService.rows[0].service_id;
        price = createdService.rows[0].base_price;
      }
    } else {
      if (!Number.isInteger(serviceIdRaw) || serviceIdRaw <= 0) {
        throw new Error('Выберите услугу.');
      }

      const serviceResult = await client.query(
        `SELECT service_id, base_price FROM services WHERE service_id = $1 AND is_active = TRUE`,
        [serviceIdRaw]
      );

      if (serviceResult.rowCount === 0) {
        throw new Error('Услуга не найдена.');
      }

      serviceId = serviceIdRaw;
      price = Number(serviceResult.rows[0].base_price || 0);
    }

    const result = await client.query(
      `INSERT INTO order_services (order_id, service_id, qty, price, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (order_id, service_id)
       DO UPDATE SET
          qty = order_services.qty + EXCLUDED.qty,
          price = EXCLUDED.price,
          comment = EXCLUDED.comment
       RETURNING *`,
      [req.params.id, serviceId, qty, price, comment]
    );

    await client.query('COMMIT');
    res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ message: error.message });
  } finally {
    client.release();
  }
});

router.delete('/:id/services/:itemId', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    await pool.query('DELETE FROM order_services WHERE order_id = $1 AND order_service_id = $2', [req.params.id, req.params.itemId]);
    res.json({ message: 'Услуга удалена из заказа.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/:id/parts', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    const partId = Number(req.body.part_id);
    const qty = Number(req.body.qty);
    const note = req.body.note ? sanitizeFreeText(req.body.note) : null;

    if (!Number.isInteger(partId) || partId <= 0) {
      return res.status(400).json({ message: 'Выберите запчасть.' });
    }

    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ message: 'Количество запчастей должно быть целым числом больше нуля.' });
    }

    const partResult = await pool.query(
      `SELECT part_id, stock_qty, sale_price, purchase_price, unit, is_active FROM parts WHERE part_id = $1`,
      [partId]
    );

    if (partResult.rowCount === 0) {
      return res.status(400).json({ message: 'Запчасть не найдена.' });
    }

    const part = partResult.rows[0];

    if (!part.is_active || Number(part.stock_qty) <= 0) {
      return res.status(400).json({ message: 'Запчасть недоступна для выбора.' });
    }

    if (Number(part.stock_qty) < qty) {
      return res.status(400).json({ message: 'Недостаточно запчастей на складе.' });
    }

    const unitPrice = Number(part.sale_price || 0);
    const purchaseUnitPrice = Number(part.purchase_price || 0);

    const result = await pool.query(
      `INSERT INTO order_parts (order_id, part_id, qty_reserved, qty_used, unit_price, purchase_unit_price, note)
       VALUES ($1, $2, $3, 0, $4, $5, $6)
       ON CONFLICT (order_id, part_id)
       DO UPDATE SET
          qty_reserved = order_parts.qty_reserved + EXCLUDED.qty_reserved,
          unit_price = EXCLUDED.unit_price,
          purchase_unit_price = EXCLUDED.purchase_unit_price,
          note = EXCLUDED.note
       RETURNING *`,
      [req.params.id, partId, qty, unitPrice, purchaseUnitPrice, note]
    );

    res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id/parts/:itemId', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    await pool.query('DELETE FROM order_parts WHERE order_id = $1 AND order_part_id = $2', [req.params.id, req.params.itemId]);
    res.json({ message: 'Запчасть удалена из заказа.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete('/:id', authMiddleware, allowRoles('ADMIN'), async (_req, res) => {
  res.status(405).json({
    message: 'Удаление заказ-нарядов запрещено. Используйте отмену заказа, после чего он попадёт в архив.',
  });
});

export default router;