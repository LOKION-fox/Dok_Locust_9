import express from 'express';
import { pool } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';

const router = express.Router();

router.get('/', authMiddleware, allowRoles('ADMIN'), async (_req, res) => {
  try {
    const [clients, vehicles, orders, parts, recentOrders] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM clients'),
      pool.query('SELECT COUNT(*)::int AS count FROM vehicles'),
      pool.query(`SELECT COUNT(*)::int AS count FROM work_orders WHERE status <> 'Отменён'`),
      pool.query('SELECT COUNT(*)::int AS count FROM parts WHERE is_active = TRUE'),
      pool.query(
        `SELECT wo.order_id, wo.order_no, wo.status, wo.created_at,
                wo.accepted_at, wo.planned_completion_at, wo.master_submitted_at,
                c.name AS client_name,
                v.make, v.model, v.plate_no,
                u.full_name AS master_name
           FROM work_orders wo
           JOIN clients c ON c.client_id = wo.client_id
           JOIN vehicles v ON v.vehicle_id = wo.vehicle_id
           LEFT JOIN users u ON u.user_id = wo.master_id
          ORDER BY wo.order_id DESC
          LIMIT 8`
      ),
    ]);

    res.json({
      cards: [
        { label: 'Клиенты', value: clients.rows[0].count },
        { label: 'Автомобили', value: vehicles.rows[0].count },
        { label: 'Заказы', value: orders.rows[0].count },
        { label: 'Активные запчасти', value: parts.rows[0].count },
      ],
      recentOrders: recentOrders.rows,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;