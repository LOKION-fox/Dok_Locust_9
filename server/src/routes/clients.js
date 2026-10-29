import express from 'express';
import { pool } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';
import {
  validateClientPayload,
  sanitizeSingleLine,
  sanitizeFreeText,
  formatPhoneForStorage,
} from '../utils/validators.js';

const router = express.Router();

router.get('/', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : '%';
    const clientType = req.query.client_type || 'ALL';
    const sort = req.query.sort || 'newest';

    const params = [search];
    let where = `
      WHERE (
        c.name ILIKE $1
        OR COALESCE(c.phone, '') ILIKE $1
        OR COALESCE(c.email, '') ILIKE $1
        OR COALESCE(c.address, '') ILIKE $1
      )
    `;

    if (clientType !== 'ALL') {
      params.push(clientType);
      where += ` AND c.client_type = $${params.length}`;
    }

    let orderBy = 'c.client_id DESC';
    if (sort === 'name_asc') orderBy = 'c.name ASC';
    if (sort === 'name_desc') orderBy = 'c.name DESC';
    if (sort === 'oldest') orderBy = 'c.client_id ASC';
    if (sort === 'vehicles_desc') orderBy = 'vehicles_count DESC, c.name ASC';

    const result = await pool.query(
      `
      SELECT
        c.*,
        COUNT(v.vehicle_id)::int AS vehicles_count
      FROM clients c
      LEFT JOIN vehicles v ON v.client_id = c.client_id
      ${where}
      GROUP BY c.client_id
      ORDER BY ${orderBy}
      `,
      params
    );

    res.json({ clients: result.rows });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    validateClientPayload(req.body);

    const clientType = req.body.client_type;
    const name = sanitizeSingleLine(req.body.name);
    const phone = formatPhoneForStorage(req.body.phone);
    const email = sanitizeSingleLine(req.body.email || '');
    const address = sanitizeSingleLine(req.body.address || '');
    const comment = sanitizeFreeText(req.body.comment || '');

    const result = await pool.query(
      `INSERT INTO clients (client_type, name, phone, email, address, comment)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        clientType,
        name,
        phone,
        email || null,
        address || null,
        comment || null,
      ]
    );

    res.status(201).json({ client: result.rows[0] });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put('/:id', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    validateClientPayload(req.body);

    const clientType = req.body.client_type;
    const name = sanitizeSingleLine(req.body.name);
    const phone = formatPhoneForStorage(req.body.phone);
    const email = sanitizeSingleLine(req.body.email || '');
    const address = sanitizeSingleLine(req.body.address || '');
    const comment = sanitizeFreeText(req.body.comment || '');

    const result = await pool.query(
      `UPDATE clients
          SET client_type = $1,
              name = $2,
              phone = $3,
              email = $4,
              address = $5,
              comment = $6
        WHERE client_id = $7
        RETURNING *`,
      [
        clientType,
        name,
        phone,
        email || null,
        address || null,
        comment || null,
        Number(req.params.id),
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Клиент не найден.' });
    }

    res.json({ client: result.rows[0] });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id', authMiddleware, allowRoles('ADMIN'), async (_req, res) => {
  res.status(405).json({
    message: 'Удаление клиентов запрещено. Данные должны сохраняться в истории системы.',
  });
});

export default router;