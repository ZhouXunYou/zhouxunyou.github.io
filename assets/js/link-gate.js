(function() {
  var gate = document.getElementById('linkGate');
  if (!gate) return;

  var slug = gate.dataset.slug;
  var apiBase = gate.dataset.api;
  var btn = document.getElementById('linkGateBtn');
  var countdown = document.getElementById('linkGateCountdown');
  var timer = document.getElementById('linkGateTimer');
  var result = document.getElementById('linkGateResult');
  var urlEl = document.getElementById('linkGateUrl');
  var pwdEl = document.getElementById('linkGatePwd');
  var pwdCode = document.getElementById('linkGatePwdCode');
  var errorEl = document.getElementById('linkGateError');

  if (!btn || !countdown || !timer) return;

  var seconds = 10;

  var interval = setInterval(function() {
    seconds--;
    countdown.textContent = seconds;
    if (seconds <= 0) {
      clearInterval(interval);
      timer.style.display = 'none';
      btn.disabled = false;
      btn.classList.add('active');
    }
  }, 1000);

  btn.addEventListener('click', function() {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '获取中...';

    fetch(apiBase + '/api/links/' + encodeURIComponent(slug))
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.error) {
        if (errorEl) {
          errorEl.textContent = data.error;
          errorEl.style.display = 'block';
        }
          btn.textContent = '获取下载链接';
          btn.disabled = false;
          return;
        }
        if (urlEl) urlEl.href = data.url;
        if (result) result.style.display = 'block';
        btn.style.display = 'none';
        if (data.password) {
          if (pwdCode) pwdCode.textContent = data.password;
          if (pwdEl) pwdEl.style.display = 'block';
        }
      })
      .catch(function() {
      if (errorEl) {
        errorEl.textContent = '获取失败，请稍后重试';
        errorEl.style.display = 'block';
      }
        btn.textContent = '获取下载链接';
        btn.disabled = false;
      });
  });
})();
