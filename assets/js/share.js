(function() {
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.gh-share-btn[data-action="copy"]');
    if (!btn) return;
    e.preventDefault();
    navigator.clipboard.writeText(window.location.href).then(function() {
      var original = btn.title;
      btn.title = btn.closest('.gh-share').querySelector('.gh-share-label').textContent === 'Share' ? 'Copied!' : '已复制!';
      setTimeout(function() { btn.title = original; }, 2000);
    });
  });
})();
