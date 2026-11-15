// 尽早应用主题，避免闪烁（外部脚本，符合 CSP）
(function () {
  try {
    var t = localStorage.getItem('af_theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
