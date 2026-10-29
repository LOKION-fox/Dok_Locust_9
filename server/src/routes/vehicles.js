import express from 'express';
import { pool } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';
import {
  validateVehiclePayload,
  sanitizeSingleLine,
} from '../utils/validators.js';

const router = express.Router();

router.get('/', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : '%';
    const clientId = req.query.client_id || 'ALL';
    const make = req.query.make || 'ALL';
    const sort = req.query.sort || 'newest';

    const params = [search];
    let where = `
      WHERE (
        COALESCE(v.vin, '') ILIKE $1
        OR COALESCE(v.plate_no, '') ILIKE $1
        OR COALESCE(v.make, '') ILIKE $1
        OR COALESCE(v.model, '') ILIKE $1
        OR COALESCE(c.name, '') ILIKE $1
      )
    `;

    if (clientId !== 'ALL') {
      params.push(Number(clientId));
      where += ` AND v.client_id = $${params.length}`;
    }

    if (make !== 'ALL') {
      params.push(make);
      where += ` AND v.make = $${params.length}`;
    }

    let orderBy = 'v.vehicle_id DESC';
    if (sort === 'oldest') orderBy = 'v.vehicle_id ASC';
    if (sort === 'make_asc') orderBy = 'v.make ASC, v.model ASC';
    if (sort === 'make_desc') orderBy = 'v.make DESC, v.model DESC';
    if (sort === 'year_desc') orderBy = 'v.year DESC NULLS LAST';
    if (sort === 'year_asc') orderBy = 'v.year ASC NULLS LAST';
    if (sort === 'mileage_desc') orderBy = 'v.mileage DESC NULLS LAST';
    if (sort === 'mileage_asc') orderBy = 'v.mileage ASC NULLS LAST';

    const result = await pool.query(
      `
      SELECT
        v.*,
        c.name AS client_name
      FROM vehicles v
      JOIN clients c ON c.client_id = v.client_id
      ${where}
      ORDER BY ${orderBy}
      `,
      params
    );

    res.json({ vehicles: result.rows });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    validateVehiclePayload(req.body);

    const clientId = Number(req.body.client_id);
    const vin = sanitizeSingleLine(req.body.vin || '').toUpperCase();
    const plateNo = sanitizeSingleLine(req.body.plate_no || '').toUpperCase();
    const make = sanitizeSingleLine(req.body.make);
    const model = sanitizeSingleLine(req.body.model);
    const year = req.body.year ? Number(req.body.year) : null;
    const mileage = req.body.mileage ? Number(req.body.mileage) : null;

    const result = await pool.query(
      `INSERT INTO vehicles (client_id, vin, plate_no, make, model, year, mileage)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        clientId,
        vin || null,
        plateNo || null,
        make,
        model,
        year,
        mileage,
      ]
    );

    res.status(201).json({ vehicle: result.rows[0] });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put('/:id', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    validateVehiclePayload(req.body);

    const clientId = Number(req.body.client_id);
    const vin = sanitizeSingleLine(req.body.vin || '').toUpperCase();
    const plateNo = sanitizeSingleLine(req.body.plate_no || '').toUpperCase();
    const make = sanitizeSingleLine(req.body.make);
    const model = sanitizeSingleLine(req.body.model);
    const year = req.body.year ? Number(req.body.year) : null;
    const mileage = req.body.mileage ? Number(req.body.mileage) : null;

    const result = await pool.query(
      `UPDATE vehicles
          SET client_id = $1,
              vin = $2,
              plate_no = $3,
              make = $4,
              model = $5,
              year = $6,
              mileage = $7
        WHERE vehicle_id = $8
        RETURNING *`,
      [
        clientId,
        vin || null,
        plateNo || null,
        make,
        model,
        year,
        mileage,
        Number(req.params.id),
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Автомобиль не найден.' });
    }

    res.json({ vehicle: result.rows[0] });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id', authMiddleware, allowRoles('ADMIN'), async (_req, res) => {
  res.status(405).json({
    message: 'Удаление автомобилей запрещено. Данные должны сохраняться в истории системы.',
  });
});

export default router;