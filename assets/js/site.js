(function() {
  var DARK_START = 18;
  var DARK_END = 7;
  var themeTransitionFrame = null;

  function getThemeOverride() {
    try {
      return window.sessionStorage.getItem('theme-override');
    } catch (error) {
      return null;
    }
  }

  function setThemeOverride(value) {
    try {
      window.sessionStorage.setItem('theme-override', value);
    } catch (error) {
      // Ignore storage failures and keep the in-memory theme.
    }
  }

  function isDarkHour() {
    var hour = new Date().getHours();
    return hour >= DARK_START || hour < DARK_END;
  }

  function shouldUseDarkTheme() {
    var override = getThemeOverride();
    return override === 'dark' || (!override && isDarkHour());
  }

  function dispatchThemeChange() {
    document.dispatchEvent(new CustomEvent('site:themechange', {
      detail: { dark: document.documentElement.classList.contains('dark') }
    }));
  }

  function applyTheme(dark, animate) {
    if (animate) {
      if (themeTransitionFrame !== null) {
        window.cancelAnimationFrame(themeTransitionFrame);
      }
      document.documentElement.classList.add('theme-switching');
    }

    document.documentElement.classList.toggle('dark', dark);

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
          document.documentElement.classList.remove('theme-switching');
          themeTransitionFrame = null;
        });
      });
    }

    dispatchThemeChange();
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
    document.documentElement.appendChild(progressTrack);

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function updateReadingProgress() {
      var articleTop = article.getBoundingClientRect().top + window.scrollY;
      var articleBottom = articleTop + article.offsetHeight;
      var maxScrollable = articleBottom - window.innerHeight;
      var progress = 0;

      if (maxScrollable <= articleTop) {
        progress = window.scrollY >= articleTop ? 1 : 0;
      } else {
        progress = (window.scrollY - articleTop) / (maxScrollable - articleTop);
      }

      progressBar.style.transform = 'scaleX(' + clamp(progress, 0, 1) + ')';
    }

    window.addEventListener('scroll', updateReadingProgress, { passive: true });
    window.addEventListener('resize', updateReadingProgress);
    updateReadingProgress();
  }

  function initThemeToggle() {
    var btn = document.createElement('button');
    btn.className = 'global-theme-toggle';
    btn.id = 'global-theme-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle dark mode');
    btn.innerHTML = '<span class="toggle-icon" id="global-toggle-icon"></span><span id="global-toggle-label"></span>';
    document.documentElement.appendChild(btn);

    applyTheme(shouldUseDarkTheme(), false);

    btn.addEventListener('click', function() {
      var newDark = !document.documentElement.classList.contains('dark');
      setThemeOverride(newDark ? 'dark' : 'light');
      applyTheme(newDark, true);
    });
  }

  function initHeadingAnchors() {
    var headings = document.querySelectorAll('.post-content h2[id], .post-content h3[id], .post-content h4[id], .post-content h5[id], .post-content h6[id]');

    headings.forEach(function(heading) {
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
      var dark = document.documentElement.classList.contains('dark');
      var images = document.querySelectorAll('img[data-light-src][data-dark-src]');

      images.forEach(function(image) {
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
