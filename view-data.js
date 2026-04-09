const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

console.log('========================================');
console.log('       每周待办事项 - 数据查看器       ');
console.log('========================================\n');

// 查看用户表
console.log('【用户表】');
console.log('----------------------------------------');
db.all('SELECT id, username, created_at FROM users', [], (err, users) => {
    if (err) {
        console.error('查询用户表失败:', err);
        return;
    }
    if (users.length === 0) {
        console.log('暂无用户数据');
        return;
    }
    
    users.forEach((user, index) => {
        console.log(`${index + 1}. 用户名: ${user.username}`);
        console.log(`   ID: ${user.id}`);
        console.log(`   创建时间: ${user.created_at}`);
        console.log('');
    });
    
    // 为每个用户显示任务
    console.log('\n【各用户任务详情】');
    console.log('========================================');
    
    let userIndex = 0;
    
    function showNextUserTasks() {
        if (userIndex >= users.length) {
            // 所有用户显示完毕，显示完成历史
            console.log('\n【完成历史】');
            console.log('----------------------------------------');
            db.all(`SELECT h.text, h.date_key, h.completed_at, u.username 
                    FROM task_history h 
                    JOIN users u ON h.user_id = u.id 
                    ORDER BY h.completed_at DESC LIMIT 20`, [], (err, rows) => {
                if (err) {
                    console.error('查询历史表失败:', err);
                    db.close();
                    return;
                }
                if (rows.length === 0) {
                    console.log('暂无完成记录');
                } else {
                    rows.forEach((row, index) => {
                        console.log(`${index + 1}. [${row.username}] ${row.text}`);
                        console.log(`   完成时间: ${row.completed_at}`);
                        console.log('');
                    });
                }
                
                console.log('========================================');
                console.log('              数据查看完成              ');
                console.log('========================================');
                db.close();
            });
            return;
        }
        
        const user = users[userIndex];
        userIndex++;
        
        console.log(`\n【${user.username} 的任务】`);
        console.log('----------------------------------------');
        
        db.all('SELECT text, date_key, completed, priority, is_repeat FROM tasks WHERE user_id = ? ORDER BY date_key DESC', 
            [user.id], (err, tasks) => {
            if (err) {
                console.error('查询任务失败:', err);
                showNextUserTasks();
                return;
            }
            
            if (tasks.length === 0) {
                console.log('该用户暂无任务');
            } else {
                // 统计
                const completed = tasks.filter(t => t.completed).length;
                const pending = tasks.length - completed;
                console.log(`任务总数: ${tasks.length} | 已完成: ${completed} | 待完成: ${pending}\n`);
                
                tasks.forEach((task, index) => {
                    const status = task.completed ? '✓' : '○';
                    const priority = task.priority === 'high' ? '高' : task.priority === 'medium' ? '中' : '低';
                    const repeat = task.is_repeat ? '🔄' : '';
                    console.log(`${index + 1}. ${status} [${task.date_key}] [${priority}] ${task.text} ${repeat}`);
                });
            }
            
            showNextUserTasks();
        });
    }
    
    showNextUserTasks();
});
