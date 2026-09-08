const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_PASSWORD = 'admin123';

if (!process.env.DATABASE_URL) {
  console.error('LỖI: chưa cấu hình biến môi trường DATABASE_URL (link kết nối Neon Postgres).');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Dữ liệu mặc định khi chạy lần đầu (chưa có gì trong database)
function defaultData() {
  const MONTH_KEYS = ['t8','t9','t10','t11','t12','t1','t2','t3','t4','t5','t6','t7'];
  const months = {};
  MONTH_KEYS.forEach(k => { months[k] = { transactions: [] }; });
  const now = new Date();
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1; // tháng 8 trở đi (index 7) tính là năm học mới
  return {
    title: 'Của tôi',
    settings: { background: null },
    years: {
      [String(startYear)]: { startYear, label: `${startYear} - ${startYear + 1}`, months }
    },
    holdings: [
      { id: 'seed-cash', kind: 'cash', name: 'Tiền mặt', opening: 0, note: '' },
      { id: 'seed-bank', kind: 'bank', name: 'Tài khoản', opening: 0, note: '' }
    ],
    editLog: []
  };
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_auth (
      id INTEGER PRIMARY KEY DEFAULT 1,
      password TEXT NOT NULL
    );
  `);
  const stateRes = await pool.query('SELECT id FROM app_state WHERE id = 1');
  if (stateRes.rowCount === 0) {
    await pool.query('INSERT INTO app_state (id, data) VALUES (1, $1)', [JSON.stringify(defaultData())]);
    console.log('Đã khởi tạo dữ liệu mặc định.');
  }
  const authRes = await pool.query('SELECT id FROM admin_auth WHERE id = 1');
  if (authRes.rowCount === 0) {
    await pool.query('INSERT INTO admin_auth (id, password) VALUES (1, $1)', [DEFAULT_PASSWORD]);
    console.log(`Đã đặt mật khẩu Admin mặc định: ${DEFAULT_PASSWORD} (đổi ngay sau khi đăng nhập lần đầu!)`);
  }
}

// ---- API ----

// Ai cũng xem được (chế độ xem) — không chứa mật khẩu vì mật khẩu nằm ở bảng riêng
app.get('/api/data', async (req, res) => {
  try {
    const r = await pool.query('SELECT data FROM app_state WHERE id = 1');
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0].data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Chỉ Admin (kèm đúng mật khẩu) mới ghi được dữ liệu
app.post('/api/data', async (req, res) => {
  try {
    const { password, data } = req.body || {};
    if (!data) return res.status(400).json({ error: 'missing_data' });
    const authRes = await pool.query('SELECT password FROM admin_auth WHERE id = 1');
    if (!authRes.rowCount || authRes.rows[0].password !== password) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    await pool.query('UPDATE app_state SET data = $1, updated_at = now() WHERE id = 1', [JSON.stringify(data)]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Kiểm tra mật khẩu khi đăng nhập
app.post('/api/login', async (req, res) => {
  try {
    const { password } = req.body || {};
    const authRes = await pool.query('SELECT password FROM admin_auth WHERE id = 1');
    if (authRes.rowCount && authRes.rows[0].password === password) {
      res.json({ ok: true });
    } else {
      res.status(401).json({ ok: false });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Đổi mật khẩu Admin (cần đúng mật khẩu cũ)
app.post('/api/change-password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'invalid_new_password' });
    }
    const authRes = await pool.query('SELECT password FROM admin_auth WHERE id = 1');
    if (!authRes.rowCount || authRes.rows[0].password !== oldPassword) {
      return res.status(401).json({ error: 'wrong_password' });
    }
    await pool.query('UPDATE admin_auth SET password = $1 WHERE id = 1', [newPassword]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Mọi đường dẫn khác trả về trang chính (single-page app)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`Đang chạy tại cổng ${PORT}`));
  })
  .catch(err => {
    console.error('Không kết nối được database:', err.message);
    process.exit(1);
  });
