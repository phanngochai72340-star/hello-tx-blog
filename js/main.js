(function () {
  var root = document.documentElement;
  var btn = document.getElementById('theme-toggle');

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    try { localStorage.setItem('tx-blog-theme', theme); } catch (e) {}
  }

  var saved = null;
  try { saved = localStorage.getItem('tx-blog-theme'); } catch (e) {}

  if (saved) {
    apply(saved);
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    apply('dark');
  }

  if (btn) {
    btn.addEventListener('click', function () {
      apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  }
})();
