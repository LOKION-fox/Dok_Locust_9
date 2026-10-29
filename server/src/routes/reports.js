import express from 'express';
import { pool } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';

const router = express.Router();

function normalizeDate(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return value;
}

function money(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function getMasterProfitReport(req) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgoDate = new Date();
  monthAgoDate.setMonth(monthAgoDate.getMonth() - 1);
  const monthAgo = monthAgoDate.toISOString().slice(0, 10);

  const startDate = normalizeDate(req.query.start_date, monthAgo);
  const endDate = normalizeDate(req.query.end_date, today);
  const masterId = req.query.master_id || 'ALL';
  const sort = req.query.sort || 'profit_desc';

  const params = [startDate, endDate];
  let where = `
    WHERE wo.status = 'Выполнен'
      AND wo.master_id IS NOT NULL
      AND COALESCE(wo.completed_at, wo.master_submitted_at, wo.created_at)::date BETWEEN $1::date AND $2::date
  `;

  if (masterId !== 'ALL') {
    params.push(Number(masterId));
    where += ` AND wo.master_id = $${params.length}`;
  }

  let orderBy = 'net_profit DESC, master_name ASC';
  if (sort === 'profit_asc') orderBy = 'net_profit ASC, master_name ASC';
  if (sort === 'revenue_desc') orderBy = 'revenue_total DESC, master_name ASC';
  if (sort === 'orders_desc') orderBy = 'orders_count DESC, master_name ASC';
  if (sort === 'master_asc') orderBy = 'master_name ASC';

  const reportResult = await pool.query(
    `
    WITH completed_orders AS (
      SELECT wo.order_id, wo.master_id
      FROM work_orders wo
      ${where}
    ),
    service_totals AS (
      SELECT os.order_id, SUM(os.qty * os.price)::numeric(12,2) AS services_revenue
      FROM order_services os
      JOIN completed_orders co ON co.order_id = os.order_id
      GROUP BY os.order_id
    ),
    part_totals AS (
      SELECT
        op.order_id,
        SUM(COALESCE(NULLIF(op.qty_used, 0), op.qty_reserved) * op.unit_price)::numeric(12,2) AS parts_revenue,
        SUM(COALESCE(NULLIF(op.qty_used, 0), op.qty_reserved) * COALESCE(op.purchase_unit_price, p.purchase_price, 0))::numeric(12,2) AS parts_cost_total
      FROM order_parts op
      JOIN parts p ON p.part_id = op.part_id
      JOIN completed_orders co ON co.order_id = op.order_id
      GROUP BY op.order_id
    ),
    order_finance AS (
      SELECT
        co.order_id,
        co.master_id,
        COALESCE(st.services_revenue, 0) AS services_revenue,
        COALESCE(pt.parts_revenue, 0) AS parts_revenue,
        COALESCE(pt.parts_cost_total, 0) AS parts_cost_total,
        (COALESCE(st.services_revenue, 0) + COALESCE(pt.parts_revenue, 0))::numeric(12,2) AS revenue_total,
        (COALESCE(st.services_revenue, 0) + COALESCE(pt.parts_revenue, 0) - COALESCE(pt.parts_cost_total, 0))::numeric(12,2) AS net_profit
      FROM completed_orders co
      LEFT JOIN service_totals st ON st.order_id = co.order_id
      LEFT JOIN part_totals pt ON pt.order_id = co.order_id
    )
    SELECT
      u.user_id AS master_id,
      u.full_name AS master_name,
      COUNT(ofn.order_id)::int AS orders_count,
      COALESCE(SUM(ofn.services_revenue), 0)::numeric(12,2) AS services_revenue,
      COALESCE(SUM(ofn.parts_revenue), 0)::numeric(12,2) AS parts_revenue,
      COALESCE(SUM(ofn.revenue_total), 0)::numeric(12,2) AS revenue_total,
      COALESCE(SUM(ofn.parts_cost_total), 0)::numeric(12,2) AS parts_cost_total,
      COALESCE(SUM(ofn.net_profit), 0)::numeric(12,2) AS net_profit,
      CASE
        WHEN COUNT(ofn.order_id) = 0 THEN 0
        ELSE ROUND((SUM(ofn.net_profit) / COUNT(ofn.order_id))::numeric, 2)
      END AS avg_profit_per_order
    FROM users u
    JOIN order_finance ofn ON ofn.master_id = u.user_id
    GROUP BY u.user_id, u.full_name
    ORDER BY ${orderBy}
    `,
    params
  );

  const mastersResult = await pool.query(
    `SELECT user_id, full_name FROM users WHERE role = 'MASTER' AND is_active = TRUE ORDER BY full_name ASC`
  );

  const summary = reportResult.rows.reduce(
    (acc, row) => {
      acc.orders_count += Number(row.orders_count || 0);
      acc.services_revenue += Number(row.services_revenue || 0);
      acc.parts_revenue += Number(row.parts_revenue || 0);
      acc.revenue_total += Number(row.revenue_total || 0);
      acc.parts_cost_total += Number(row.parts_cost_total || 0);
      acc.net_profit += Number(row.net_profit || 0);
      return acc;
    },
    {
      orders_count: 0,
      services_revenue: 0,
      parts_revenue: 0,
      revenue_total: 0,
      parts_cost_total: 0,
      net_profit: 0,
    }
  );

  return {
    rows: reportResult.rows,
    masters: mastersResult.rows,
    summary,
    startDate,
    endDate,
  };
}

router.get('/master-profit', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    const report = await getMasterProfitReport(req);
    res.json({ rows: report.rows, masters: report.masters, summary: report.summary });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/master-profit/excel', authMiddleware, allowRoles('ADMIN'), async (req, res) => {
  try {
    const report = await getMasterProfitReport(req);

    const rowsHtml = report.rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.master_name)}</td>
        <td>${row.orders_count}</td>
        <td>${money(row.services_revenue)}</td>
        <td>${money(row.parts_revenue)}</td>
        <td>${money(row.revenue_total)}</td>
        <td>${money(row.parts_cost_total)}</td>
        <td>${money(row.net_profit)}</td>
        <td>${money(row.avg_profit_per_order)}</td>
      </tr>
    `).join('');

    const html = `
      <html>
        <head>
          <meta charset="UTF-8" />
          <style>
            table { border-collapse: collapse; }
            th, td { border: 1px solid #000; padding: 6px; }
            th { font-weight: bold; background: #e5e7eb; }
          </style>
        </head>
        <body>
          <h2>Отчёт по чистой прибыли мастеров</h2>
          <p>Период: ${escapeHtml(report.startDate)} — ${escapeHtml(report.endDate)}</p>
          <table>
            <thead>
              <tr>
                <th>Мастер</th>
                <th>Заказов выполнено</th>
                <th>Выручка услуг</th>
                <th>Выручка запчастей</th>
                <th>Общая выручка</th>
                <th>Закупочная стоимость запчастей</th>
                <th>Чистая прибыль</th>
                <th>Средняя прибыль на заказ</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot>
              <tr>
                <th>Итого</th>
                <th>${report.summary.orders_count}</th>
                <th>${money(report.summary.services_revenue)}</th>
                <th>${money(report.summary.parts_revenue)}</th>
                <th>${money(report.summary.revenue_total)}</th>
                <th>${money(report.summary.parts_cost_total)}</th>
                <th>${money(report.summary.net_profit)}</th>
                <th></th>
              </tr>
            </tfoot>
          </table>
        </body>
      </html>
    `;

    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="master_profit_report.xls"');
    res.send(html);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
