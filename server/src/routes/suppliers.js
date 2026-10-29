import express from 'express';
import { pool } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';

const router = express.Router();

function sanitize(value) {
  return String(value ?? '').replace(/[<>`]/g, '').trim();
}

router.get('/', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : '%';

    const result = await pool.query(
      `
      SELECT supplier_id, supplier_name, phone, email, comment, is_active, created_at
      FROM suppliers
      WHERE supplier_name ILIKE $1
         OR COALESCE(phone, '') ILIKE $1
         OR COALESCE(email, '') ILIKE $1
      ORDER BY supplier_name ASC
      `,
      [search]
    );

    res.json({ suppliers: result.rows });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    const supplierName = sanitize(req.body.supplier_name);
    const phone = sanitize(req.body.phone);
    const email = sanitize(req.body.email);
    const comment = sanitize(req.body.comment);

    if (!supplierName) {
      return res.status(400).json({ message: 'Наименование поставщика обязательно.' });
    }

    const result = await pool.query(
      `
      INSERT INTO suppliers (supplier_name, phone, email, comment)
      VALUES ($1, $2, $3, $4)
      RETURNING supplier_id, supplier_name, phone, email, comment, is_active, created_at
      `,
      [
        supplierName,
        phone || null,
        email || null,
        comment || null,
      ]
    );

    res.status(201).json({ supplier: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Поставщик с таким названием уже существует.' });
    }

    res.status(400).json({ message: error.message });
  }
});

export default router;