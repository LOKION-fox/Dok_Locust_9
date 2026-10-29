import express from 'express';
import { pool } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';

const router = express.Router();

const ALLOWED_STATUSES = ['Черновик', 'Отправлен', 'Получен', 'Отменён'];

function isPositiveInteger(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0;
}

function sanitizeText(value) {
  return String(value ?? '').replace(/[<>`]/g, '').trim();
}

function normalizeDate(value) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Ожидаемая дата указана некорректно.');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);

  if (date < today) {
    throw new Error('Нельзя указывать ожидаемую дату в прошлом.');
  }

  return value;
}

function validateCreatePayload(body) {
  if (!isPositiveInteger(body.supplier_id)) {
    throw new Error('Поставщик обязателен.');
  }

  normalizeDate(body.expected_date);

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new Error('Необходимо добавить хотя бы одну позицию заказа.');
  }

  for (const item of body.items) {
    if (!isPositiveInteger(item.part_id)) {
      throw new Error('У одной из позиций заказа не выбрана запчасть.');
    }

    if (!isPositiveInteger(item.qty)) {
      throw new Error('Количество в позиции должно быть целым числом больше нуля.');
    }
  }
}

async function getOrderWithItems(poId) {
  const orderResult = await pool.query(
    `
    SELECT
      po.*,
      u.full_name AS created_by_name,
      s.supplier_name AS supplier_display_name
    FROM part_purchase_orders po
    JOIN users u ON u.user_id = po.created_by
    LEFT JOIN suppliers s ON s.supplier_id = po.supplier_id
    WHERE po.po_id = $1
    `,
    [poId]
  );

  if (orderResult.rowCount === 0) {
    return null;
  }

  const itemsResult = await pool.query(
    `
    SELECT
      poi.*,
      p.part_name,
      p.part_code,
      p.unit
    FROM part_purchase_order_items poi
    JOIN parts p ON p.part_id = poi.part_id
    WHERE poi.po_id = $1
    ORDER BY poi.po_item_id ASC
    `,
    [poId]
  );

  const order = orderResult.rows[0];

  return {
    ...order,
    supplier_name: order.supplier_display_name || order.supplier_name,
    items: itemsResult.rows,
  };
}

router.get('/', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : '%';
    const status = req.query.status || 'ALL';
    const sort = req.query.sort || 'newest';

    const params = [search];
    let where = `
      WHERE (
        po.po_no ILIKE $1
        OR COALESCE(s.supplier_name, po.supplier_name, '') ILIKE $1
        OR COALESCE(po.comment, '') ILIKE $1
      )
    `;

    if (status !== 'ALL') {
      params.push(status);
      where += ` AND po.status = $${params.length}`;
    }

    let orderBy = 'po.po_id DESC';
    if (sort === 'oldest') orderBy = 'po.po_id ASC';
    if (sort === 'supplier_asc') orderBy = 'COALESCE(s.supplier_name, po.supplier_name) ASC';
    if (sort === 'supplier_desc') orderBy = 'COALESCE(s.supplier_name, po.supplier_name) DESC';
    if (sort === 'status_asc') orderBy = 'po.status ASC, po.po_id DESC';
    if (sort === 'expected_date_asc') orderBy = 'po.expected_date ASC NULLS LAST';
    if (sort === 'expected_date_desc') orderBy = 'po.expected_date DESC NULLS LAST';

    const ordersResult = await pool.query(
      `
      SELECT
        po.*,
        u.full_name AS created_by_name,
        s.supplier_name AS supplier_display_name
      FROM part_purchase_orders po
      JOIN users u ON u.user_id = po.created_by
      LEFT JOIN suppliers s ON s.supplier_id = po.supplier_id
      ${where}
      ORDER BY ${orderBy}
      `,
      params
    );

    const itemsResult = await pool.query(
      `
      SELECT
        poi.*,
        p.part_name,
        p.part_code,
        p.unit
      FROM part_purchase_order_items poi
      JOIN parts p ON p.part_id = poi.part_id
      ORDER BY poi.po_item_id ASC
      `
    );

    const orders = ordersResult.rows.map((order) => ({
      ...order,
      supplier_name: order.supplier_display_name || order.supplier_name,
      items: itemsResult.rows.filter((item) => item.po_id === order.po_id),
    }));

    res.json({ orders });
  } catch (error) {
    console.error('GET /api/purchase-orders error:', error);
    res.status(500).json({ message: error.message });
  }
});

router.post('/', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  const client = await pool.connect();

  try {
    validateCreatePayload(req.body);

    await client.query('BEGIN');

    const supplierId = Number(req.body.supplier_id);
    const expectedDate = normalizeDate(req.body.expected_date);
    const comment = sanitizeText(req.body.comment);

    const supplierResult = await client.query(
      `
      SELECT supplier_id, supplier_name
      FROM suppliers
      WHERE supplier_id = $1
        AND is_active = TRUE
      `,
      [supplierId]
    );

    if (supplierResult.rowCount === 0) {
      throw new Error('Выбранный поставщик не найден.');
    }

    const supplier = supplierResult.rows[0];

    const orderResult = await client.query(
      `
      INSERT INTO part_purchase_orders (
        supplier_id,
        supplier_name,
        status,
        created_by,
        expected_date,
        comment
      )
      VALUES ($1, $2, 'Черновик', $3, $4, $5)
      RETURNING *
      `,
      [
        supplier.supplier_id,
        supplier.supplier_name,
        req.user.user_id,
        expectedDate,
        comment || null,
      ]
    );

    const poId = orderResult.rows[0].po_id;

    for (const rawItem of req.body.items) {
      const partId = Number(rawItem.part_id);
      const qty = Number(rawItem.qty);

      const partResult = await client.query(
        `
        SELECT part_id, purchase_price
        FROM parts
        WHERE part_id = $1
        `,
        [partId]
      );

      if (partResult.rowCount === 0) {
        throw new Error('Одна из запчастей заказа не найдена.');
      }

      const part = partResult.rows[0];

      await client.query(
        `
        INSERT INTO part_purchase_order_items (po_id, part_id, qty, unit_cost)
        VALUES ($1, $2, $3, $4)
        `,
        [
          poId,
          partId,
          qty,
          part.purchase_price || 0,
        ]
      );
    }

    await client.query('COMMIT');

    const createdOrder = await getOrderWithItems(poId);
    res.status(201).json({ order: createdOrder });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('POST /api/purchase-orders error:', error);
    res.status(400).json({ message: error.message });
  } finally {
    client.release();
  }
});

router.patch('/:id/status', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  const client = await pool.connect();

  try {
    const poId = Number(req.params.id);
    const nextStatus = String(req.body.status || '').trim();

    if (!ALLOWED_STATUSES.includes(nextStatus)) {
      throw new Error('Некорректный статус заказа запчастей.');
    }

    await client.query('BEGIN');

    const currentResult = await client.query(
      `
      SELECT *
      FROM part_purchase_orders
      WHERE po_id = $1
      FOR UPDATE
      `,
      [poId]
    );

    if (currentResult.rowCount === 0) {
      throw new Error('Заказ запчастей не найден.');
    }

    const currentOrder = currentResult.rows[0];
    const currentStatus = currentOrder.status;

    if (nextStatus === currentStatus) {
      await client.query('COMMIT');
      const unchangedOrder = await getOrderWithItems(poId);
      return res.json({ order: unchangedOrder });
    }

    if (nextStatus === 'Отправлен' && currentStatus !== 'Черновик') {
      throw new Error('Отправить можно только заказ со статусом «Черновик».');
    }

    if (nextStatus === 'Получен' && !['Черновик', 'Отправлен'].includes(currentStatus)) {
      throw new Error('Получить можно только заказ со статусом «Черновик» или «Отправлен».');
    }

    if (nextStatus === 'Отменён' && currentStatus === 'Получен') {
      throw new Error('Нельзя отменить уже полученный заказ.');
    }

    if (nextStatus === 'Получен') {
      const itemsResult = await client.query(
        `
        SELECT *
        FROM part_purchase_order_items
        WHERE po_id = $1
        ORDER BY po_item_id ASC
        `,
        [poId]
      );

      for (const item of itemsResult.rows) {
        await client.query(
          `
          UPDATE parts
             SET stock_qty = stock_qty + $1,
                 purchase_price = COALESCE($2, purchase_price),
                 is_active = TRUE
           WHERE part_id = $3
          `,
          [
            Number(item.qty),
            item.unit_cost,
            item.part_id,
          ]
        );
      }
    }

    await client.query(
      `
      UPDATE part_purchase_orders
         SET status = $1
       WHERE po_id = $2
      `,
      [nextStatus, poId]
    );

    await client.query('COMMIT');

    const updatedOrder = await getOrderWithItems(poId);
    res.json({ order: updatedOrder });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('PATCH /api/purchase-orders/:id/status error:', error);
    res.status(400).json({ message: error.message });
  } finally {
    client.release();
  }
});

export default router;