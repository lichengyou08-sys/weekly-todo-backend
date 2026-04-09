const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('@neondatabase/serverless');
const { v4: uuidv4 } = require('uuid');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionStore = {};
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    store: {
        get: (sid, cb) => cb(null, sessionStore[sid]),
        set: (sid, sess, cb) => { sessionStore[sid] = sess; cb(null); },
        destroy: (sid, cb) => { delete sessionStore[sid]; cb(null); }
    },
    cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Neon 数据库连接
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 初始化数据库表
async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                text TEXT NOT NULL,
                date_key TEXT NOT NULL,
                completed BOOLEAN DEFAULT FALSE,
                priority TEXT DEFAULT 'medium',
                is_repeat BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS task_history (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                text TEXT NOT NULL,
                date_key TEXT NOT NULL,
                completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } finally {
        client.release();
    }
}

initDB().catch(console.error);

// ==================== 用户认证 API ====================

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少需要6位' });
    
    const client = await pool.connect();
    try {
        const existing = await client.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existing.rows.length > 0) return res.status(400).json({ error: '用户名已存在' });
        
        const userId = uuidv4();
        const hashedPassword = await bcrypt.hash(password, 10);
        await client.query('INSERT INTO users (id, username, password) VALUES ($1, $2, $3)', 
            [userId, username, hashedPassword]);
        res.status(201).json({ message: '注册成功', user_id: userId });
    } finally {
        client.release();
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT id, password FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: '用户名或密码错误' });
        
        const user = result.rows[0];
        if (!await bcrypt.compare(password, user.password)) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }
        req.session.userId = user.id;
        req.session.username = username;
        res.json({ message: '登录成功', user_id: user.id, username });
    } finally {
        client.release();
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: '登出成功' });
});

app.get('/api/check-auth', (req, res) => {
    if (req.session.userId) {
        res.json({ authenticated: true, user_id: req.session.userId, username: req.session.username });
    } else {
        res.status(401).json({ authenticated: false });
    }
});

// ==================== 任务 API ====================

app.get('/api/tasks', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    const { date_key } = req.query;
    const client = await pool.connect();
    try {
        let sql = 'SELECT * FROM tasks WHERE user_id = $1';
        let params = [req.session.userId];
        if (date_key) {
            sql += ' AND date_key = $2';
            params.push(date_key);
        }
        sql += ` ORDER BY 
            CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            created_at DESC`;
        const result = await client.query(sql, params);
        res.json({ tasks: result.rows });
    } finally {
        client.release();
    }
});

app.post('/api/tasks', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    const { text, date_key, priority = 'medium', is_repeat = false } = req.body;
    if (!text || !date_key) return res.status(400).json({ error: '任务内容和日期不能为空' });
    
    const client = await pool.connect();
    try {
        const taskId = uuidv4();
        await client.query(
            'INSERT INTO tasks (id, user_id, text, date_key, priority, is_repeat) VALUES ($1, $2, $3, $4, $5, $6)',
            [taskId, req.session.userId, text, date_key, priority, is_repeat]
        );
        res.status(201).json({ message: '任务创建成功', task_id: taskId });
    } finally {
        client.release();
    }
});

app.put('/api/tasks/:taskId', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    const { taskId } = req.params;
    const { text, completed, priority } = req.body;
    const client = await pool.connect();
    try {
        const taskResult = await client.query('SELECT * FROM tasks WHERE id = $1 AND user_id = $2', [taskId, req.session.userId]);
        if (taskResult.rows.length === 0) return res.status(404).json({ error: '任务不存在' });
        
        const task = taskResult.rows[0];
        
        if (completed === true && !task.completed) {
            await client.query(
                'INSERT INTO task_history (id, user_id, text, date_key) VALUES ($1, $2, $3, $4)',
                [uuidv4(), req.session.userId, task.text, task.date_key]
            );
        }
        
        const updates = [];
        const values = [];
        let paramIndex = 1;
        
        if (text !== undefined) { updates.push(`text = $${paramIndex++}`); values.push(text); }
        if (completed !== undefined) { updates.push(`completed = $${paramIndex++}`); values.push(completed); }
        if (priority !== undefined) { updates.push(`priority = $${paramIndex++}`); values.push(priority); }
        
        if (updates.length > 0) {
            values.push(taskId);
            await client.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIndex}`, values);
        }
        res.json({ message: '任务更新成功' });
    } finally {
        client.release();
    }
});

app.delete('/api/tasks/:taskId', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    const { taskId } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [taskId, req.session.userId]);
        if (result.rowCount === 0) return res.status(404).json({ error: '任务不存在' });
        res.json({ message: '任务删除成功' });
    } finally {
        client.release();
    }
});

app.get('/api/history', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    const { period = 'all' } = req.query;
    const client = await pool.connect();
    try {
        let sql = 'SELECT * FROM task_history WHERE user_id = $1';
        let params = [req.session.userId];
        if (period === 'week') {
            sql += " AND completed_at >= NOW() - INTERVAL '7 days'";
        } else if (period === 'month') {
            sql += " AND completed_at >= NOW() - INTERVAL '30 days'";
        }
        sql += ' ORDER BY completed_at DESC LIMIT 100';
        const result = await client.query(sql, params);
        res.json({ history: result.rows });
    } finally {
        client.release();
    }
});

app.get('/api/stats', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    const client = await pool.connect();
    try {
        const totalResult = await client.query('SELECT COUNT(*) FROM tasks WHERE user_id = $1', [req.session.userId]);
        const completedResult = await client.query('SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND completed = TRUE', [req.session.userId]);
        const total = parseInt(totalResult.rows[0].count);
        const completed = parseInt(completedResult.rows[0].count);
        res.json({ total, completed, pending: total - completed });
    } finally {
        client.release();
    }
});

// Vercel Serverless Function 导出
module.exports = (req, res) => {
    return app(req, res);
};
