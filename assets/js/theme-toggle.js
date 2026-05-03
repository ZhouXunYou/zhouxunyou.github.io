(function() {
  // Read stored preference or system preference
  var stored = localStorage.getItem('theme');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = stored || (prefersDark ? 'dark' : 'light');

  // Apply theme
  document.documentElement.setAttribute('data-theme', theme);

  // Toggle function
  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  }

  // Bind click event
  document.addEventListener('DOMContentLoaded', function() {
    var btn = document.getElementById('gh-theme-toggle');
    if (btn) btn.addEventListener('click', toggleTheme);
  });

  // Listen for system preference changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
    if (!localStorage.getItem('theme')) {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
  });
})();
