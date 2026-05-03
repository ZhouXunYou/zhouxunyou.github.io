(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var content = document.querySelector('.markdown-body');
    if (!content) return;

    var headings = content.querySelectorAll('h2, h3');
    if (headings.length < 3) return; // Don't show TOC for short content

    // Add IDs to headings that don't have them
    headings.forEach(function(heading, index) {
      if (!heading.id) {
        heading.id = 'heading-' + (index + 1);
      }
    });

    var toc = document.createElement('nav');
    toc.className = 'gh-toc';
    toc.setAttribute('aria-label', 'Table of contents');

    var title = document.createElement('h3');
    title.className = 'gh-toc-title';
    title.textContent = document.documentElement.lang === 'en' ? 'On this page' : '本页目录';
    toc.appendChild(title);

    var list = document.createElement('ul');
    list.className = 'gh-toc-list';

    headings.forEach(function(heading) {
      var item = document.createElement('li');
      item.className = 'gh-toc-item gh-toc-' + heading.tagName.toLowerCase();
      var link = document.createElement('a');
      link.href = '#' + heading.id;
      link.textContent = heading.textContent;
      link.className = 'gh-toc-link';
      item.appendChild(link);
      list.appendChild(item);
    });

    toc.appendChild(list);
    content.parentNode.insertBefore(toc, content);
  });
})();
