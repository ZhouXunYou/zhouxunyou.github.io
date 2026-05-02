(function() {
  var searchIndex = null;
  var documents = [];
  var isLoading = false;
  var activeIndex = -1;
  var pendingCallbacks = [];

  var overlay = document.getElementById('gh-search-overlay');
  var input = document.getElementById('gh-search-input');
  var resultsList = document.getElementById('gh-search-results');
  var emptyEl = document.getElementById('gh-search-empty');
  var hintEl = document.getElementById('gh-search-hint');

  if (!overlay || !input) return;

  // Detect current language from <html> lang attribute
  function getCurrentLang() {
    var htmlLang = document.documentElement.lang || 'zh';
    return htmlLang.startsWith('en') ? 'en' : 'zh';
  }

  // Bigram tokenizer: handles both Chinese and English text
  // Returns an array of tokens: English words as-is, Chinese as bigram pairs
  function bigramTokenize(str) {
    if (!str) return [];
    str = String(str).toLowerCase();
    var tokens = [];
    var buf = '';

    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var code = str.charCodeAt(i);

      if (code >= 0x4e00 && code <= 0x9fff) {
        // CJK character: accumulate for bigram
        buf += ch;
      } else if (/[a-z0-9]/.test(ch)) {
        // Flush CJK buffer first
        if (buf) {
          flushCjk(buf, tokens);
          buf = '';
        }
        // Collect full English word
        var word = ch;
        while (i + 1 < str.length && /[a-z0-9]/.test(str.charAt(i + 1))) {
          i++;
          word += str.charAt(i);
        }
        tokens.push(word);
      } else {
        // Separator: flush CJK buffer
        if (buf) {
          flushCjk(buf, tokens);
          buf = '';
        }
      }
    }
    if (buf) flushCjk(buf, tokens);
    return tokens;
  }

  function flushCjk(buffer, tokens) {
    if (buffer.length === 1) {
      tokens.push(buffer);
      return;
    }
    for (var i = 0; i < buffer.length - 1; i++) {
      tokens.push(buffer.substring(i, i + 2));
    }
  }

  // Lazy-load lunr.js and search index
  function initSearch(callback) {
    if (searchIndex) {
      callback();
      return;
    }
    pendingCallbacks.push(callback);
    if (isLoading) return;
    isLoading = true;

    // Load lunr.js from CDN
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/lunr@2.3.9/lunr.min.js';
    script.onload = function() {
      fetch('/search.json')
        .then(function(res) { return res.json(); })
        .then(function(data) {
          documents = data;

          // Pre-process documents: convert text to bigram-tokenized strings
          var processedDocs = data.map(function(doc) {
            return {
              url: doc.url,
              title: bigramTokenize(doc.title || '').join(' '),
              category: bigramTokenize(doc.category || '').join(' '),
              content: bigramTokenize((doc.content || '').substring(0, 3000)).join(' ')
            };
          });

          searchIndex = lunr(function() {
            this.ref('url');
            this.field('title', { boost: 10 });
            this.field('category', { boost: 5 });
            this.field('content');

            // Reset pipelines completely — default processors break CJK tokens
            this.pipeline.reset();
            this.searchPipeline.reset();

            processedDocs.forEach(function(doc) {
              this.add(doc);
            }, this);
          });

          isLoading = false;
          pendingCallbacks.forEach(function(cb) { cb(); });
          pendingCallbacks = [];
        })
        .catch(function(err) {
          console.error('Search: failed to load index:', err);
          isLoading = false;
          pendingCallbacks = [];
        });
    };
    script.onerror = function() {
      console.error('Search: failed to load lunr.js');
      isLoading = false;
      pendingCallbacks = [];
    };
    document.head.appendChild(script);
  }

  // Execute search
  function doSearch(query) {
    if (!searchIndex || !query.trim()) {
      resultsList.innerHTML = '';
      emptyEl.classList.remove('visible');
      hintEl.classList.remove('hidden');
      activeIndex = -1;
      return;
    }

    hintEl.classList.add('hidden');

    // Tokenize query with bigram and search using query API
    var queryTokens = bigramTokenize(query);
    var results;
    if (queryTokens.length === 0) {
      results = [];
    } else {
      results = searchIndex.query(function(q) {
        queryTokens.forEach(function(token) {
          q.term(token);
        });
      });
    }

    var lang = getCurrentLang();

    // Filter by current language
    var filtered = results.filter(function(r) {
      var doc = documents.find(function(d) { return d.url === r.ref; });
      return doc && doc.lang === lang;
    }).slice(0, 10);

    if (filtered.length === 0) {
      resultsList.innerHTML = '';
      emptyEl.classList.add('visible');
      activeIndex = -1;
      return;
    }

    emptyEl.classList.remove('visible');
    activeIndex = -1;
    renderResults(filtered);
  }

  // Get category CSS class
  function getCategoryClass(category) {
    if (!category) return 'cat-other';
    if (category.indexOf('frontend') === 0) return 'cat-frontend';
    if (category.indexOf('backend') === 0) return 'cat-backend';
    if (category.indexOf('jvm') === 0) return 'cat-jvm';
    if (category.indexOf('devops') === 0) return 'cat-devops';
    return 'cat-other';
  }

  // Get category display name
  function getCategoryName(category, lang) {
    if (!category) return '';
    var top = category.split('-')[0];
    if (lang === 'en') {
      return { frontend: 'Frontend', backend: 'Backend', jvm: 'JVM', devops: 'DevOps' }[top] || category;
    }
    return { frontend: '前端', backend: '后端', jvm: 'JVM', devops: 'DevOps' }[top] || category;
  }

  // Render results
  function renderResults(results) {
    var lang = getCurrentLang();
    var html = '';

    results.forEach(function(r, i) {
      var doc = documents.find(function(d) { return d.url === r.ref; });
      if (!doc) return;

      var catClass = getCategoryClass(doc.category);
      var catName = getCategoryName(doc.category, lang);

      html += '<li class="gh-search-result" data-url="' + doc.url + '">';
      html += '<a href="' + doc.url + '" data-index="' + i + '">';
      html += '<span class="gh-search-result-title">' + escapeHtml(doc.title) + '</span>';
      html += '<span class="gh-search-result-meta">';
      if (catName) {
        html += '<span class="gh-search-result-category ' + catClass + '">' + escapeHtml(catName) + '</span>';
      }
      html += '<span class="gh-search-result-url">' + escapeHtml(doc.url) + '</span>';
      html += '</span>';
      html += '</a>';
      html += '</li>';
    });

    resultsList.innerHTML = html;
    bindResultClicks();
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Click handler for results
  function bindResultClicks() {
    var links = resultsList.querySelectorAll('a');
    links.forEach(function(link) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        var url = this.getAttribute('href') || this.closest('.gh-search-result').getAttribute('data-url');
        closeSearch();
        window.location.href = url;
      });
    });
  }

  // Keyboard navigation
  function navigateResults(direction) {
    var items = resultsList.querySelectorAll('.gh-search-result a');
    if (items.length === 0) return;

    if (activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].classList.remove('active');
    }

    activeIndex += direction;
    if (activeIndex < 0) activeIndex = items.length - 1;
    if (activeIndex >= items.length) activeIndex = 0;

    items[activeIndex].classList.add('active');
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  function openActiveResult() {
    var items = resultsList.querySelectorAll('.gh-search-result a');
    if (activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].click();
    }
  }

  // Open/close search
  function openSearch() {
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    input.focus();
    initSearch(function() {});
  }

  function closeSearch() {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    input.value = '';
    resultsList.innerHTML = '';
    emptyEl.classList.remove('visible');
    hintEl.classList.remove('hidden');
    activeIndex = -1;
  }

  // Event: search button
  var searchBtn = document.getElementById('gh-search-btn');
  if (searchBtn) {
    searchBtn.addEventListener('click', function(e) {
      e.preventDefault();
      openSearch();
    });
  }

  // Event: Cmd/Ctrl+K
  document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (overlay.classList.contains('active')) {
        closeSearch();
      } else {
        openSearch();
      }
    }
  });

  // Event: keyboard in modal
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeSearch();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateResults(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateResults(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openActiveResult();
    }
  });

  // Event: input with debounce
  var debounceTimer = null;
  input.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    var query = this.value.trim();
    debounceTimer = setTimeout(function() {
      if (!searchIndex) {
        initSearch(function() { doSearch(query); });
      } else {
        doSearch(query);
      }
    }, 200);
  });

  // Event: click overlay to close
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) {
      closeSearch();
    }
  });

  // Event: ESC on overlay
  overlay.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeSearch();
    }
  });
})();
