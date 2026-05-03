(function() {
  function copyText(text, callback) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(callback).catch(function() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        callback();
      });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      callback();
    }
  }
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.gh-share-btn[data-action="copy"]');
    if (!btn) return;
    e.preventDefault();
    copyText(window.location.href, function() {
      var original = btn.title;
      btn.title = btn.closest('.gh-share').querySelector('.gh-share-label').textContent === 'Share' ? 'Copied!' : '已复制!';
      setTimeout(function() { btn.title = original; }, 2000);
    });
  });
})();
