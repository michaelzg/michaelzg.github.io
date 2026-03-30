(function() {
  var configEl = document.getElementById('life-in-weeks-config');
  var gridEl = document.getElementById('grid');

  if (!configEl || !gridEl) {
    return;
  }

  var CONFIG;
  try {
    CONFIG = JSON.parse(configEl.textContent);
  } catch (error) {
    return;
  }

  var birthParts = CONFIG.birthday.split('-');
  var BIRTH = new Date(parseInt(birthParts[0], 10), parseInt(birthParts[1], 10) - 1, parseInt(birthParts[2], 10));
  var LIFESPAN = CONFIG.lifespan_years;
  var MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  var WEEKS_PER_YEAR = 52;
  var NOW = new Date();

  var DECADES = CONFIG.decades;
  var EVENTS = CONFIG.events;
  var MAX_BOXES_IN_ROW = 21;
  var BOX_END_MULT = 0.45;
  var BOX_CHAR_MULT = 0.319;

  function parseDate(value) {
    var parts = value.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  var eventsByWeek = {};
  EVENTS.forEach(function(eventItem) {
    var eventDate = parseDate(eventItem.date);
    var weekIdx = Math.floor((eventDate - BIRTH) / MS_PER_WEEK);
    if (!eventsByWeek[weekIdx]) {
      eventsByWeek[weekIdx] = [];
    }
    eventsByWeek[weekIdx].push(eventItem);
  });

  for (var age = 1; age < LIFESPAN; age += 1) {
    var birthdayDate = new Date(BIRTH.getFullYear() + age, BIRTH.getMonth(), BIRTH.getDate());
    var birthdayWeekIdx = Math.floor((birthdayDate - BIRTH) / MS_PER_WEEK);
    var birthdayEvent = {
      label: '\uD83C\uDF82 ' + age + ' in ' + (BIRTH.getFullYear() + age),
      description: 'Turned ' + age + ' year' + (age !== 1 ? 's' : '') + ' old',
      isBirthday: true
    };

    if (!eventsByWeek[birthdayWeekIdx]) {
      eventsByWeek[birthdayWeekIdx] = [];
    }
    eventsByWeek[birthdayWeekIdx].unshift(birthdayEvent);
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function formatDate(date) {
    return MONTHS[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
  }

  function visualLength(str) {
    if (!str) {
      return 0;
    }

    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      var segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
      return Array.from(segmenter.segment(str)).reduce(function(length, segment) {
        return length + (segment.segment.length > 1 ? 2 : 1);
      }, 0);
    }

    return str.length;
  }

  function boxUnits(label) {
    if (!label) {
      return 1;
    }
    return 2 * BOX_END_MULT + visualLength(label) * BOX_CHAR_MULT;
  }

  var currentDecade = -1;
  var decadeDiv = null;
  var currentRow = null;
  var rowUnits = 0;
  var eventsByDecade = {};

  function createRow() {
    currentRow = document.createElement('div');
    currentRow.className = 'liw-flex-row';
    decadeDiv.appendChild(currentRow);
    rowUnits = 0;
  }

  function ensureRowSpace(units) {
    if (rowUnits > 0 && rowUnits + units >= MAX_BOXES_IN_ROW) {
      createRow();
    }
  }

  function collapsedCardText(isExpanded) {
    return isExpanded ? 'Hide details <span class="liw-expand-arrow">\u2191</span>' : 'Show 520 weeks <span class="liw-expand-arrow">\u2193</span>';
  }

  function createCollapsedCard(decade, events, decadeColors) {
    var wrapper = document.createElement('div');
    var decadeId = 'liw-decade-' + decade;
    var decadeInfo = DECADES[decade] || {};
    var decadeLabel = decadeInfo.label || ('Decade ' + (decade * 10));
    var decadeStartYear = BIRTH.getFullYear() + decade * 10;
    var decadeEndYear = decadeStartYear + 10;

    wrapper.className = 'liw-decade-wrapper';
    wrapper.setAttribute('data-collapsed', 'true');
    wrapper.setAttribute('data-decade', String(decade));

    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'liw-decade-collapsed';
    card.style.background = decadeColors.fill;
    card.style.borderColor = decadeColors.border;
    card.setAttribute('aria-expanded', 'false');
    card.setAttribute('aria-controls', decadeId);

    var header = document.createElement('span');
    header.className = 'liw-collapsed-header';

    var title = document.createElement('span');
    title.className = 'liw-collapsed-title';
    title.textContent = decadeLabel + ' (' + decadeStartYear + '-' + decadeEndYear + ')';

    var stats = document.createElement('span');
    stats.className = 'liw-collapsed-stats';
    var eventCount = events.filter(function(eventItem) {
      return !eventItem.isBirthday;
    }).length;
    stats.textContent = eventCount + ' events \u00B7 10 years';

    header.appendChild(title);
    header.appendChild(stats);

    var eventPreview = document.createElement('span');
    eventPreview.className = 'liw-collapsed-events';
    events.slice(0, 4).forEach(function(eventItem) {
      var emoji = eventItem.label.match(/[\p{Emoji}]/gu);
      if (emoji && emoji[0]) {
        var emojiSpan = document.createElement('span');
        emojiSpan.textContent = emoji[0];
        emojiSpan.title = eventItem.label;
        eventPreview.appendChild(emojiSpan);
      }
    });

    var expandLabel = document.createElement('span');
    expandLabel.className = 'liw-expand-btn';
    expandLabel.innerHTML = collapsedCardText(false);

    card.appendChild(header);
    if (eventPreview.childNodes.length > 0) {
      card.appendChild(eventPreview);
    }
    card.appendChild(expandLabel);

    card.addEventListener('click', function() {
      toggleDecade(wrapper);
    });

    wrapper.appendChild(card);
    wrapper.dataset.controls = decadeId;
    return wrapper;
  }

  function toggleDecade(wrapper) {
    var isCollapsed = wrapper.getAttribute('data-collapsed') === 'true';
    var nextCollapsed = !isCollapsed;

    wrapper.setAttribute('data-collapsed', nextCollapsed ? 'true' : 'false');

    var toggleButton = wrapper.querySelector('.liw-decade-collapsed');
    var expandLabel = wrapper.querySelector('.liw-expand-btn');

    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', isCollapsed ? 'true' : 'false');
    }

    if (expandLabel) {
      expandLabel.innerHTML = collapsedCardText(isCollapsed);
    }

    if (isCollapsed) {
      setTimeout(function() {
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }

  var totalWeeks = LIFESPAN * WEEKS_PER_YEAR;
  var currentWeekIdx = Math.floor((NOW - BIRTH) / MS_PER_WEEK);
  var nowBox = null;

  for (var week = 0; week < totalWeeks; week += 1) {
    var decadeIndex = Math.floor(Math.floor(week / WEEKS_PER_YEAR) / 10);
    if (!eventsByDecade[decadeIndex]) {
      eventsByDecade[decadeIndex] = [];
    }

    var weekEvents = eventsByWeek[week];
    if (weekEvents) {
      weekEvents.forEach(function(eventItem) {
        if (!eventItem.isBirthday || eventsByDecade[decadeIndex].length === 0) {
          var alreadyPresent = eventsByDecade[decadeIndex].some(function(existingEvent) {
            return existingEvent.label === eventItem.label;
          });
          if (!alreadyPresent) {
            eventsByDecade[decadeIndex].push(eventItem);
          }
        }
      });
    }
  }

  for (var weekIdx = 0; weekIdx < totalWeeks; weekIdx += 1) {
    var yearOfLife = Math.floor(weekIdx / WEEKS_PER_YEAR);
    var decade = Math.floor(yearOfLife / 10);
    var weekStart = new Date(BIRTH.getTime() + weekIdx * MS_PER_WEEK);
    var isFuture = weekStart > NOW;
    var isNow = weekIdx === currentWeekIdx;

    if (decade !== currentDecade) {
      currentDecade = decade;
      var decadeColors = DECADES[decade] || DECADES[DECADES.length - 1];
      var currentDecadeWrapper = null;

      if (decade === 0) {
        currentDecadeWrapper = createCollapsedCard(decade, eventsByDecade[decade] || [], decadeColors);
        gridEl.appendChild(currentDecadeWrapper);
        decadeDiv = document.createElement('div');
        decadeDiv.className = 'liw-decade';
        decadeDiv.id = currentDecadeWrapper.dataset.controls;
        currentDecadeWrapper.appendChild(decadeDiv);
      } else {
        decadeDiv = document.createElement('div');
        decadeDiv.className = 'liw-decade';
        gridEl.appendChild(decadeDiv);
      }

      createRow();
    }

    var eventsThisWeek = eventsByWeek[weekIdx];
    var palette = DECADES[decade] || DECADES[DECADES.length - 1];
    var boxLabel = '';

    if (eventsThisWeek) {
      boxLabel = eventsThisWeek.map(function(eventItem) {
        return eventItem.label;
      }).join(' \u00B7 ');
    }

    var units = boxUnits(boxLabel);
    ensureRowSpace(units);

    var box = document.createElement('button');
    box.type = 'button';
    box.className = 'liw-box' + (isFuture ? ' liw-future' : '') + (boxLabel ? ' liw-has-label' : '') + (isNow ? ' liw-now' : '');
    box.style.borderColor = palette.border;
    if (!isFuture) {
      box.style.backgroundColor = palette.fill;
    }

    if (isNow) {
      nowBox = box;
    }

    if (boxLabel) {
      box.textContent = boxLabel;
    }

    var tip = document.createElement('span');
    tip.className = 'liw-tip';

    var dateDiv = document.createElement('div');
    dateDiv.className = 'liw-tip-date';
    dateDiv.textContent = formatDate(weekStart);
    tip.appendChild(dateDiv);

    if (eventsThisWeek) {
      var labels = eventsThisWeek.map(function(eventItem) {
        return eventItem.label;
      });
      var labelDiv = document.createElement('div');
      labelDiv.className = 'liw-tip-label';
      labelDiv.textContent = labels.join(' \u00B7 ');
      tip.appendChild(labelDiv);

      var descriptions = eventsThisWeek.filter(function(eventItem) {
        return eventItem.description;
      });
      if (descriptions.length > 0) {
        var descriptionDiv = document.createElement('div');
        descriptionDiv.className = 'liw-tip-desc';
        descriptionDiv.textContent = descriptions.map(function(eventItem) {
          return eventItem.description;
        }).join(' \u00B7 ');
        tip.appendChild(descriptionDiv);
      }
    } else {
      var ageForWeek = weekStart.getFullYear() - BIRTH.getFullYear();
      if (
        weekStart.getMonth() < BIRTH.getMonth() ||
        (weekStart.getMonth() === BIRTH.getMonth() && weekStart.getDate() < BIRTH.getDate())
      ) {
        ageForWeek -= 1;
      }

      var ageDiv = document.createElement('div');
      ageDiv.className = 'liw-tip-label';
      ageDiv.textContent = 'Age ' + ageForWeek;
      tip.appendChild(ageDiv);
    }

    if (isNow) {
      var nowDiv = document.createElement('div');
      nowDiv.className = 'liw-tip-label';
      nowDiv.style.fontWeight = 'bold';
      nowDiv.textContent = '\u2190 You are here';
      tip.appendChild(nowDiv);
    }

    box.appendChild(tip);
    currentRow.appendChild(box);
    rowUnits += units;

    if (rowUnits >= MAX_BOXES_IN_ROW) {
      createRow();
    }
  }

  var legend = document.querySelector('.liw-legend');
  if (legend) {
    var legendTop = legend.offsetTop;
    window.addEventListener('scroll', function() {
      if (window.scrollY > legendTop) {
        legend.classList.add('liw-legend-sticky');
      } else {
        legend.classList.remove('liw-legend-sticky');
      }
    }, { passive: true });
  }

  var goNowButton = document.getElementById('go-now');
  if (goNowButton) {
    goNowButton.addEventListener('click', function() {
      if (!nowBox) {
        return;
      }

      var currentAge = Math.floor((NOW - BIRTH) / (365.25 * 24 * 60 * 60 * 1000));
      var currentDecadeIdx = Math.floor(currentAge / 10);

      if (currentDecadeIdx === 0) {
        var childhoodWrapper = document.querySelector('.liw-decade-wrapper[data-decade="0"]');
        if (childhoodWrapper && childhoodWrapper.getAttribute('data-collapsed') === 'true') {
          toggleDecade(childhoodWrapper);
        }
      }

      setTimeout(function() {
        nowBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        nowBox.style.transition = 'box-shadow 0.3s ease';

        var accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#D2691E';
        var accentRgb = document.documentElement.classList.contains('dark') ? '232, 133, 58' : '210, 105, 30';

        setTimeout(function() {
          nowBox.style.boxShadow = '0 0 0 4px ' + accent + ', 0 0 20px rgba(' + accentRgb + ', 0.6)';
          setTimeout(function() {
            nowBox.style.boxShadow = '0 0 0 2px ' + accent + ', 0 0 12px rgba(' + accentRgb + ', 0.4)';
          }, 600);
        }, 500);
      }, currentDecadeIdx === 0 ? 500 : 0);
    });
  }
})();
