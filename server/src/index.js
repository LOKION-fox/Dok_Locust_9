import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pool } from './db.js';

import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import clientsRoutes from './routes/clients.js';
import vehiclesRoutes from './routes/vehicles.js';
import partsRoutes from './routes/parts.js';
import workOrdersRoutes from './routes/workOrders.js';
import purchaseOrdersRoutes from './routes/purchaseOrders.js';
import suppliersRoutes from './routes/suppliers.js';
import masterRoutes from './routes/master.js';
import reportsRoutes from './routes/reports.js';

const app = express();
const port = Number(process.env.PORT || 5000);

app.use(cors());
app.use(express.json());

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, message: 'Сервер и БД доступны.' });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/vehicles', vehiclesRoutes);
app.use('/api/parts', partsRoutes);
app.use('/api/work-orders', workOrdersRoutes);
app.use('/api/purchase-orders', purchaseOrdersRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/master', masterRoutes);
app.use('/api/reports', reportsRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: err.message || 'Внутренняя ошибка сервера.' });
});

app.listen(port, () => {
  console.log(`Server started on http://localhost:${port}`);
});