import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';
import {
  validateLogin,
  validatePassword,
  validateFullName,
  validatePhone,
  validateEmail,
  formatPhoneForStorage,
} from '../utils/validators.js';

const router = express.Router();

function signUser(user) {
  return jwt.sign(
    {
      user_id: user.user_id,
      login: user.login,
      full_name: user.full_name,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

router.post('/register', async (req, res) => {
  try {
    const { login, password, full_name, phone = null, email = null } = req.body;

    validateLogin(login);
    validatePassword(password);
    validateFullName(full_name);
    validatePhone(phone);
    validateEmail(email);

    const exists = await pool.query('SELECT user_id FROM users WHERE login = $1', [login]);
    if (exists.rowCount > 0) {
      return res.status(400).json({ message: 'Пользователь с таким логином уже существует.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const normalizedPhone = phone ? formatPhoneForStorage(phone) : null;

    const result = await pool.query(
      `INSERT INTO users (login, password_hash, full_name, role, phone, email)
       VALUES ($1, $2, $3, 'ADMIN', $4, $5)
       RETURNING user_id, login, full_name, role, phone, email, is_active`,
      [login, passwordHash, full_name.trim(), normalizedPhone, email || null]
    );

    const user = result.rows[0];
    const token = signUser(user);

    res.status(201).json({ token, user });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/register-master', async (req, res) => {
  try {
    const { login, password, full_name, phone = null, email = null } = req.body;

    validateLogin(login);
    validatePassword(password);
    validateFullName(full_name);
    validatePhone(phone);
    validateEmail(email);

    const exists = await pool.query('SELECT user_id FROM users WHERE login = $1', [login]);
    if (exists.rowCount > 0) {
      return res.status(400).json({ message: 'Пользователь с таким логином уже существует.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const normalizedPhone = phone ? formatPhoneForStorage(phone) : null;

    const result = await pool.query(
      `INSERT INTO users (login, password_hash, full_name, role, phone, email)
       VALUES ($1, $2, $3, 'MASTER', $4, $5)
       RETURNING user_id, login, full_name, role, phone, email, is_active`,
      [login, passwordHash, full_name.trim(), normalizedPhone, email || null]
    );

    const user = result.rows[0];
    const token = signUser(user);

    res.status(201).json({ token, user });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;

    validateLogin(login);
    validatePassword(password);

    const result = await pool.query(
      `SELECT user_id, login, password_hash, full_name, role, phone, email, is_active
         FROM users
        WHERE login = $1`,
      [login]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ message: 'Неверный логин или пароль.' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ message: 'Пользователь заблокирован.' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(400).json({ message: 'Неверный логин или пароль.' });
    }

    const safeUser = {
      user_id: user.user_id,
      login: user.login,
      full_name: user.full_name,
      role: user.role,
      phone: user.phone,
      email: user.email,
    };

    const token = signUser(safeUser);
    res.json({ token, user: safeUser });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id, login, full_name, role, phone, email, is_active
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

router.get('/masters', authMiddleware, allowRoles('ADMIN'), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         u.user_id,
         u.full_name,
         u.login,
         COALESCE(COUNT(wo.order_id) FILTER (
           WHERE wo.status IN ('Ожидает принятия мастером', 'В работе')
         ), 0)::int AS active_orders_count
       FROM users u
       LEFT JOIN work_orders wo ON wo.master_id = u.user_id
       WHERE u.role = 'MASTER' AND u.is_active = TRUE
       GROUP BY u.user_id
       ORDER BY active_orders_count ASC, u.full_name ASC`
    );

    res.json({ masters: result.rows });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;