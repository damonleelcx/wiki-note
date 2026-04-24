export const pageHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Wiki Note</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="topbar">
    <div class="brand">Wiki Note</div>
    <nav>
      <button id="goHomeBtn">Home</button>
      <button id="goGraphBtn">Graph</button>
      <button id="logoutBtn" class="ghost">Log out</button>
    </nav>
  </header>

  <main id="app"></main>
  <script type="module" src="/app.js"></script>
</body>
</html>`;
