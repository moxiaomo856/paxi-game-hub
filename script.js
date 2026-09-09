// 自动读取 games.json 并渲染游戏卡片
// 大厅永远不用改这个文件

fetch('games.json')
    .then(r => r.json())
    .then(games => {
        const grid = document.getElementById('games');
        
        if (!games.length) {
            grid.innerHTML = '<p class="loading">还没有游戏，快去 games.json 添加吧！</p>';
            return;
        }
        
        grid.innerHTML = games.map(g => {
            // 校验 URL 有效性
            const validUrl = g.url && g.url.trim() !== '' && g.url !== '#';
            
            if (!validUrl) {
                return `
                    <div class="game-card error">
                        <span class="game-icon">${g.icon || '🎮'}</span>
                        <div class="game-name">${g.name || '未命名'}</div>
                        <div class="game-desc">${g.desc || '尚未配置网址'}</div>
                    </div>
                `;
            }
            
            return `
                <a class="game-card" href="${g.url}" target="_blank" rel="noopener">
                    <span class="game-icon">${g.icon || '🎮'}</span>
                    <div class="game-name">${g.name || '未命名'}</div>
                    <div class="game-desc">${g.desc || ''}</div>
                </a>
            `;
        }).join('');
    })
    .catch(err => {
        document.getElementById('games').innerHTML = 
            `<p class="loading">加载失败: ${err.message}<br>请确认 games.json 文件存在</p>`;
        console.error('加载 games.json 失败:', err);
    });
