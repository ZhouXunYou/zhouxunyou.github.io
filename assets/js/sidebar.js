(function() {
  var STORAGE_KEY = 'sidebar-state';

  // Save open/closed state of details elements
  function saveState() {
    var states = {};
    var details = document.querySelectorAll('.gh-tree-details');
    details.forEach(function(el, i) {
      // Use the summary text as key for readability
      var key = el.querySelector('.gh-tree-item span');
      if (key) {
        states[key.textContent.trim()] = el.hasAttribute('open');
      }
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
  }

  // Restore open/closed state
  function restoreState() {
    try {
      var states = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      var details = document.querySelectorAll('.gh-tree-details');
      details.forEach(function(el) {
        var key = el.querySelector('.gh-tree-item span');
        if (key && states.hasOwnProperty(key.textContent.trim())) {
          if (states[key.textContent.trim()]) {
            el.setAttribute('open', '');
          } else {
            el.removeAttribute('open');
          }
        }
      });
    } catch(e) { /* ignore parse errors */ }
  }

  // Listen for toggle events
  document.addEventListener('toggle', function(e) {
    if (e.target.classList && e.target.classList.contains('gh-tree-details')) {
      saveState();
    }
  }, true);

  // Restore on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreState);
  } else {
    restoreState();
  }

  // Mobile hamburger menu toggle
  var hamburger = document.querySelector('.gh-header-hamburger');
  var nav = document.querySelector('.gh-header-nav');
  if (hamburger && nav) {
    hamburger.addEventListener('click', function() {
      var expanded = hamburger.getAttribute('aria-expanded') === 'true';
      hamburger.setAttribute('aria-expanded', !expanded);
      nav.classList.toggle('gh-header-nav-open');
    });
  }

  // Mobile sidebar toggle
  var sidebarToggle = document.querySelector('.gh-sidebar-toggle');
  var sidebar = document.querySelector('.gh-sidebar');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', function() {
      sidebar.classList.toggle('gh-sidebar-open');
    });
  }

  // Show sidebar tree group matching current category
  var currentCategory = document.querySelector('[data-category]');
  // All groups are rendered; visibility is handled by CSS based on active tab
})();
