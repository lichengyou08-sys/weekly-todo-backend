const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session配置
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7天
    }
}));

// CORS配置
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// 数据库初始化
const DB_PATH = process.env.DB_PATH || './database.db';
const db = new sqlite3.Database(DB_PATH);

function initDB() {
    db.serialize(() => {
        // 用户表
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 任务表
        db.run(`CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            text TEXT NOT NULL,
            date_key TEXT NOT NULL,
            completed INTEGER DEFAULT 0,
            priority TEXT DEFAULT 'medium',
            is_repeat INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // 重复任务表
        db.run(`CREATE TABLE IF NOT EXISTS repeat_tasks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            text TEXT NOT NULL,
            priority TEXT DEFAULT 'medium',
            day_of_week INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // 完成历史表
        db.run(`CREATE TABLE IF NOT EXISTS task_history (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            text TEXT NOT NULL,
            date_key TEXT NOT NULL,
            completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);
    });
}

// ==================== 用户认证 API ====================

// 注册
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: '密码至少需要6位' });
    }

    db.get('SELECT id FROM users WHERE username = ?', [username], async (err, row) => {
        if (err) return res.status(500).json({ error: '数据库错误' });
        if (row) return res.status(400).json({ error: '用户名已存在' });

        const userId = uuidv4();
        const hashedPassword = await bcrypt.hash(password, 10);

        db.run('INSERT INTO users (id, username, password) VALUES (?, ?, ?)',
            [userId, username, hashedPassword], (err) => {
                if (err) return res.status(500).json({ error: '注册失败' });
                res.status(201).json({ message: '注册成功', user_id: userId });
            });
    });
});

// 登录
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    db.get('SELECT id, password FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) return res.status(500).json({ error: '数据库错误' });
        if (!user) return res.status(401).json({ error: '用户名或密码错误' });

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.status(401).json({ error: '用户名或密码错误' });

        req.session.userId = user.id;
        req.session.username = username;
        res.json({ message: '登录成功', user_id: user.id, username });
    });
});

// 登出
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: '登出成功' });
});

// 检查登录状态
app.get('/api/check-auth', (req, res) => {
    if (req.session.userId) {
        res.json({ authenticated: true, user_id: req.session.userId, username: req.session.username });
    } else {
        res.status(401).json({ authenticated: false });
    }
});

// ==================== 任务 API ====================

// 获取任务
app.get('/api/tasks', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: '未登录' });
    }

    const { date_key } = req.query;
    let sql = 'SELECT * FROM tasks WHERE user_id = ?';
    let params = [req.session.userId];

    if (date_key) {
        sql += ' AND date_key = ?';
        params.push(date_key);
    }

    sql += ` ORDER BY 
        CASE priority 
            WHEN 'high' THEN 1 
            WHEN 'medium' THEN 2 
            WHEN 'low' THEN 3 
        END,
        created_at DESC`;

    db.all(sql, params, (err, tasks) => {
        if (err) return res.status(500).json({ error: '查询失败' });
        res.json({ tasks });
    });
});

// 创建任务
app.post('/api/tasks', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: '未登录' });
    }

    const { text, date_key, priority = 'medium', is_repeat = false } = req.body;

    if (!text || !date_key) {
        return res.status(400).json({ error: '任务内容和日期不能为空' });
    }

    const taskId = uuidv4();
    db.run('INSERT INTO tasks (id, user_id, text, date_key, priority, is_repeat) VALUES (?, ?, ?, ?, ?, ?)',
        [taskId, req.session.userId, text, date_key, priority, is_repeat ? 1 : 0], (err) => {
            if (err) return res.status(500).json({ error: '创建失败' });
            res.status(201).json({ message: '任务创建成功', task_id: taskId });
        });
});

// 更新任务
app.put('/api/tasks/:taskId', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: '未登录' });
    }

    const { taskId } = req.params;
    const { text, completed, priority } = req.body;

    db.get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, req.session.userId], (err, task) => {
        if (err) return res.status(500).json({ error: '查询失败' });
        if (!task) return res.status(404).json({ error: '任务不存在' });

        const updates = [];
        const values = [];

        if (text !== undefined) {
            updates.push('text = ?');
            values.push(text);
        }

        if (completed !== undefined) {
            updates.push('completed = ?');
            values.push(completed ? 1 : 0);

            // 如果标记为完成，添加到历史
            if (completed && !task.completed) {
                const historyId = uuidv4();
                db.run('INSERT INTO task_history (id, user_id, text, date_key) VALUES (?, ?, ?, ?)',
                    [historyId, req.session.userId, task.text, task.date_key]);
            }
        }

        if (priority !== undefined) {
            updates.push('priority = ?');
            values.push(priority);
        }

        if (updates.length > 0) {
            values.push(taskId);
            db.run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, values, (err) => {
                if (err) return res.status(500).json({ error: '更新失败' });
                res.json({ message: '任务更新成功' });
            });
        } else {
            res.json({ message: '无更新' });
        }
    });
});

// 删除任务
app.delete('/api/tasks/:taskId', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: '未登录' });
    }

    const { taskId } = req.params;

    db.run('DELETE FROM tasks WHERE id = ? AND user_id = ?', [taskId, req.session.userId], function(err) {
        if (err) return res.status(500).json({ error: '删除失败' });
        if (this.changes === 0) return res.status(404).json({ error: '任务不存在' });
        res.json({ message: '任务删除成功' });
    });
});

// ==================== 历史记录 API ====================

app.get('/api/history', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: '未登录' });
    }

    const { period = 'all' } = req.query;
    let sql = 'SELECT * FROM task_history WHERE user_id = ?';
    let params = [req.session.userId];

    if (period === 'week') {
        sql += " AND completed_at >= datetime('now', '-7 days')";
    } else if (period === 'month') {
        sql += " AND completed_at >= datetime('now', '-30 days')";
    }

    sql += ' ORDER BY completed_at DESC LIMIT 100';

    db.all(sql, params, (err, history) => {
        if (err) return res.status(500).json({ error: '查询失败' });
        res.json({ history });
    });
});

// ==================== 统计 API ====================

app.get('/api/stats', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: '未登录' });
    }

    db.get('SELECT COUNT(*) as total FROM tasks WHERE user_id = ?', [req.session.userId], (err, totalRow) => {
        if (err) return res.status(500).json({ error: '统计失败' });

        db.get('SELECT COUNT(*) as completed FROM tasks WHERE user_id = ? AND completed = 1', [req.session.userId], (err, completedRow) => {
            if (err) return res.status(500).json({ error: '统计失败' });

            db.get('SELECT COUNT(*) as pending FROM tasks WHERE user_id = ? AND completed = 0', [req.session.userId], (err, pendingRow) => {
                if (err) return res.status(500).json({ error: '统计失败' });

                res.json({
                    total: totalRow.total,
                    completed: completedRow.completed,
                    pending: pendingRow.pending
                });
            });
        });
    });
});

// 前端页面
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动服务器
initDB();
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
