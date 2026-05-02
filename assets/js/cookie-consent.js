(function() {
  var banner = document.getElementById('gh-cookie-banner');
  if (!banner) return;

  var consent = localStorage.getItem('cookie-consent');
  if (consent === 'accepted' || consent === 'declined') {
    return; // Already decided
  }

  banner.style.display = 'block';

  document.getElementById('gh-cookie-accept').addEventListener('click', function() {
    localStorage.setItem('cookie-consent', 'accepted');
    banner.style.display = 'none';
  });

  document.getElementById('gh-cookie-decline').addEventListener('click', function() {
    localStorage.setItem('cookie-consent', 'declined');
    banner.style.display = 'none';
    // Disable non-essential cookies
    disableNonEssentialCookies();
  });

  function disableNonEssentialCookies() {
    // Clear Google Analytics cookies
    var gaCookies = document.cookie.split(';').filter(function(c) {
      return c.trim().startsWith('_ga') || c.trim().startsWith('_gid') || c.trim().startsWith('_gat');
    });
    gaCookies.forEach(function(c) {
      var name = c.split('=')[0].trim();
      document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=' + window.location.hostname;
      document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    });
  }
})();
