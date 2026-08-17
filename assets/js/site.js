(function() {
  var root = document.documentElement;
  var themeTransitionFrame = null;

  function setThemeOverride(value) {
    try {
      window.sessionStorage.setItem('theme-override', value);
    } catch (error) {
      // Ignore storage failures and keep the in-memory theme.
    }
  }

  function applyTheme(dark, animate) {
    if (animate) {
      if (themeTransitionFrame !== null) {
        window.cancelAnimationFrame(themeTransitionFrame);
      }
      root.classList.add('theme-switching');
    }

    root.classList.toggle('dark', dark);

    var icon = document.getElementById('global-toggle-icon');
    var label = document.getElementById('global-toggle-label');
    if (icon) {
      icon.textContent = dark ? '☀️' : '🌙';
    }
    if (label) {
      label.textContent = dark ? 'Day' : 'Night';
    }

    if (animate) {
      themeTransitionFrame = window.requestAnimationFrame(function() {
        themeTransitionFrame = window.requestAnimationFrame(function() {
          root.classList.remove('theme-switching');
          themeTransitionFrame = null;
        });
      });
    }

    document.dispatchEvent(new CustomEvent('site:themechange', { detail: { dark: dark } }));
  }

  function initReadingProgress() {
    var article = document.querySelector('.post-content');
    if (!article) {
      return;
    }

    var progressTrack = document.createElement('div');
    progressTrack.className = 'reading-progress';
    progressTrack.setAttribute('aria-hidden', 'true');

    var progressBar = document.createElement('div');
    progressBar.className = 'reading-progress__bar';
    progressTrack.appendChild(progressBar);
    root.appendChild(progressTrack);

    function updateReadingProgress() {
      // Distance the article's top has travelled above the viewport, over how
      // far it can travel. Articles shorter than the viewport snap to 0 or 1.
      var top = article.getBoundingClientRect().top;
      var scrollable = article.offsetHeight - window.innerHeight;
      var progress = scrollable > 0 ? -top / scrollable : (top <= 0 ? 1 : 0);

      progressBar.style.transform = 'scaleX(' + Math.min(1, Math.max(0, progress)) + ')';
    }

    window.addEventListener('scroll', updateReadingProgress, { passive: true });
    window.addEventListener('resize', updateReadingProgress, { passive: true });
    updateReadingProgress();
  }

  function initThemeToggle() {
    var btn = document.createElement('button');
    btn.className = 'global-theme-toggle';
    btn.id = 'global-theme-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle dark mode');
    btn.innerHTML = '<span class="toggle-icon" id="global-toggle-icon"></span><span id="global-toggle-label"></span>';
    root.appendChild(btn);

    // head.html already resolved override-vs-time-of-day before first paint;
    // read that decision back instead of duplicating the rule here.
    applyTheme(root.classList.contains('dark'), false);

    btn.addEventListener('click', function() {
      var newDark = !root.classList.contains('dark');
      setThemeOverride(newDark ? 'dark' : 'light');
      applyTheme(newDark, true);
    });
  }

  function initHeadingAnchors() {
    document.querySelectorAll('.post-content :is(h2, h3, h4, h5, h6)[id]').forEach(function(heading) {
      if (heading.querySelector('.heading-anchor')) {
        return;
      }

      var headingText = heading.textContent ? heading.textContent.trim() : 'section';
      var anchor = document.createElement('a');
      anchor.className = 'heading-anchor';
      anchor.href = '#' + heading.id;
      anchor.setAttribute('aria-label', 'Link to ' + headingText);
      anchor.textContent = '#';
      heading.appendChild(anchor);
    });
  }

  function initThemeMedia() {
    function syncThemeMedia() {
      var dark = root.classList.contains('dark');

      document.querySelectorAll('img[data-light-src][data-dark-src]').forEach(function(image) {
        var nextSrc = dark ? image.dataset.darkSrc : image.dataset.lightSrc;
        if (image.getAttribute('src') !== nextSrc) {
          image.setAttribute('src', nextSrc);
        }
      });
    }

    syncThemeMedia();
    document.addEventListener('site:themechange', syncThemeMedia);
  }

  function boot() {
    initReadingProgress();
    initThemeToggle();
    initHeadingAnchors();
    initThemeMedia();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
