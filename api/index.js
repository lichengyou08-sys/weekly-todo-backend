const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 内存存储
const users = {};
const tasks = {};
const history = {};
const sessionStore = {};

// 简化的 session 中间件
app.use((req, res, next) => {
    const sessionId = req.headers['x-session-id'] || 'default';
    if (!sessionStore[sessionId]) {
        sessionStore[sessionId] = {};
    }
    req.session = sessionStore[sessionId];
    next();
});

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// 测试接口
app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working!' });
});

// 注册
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少需要6位' });
    if (users[username]) return res.status(400).json({ error: '用户名已存在' });
    
    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);
    users[username] = { id: userId, username, password: hashedPassword };
    tasks[userId] = [];
    history[userId] = [];
    res.status(201).json({ message: '注册成功', user_id: userId });
});

// 登录
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users[username];
    if (!user || !await bcrypt.compare(password, user.password)) {
        return res.status(401).json({ error: '用户名或密码错误' });
    }
    req.session.userId = user.id;
    req.session.username = username;
    res.json({ message: '登录成功', user_id: user.id, username });
});

// 登出
app.post('/api/logout', (req, res) => {
    req.session = {};
    res.json({ message: '登出成功' });
});

// 检查登录
app.get('/api/check-auth', (req, res) => {
    if (req.session.userId) {
        res.json({ authenticated: true, user_id: req.session.userId, username: req.session.username });
    } else {
        res.status(401).json({ authenticated: false });
    }
});

// 获取任务
app.get('/api/tasks', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    const { date_key } = req.query;
    let userTasks = tasks[req.session.userId] || [];
    if (date_key) userTasks = userTasks.filter(t => t.date_key === date_key);
    res.json({ tasks: userTasks });
});

// 创建任务
app.post('/api/tasks', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    const { text, date_key, priority = 'medium', is_repeat = false } = req.body;
    if (!text || !date_key) return res.status(400).json({ error: '任务内容和日期不能为空' });
    
    const taskId = uuidv4();
    const newTask = {
        id: taskId, user_id: req.session.userId, text, date_key,
        completed: false, priority, is_repeat: is_repeat ? 1 : 0,
        created_at: new Date().toISOString()
    };
    if (!tasks[req.session.userId]) tasks[req.session.userId] = [];
    tasks[req.session.userId].push(newTask);
    res.status(201).json({ message: '任务创建成功', task_id: taskId });
});

// 更新任务
app.put('/api/tasks/:taskId', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    const { taskId } = req.params;
    const { text, completed, priority } = req.body;
    const userTasks = tasks[req.session.userId] || [];
    const taskIndex = userTasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return res.status(404).json({ error: '任务不存在' });
    
    const task = userTasks[taskIndex];
    if (completed === true && !task.completed) {
        if (!history[req.session.userId]) history[req.session.userId] = [];
        history[req.session.userId].unshift({
            id: uuidv4(), user_id: req.session.userId, text: task.text,
            date_key: task.date_key, completed_at: new Date().toISOString()
        });
    }
    
    if (text !== undefined) task.text = text;
    if (completed !== undefined) task.completed = completed;
    if (priority !== undefined) task.priority = priority;
    res.json({ message: '任务更新成功' });
});

// 删除任务
app.delete('/api/tasks/:taskId', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    const { taskId } = req.params;
    const userTasks = tasks[req.session.userId] || [];
    const initialLength = userTasks.length;
    tasks[req.session.userId] = userTasks.filter(t => t.id !== taskId);
    if (tasks[req.session.userId].length === initialLength) {
        return res.status(404).json({ error: '任务不存在' });
    }
    res.json({ message: '任务删除成功' });
});

// 历史记录
app.get('/api/history', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    const { period = 'all' } = req.query;
    let userHistory = history[req.session.userId] || [];
    const now = new Date();
    if (period === 'week') {
        userHistory = userHistory.filter(h => new Date(h.completed_at) >= new Date(now - 7 * 24 * 60 * 60 * 1000));
    } else if (period === 'month') {
        userHistory = userHistory.filter(h => new Date(h.completed_at) >= new Date(now - 30 * 24 * 60 * 60 * 1000));
    }
    res.json({ history: userHistory });
});

// 统计
app.get('/api/stats', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    const userTasks = tasks[req.session.userId] || [];
    const total = userTasks.length;
    const completed = userTasks.filter(t => t.completed).length;
    res.json({ total, completed, pending: total - completed });
});

module.exports = (req, res) => {
    return app(req, res);
};
