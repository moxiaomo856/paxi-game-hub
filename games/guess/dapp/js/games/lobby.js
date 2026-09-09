import { CONFIG } from '../config.js';

const gameLoaders = {
    guess: async () => {
        const mod = await import('./guess/index.js');
        return mod.render();
    },
    // 未来游戏在此注册
    // poker: () => import('./poker/index.js').then(m => m.render()),
};

export async function loadGame(gameId) {
    const area = document.getElementById('gameArea');
    area.innerHTML = '<p>加载中...</p>';
    
    const loader = gameLoaders[gameId];
    if (!loader) {
        area.innerHTML = `<p>游戏 "${gameId}" 尚未实现</p>`;
        return;
    }
    
    try {
        const html = await loader();
        area.innerHTML = html;
        
        // 初始化游戏事件
        if (gameId === 'guess') {
            const { init } = await import('./guess/index.js');
            init();
        }
    } catch (e) {
        console.error('加载游戏失败:', e);
        area.innerHTML = '<p>加载游戏失败，请重试</p>';
    }
}
