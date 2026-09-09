// 斗地主游戏占位
// 真实实现后续填充：发牌、叫地主、出牌判定、AABBCC/顺子/连对等

function placeholder() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>斗地主 · 开发中</title>
<link rel="stylesheet" href="../guess/style.css">
<style>
    .placeholder-box {
        text-align: center;
        padding: 60px 20px;
    }
    .big-icon { font-size: 96px; margin-bottom: 20px; }
    .coming-soon { font-size: 22px; color: #ffd700; margin-bottom: 12px; }
    .tips { color: rgba(255,255,255,0.6); font-size: 14px; line-height: 1.8; }
    .tips code {
        background: rgba(255,255,255,0.1);
        padding: 2px 6px;
        border-radius: 4px;
    }
</style>
</head>
<body>
<div class="game-container placeholder-box">
    <a href="../../index.html" class="back-btn">← 返回大厅</a>
    <div class="big-icon">🃏</div>
    <h1>斗地主</h1>
    <div class="coming-soon">🚧 开发中</div>
    <div class="tips">
        三个核心文件已预留，请在以下位置填充逻辑：<br>
        <code>game.js</code> · 发牌/叫地主/出牌判定<br>
        <code>style.css</code> · 桌面布局/手牌/出牌区<br>
        <code>index.html</code> · 三列布局 + AI 对手区域
    </div>
</div>
<script src="game.js"></script>
</body>
</html>`;
}

// 占位
console.log('斗地主占位文件 — 待实现');
