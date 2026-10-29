import express from 'express';
import { pool } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';
import {
  validatePartPayload,
  sanitizeSingleLine,
} from '../utils/validators.js';

const router = express.Router();
const SALE_COEFFICIENT = 1.35;

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function resolveSalePrice(purchasePrice, salePrice) {
  if (salePrice !== '' && salePrice !== null && salePrice !== undefined) {
    return roundMoney(salePrice);
  }

  if (purchasePrice !== '' && purchasePrice !== null && purchasePrice !== undefined) {
    return roundMoney(Number(purchasePrice) * SALE_COEFFICIENT);
  }

  return null;
}

router.get('/', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : '%';
    const active = req.query.active || 'all';
    const stock = req.query.stock || 'all';
    const sort = req.query.sort || 'name_asc';

    const params = [search];
    let where = `
      WHERE (
        p.part_name ILIKE $1
        OR COALESCE(p.part_code, '') ILIKE $1
      )
    `;

    if (active !== 'all') {
      params.push(active === 'true');
      where += ` AND p.is_active = $${params.length}`;
    }

    if (stock === 'positive') {
      where += ` AND p.stock_qty > 0`;
    } else if (stock === 'zero') {
      where += ` AND p.stock_qty = 0`;
    }

    let orderBy = 'p.part_name ASC';
    if (sort === 'name_desc') orderBy = 'p.part_name DESC';
    if (sort === 'code_asc') orderBy = 'p.part_code ASC NULLS LAST';
    if (sort === 'code_desc') orderBy = 'p.part_code DESC NULLS LAST';
    if (sort === 'stock_desc') orderBy = 'p.stock_qty DESC';
    if (sort === 'stock_asc') orderBy = 'p.stock_qty ASC';
    if (sort === 'sale_price_desc') orderBy = 'p.sale_price DESC NULLS LAST';
    if (sort === 'sale_price_asc') orderBy = 'p.sale_price ASC NULLS LAST';

    const result = await pool.query(
      `
      SELECT p.*
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

router.post('/', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    validatePartPayload(req.body);

    const partCode = sanitizeSingleLine(req.body.part_code || '').toUpperCase();
    const partName = sanitizeSingleLine(req.body.part_name);
    const unit = sanitizeSingleLine(req.body.unit);
    const stockQty = Number(req.body.stock_qty || 0);
    const purchasePrice =
      req.body.purchase_price === '' || req.body.purchase_price === null || req.body.purchase_price === undefined
        ? null
        : roundMoney(req.body.purchase_price);
    const salePrice = resolveSalePrice(purchasePrice, req.body.sale_price);
    const isActive = stockQty > 0;

    const result = await pool.query(
      `INSERT INTO parts (part_code, part_name, unit, stock_qty, purchase_price, sale_price, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        partCode || null,
        partName,
        unit,
        stockQty,
        purchasePrice,
        salePrice,
        isActive,
      ]
    );

    res.status(201).json({ part: result.rows[0] });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put('/:id', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    validatePartPayload(req.body);

    const partCode = sanitizeSingleLine(req.body.part_code || '').toUpperCase();
    const partName = sanitizeSingleLine(req.body.part_name);
    const unit = sanitizeSingleLine(req.body.unit);
    const stockQty = Number(req.body.stock_qty || 0);
    const purchasePrice =
      req.body.purchase_price === '' || req.body.purchase_price === null || req.body.purchase_price === undefined
        ? null
        : roundMoney(req.body.purchase_price);
    const salePrice = resolveSalePrice(purchasePrice, req.body.sale_price);
    const isActive = stockQty > 0;

    const result = await pool.query(
      `UPDATE parts
          SET part_code = $1,
              part_name = $2,
              unit = $3,
              stock_qty = $4,
              purchase_price = $5,
              sale_price = $6,
              is_active = $7
        WHERE part_id = $8
        RETURNING *`,
      [
        partCode || null,
        partName,
        unit,
        stockQty,
        purchasePrice,
        salePrice,
        isActive,
        Number(req.params.id),
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Запчасть не найдена.' });
    }

    res.json({ part: result.rows[0] });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    await pool.query(
      `UPDATE parts
          SET is_active = FALSE
        WHERE part_id = $1`,
      [req.params.id]
    );

    res.json({ message: 'Запчасть скрыта из системы.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;