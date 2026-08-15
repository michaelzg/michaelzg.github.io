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
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  var DECADES = CONFIG.decades;
  var EVENTS = CONFIG.events;
  var MAX_BOXES_IN_ROW = 21;
  var CALLOUT_MIN_SPAN = 2;
  var CALLOUT_MAX_SPAN = 5;
  var CALLOUT_LINE_CAPACITY = { 2: 11, 3: 18 };
  var WEEKS_PER_DECADE = WEEKS_PER_YEAR * 10;
  var totalWeeks = LIFESPAN * WEEKS_PER_YEAR;
  var totalDecades = Math.ceil(totalWeeks / WEEKS_PER_DECADE);
  var emojiPattern = /(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/gu;
  var currentWeekIdx = Math.floor((NOW - BIRTH) / MS_PER_WEEK);
  var defaultExpandedDecade = Math.max(0, Math.min(
    totalDecades - 1,
    Math.floor(Math.floor(currentWeekIdx / WEEKS_PER_YEAR) / 10)
  ));

  var legend = document.querySelector('.liw-legend');
  var legendContext = document.getElementById('liw-legend-context');
  var activeContextDecade = -1;
  var legendContextFrame = null;
  var legendContextNeedsPosition = false;
  var legendContextPositionFrame = null;

  function parseDate(value) {
    var parts = value.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  var eventsByWeek = {};
  EVENTS.forEach(function(eventItem) {
    var eventDate = parseDate(eventItem.date);
    eventItem.eventDate = eventDate;
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
      isBirthday: true,
      eventDate: birthdayDate
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

  function calloutText(eventsThisWeek) {
    if (!eventsThisWeek) {
      return '';
    }

    return eventsThisWeek.filter(function(eventItem) {
      return !eventItem.isBirthday;
    }).map(function(eventItem) {
      return eventItem.label.replace(emojiPattern, '').replace(/\s+/g, ' ').trim();
    }).filter(Boolean).join(' \u00B7 ');
  }

  function calloutSpan(text) {
    var characterCount = Array.from(text).length;
    return Math.max(CALLOUT_MIN_SPAN, Math.min(
      CALLOUT_MAX_SPAN,
      Math.ceil((characterCount + 4) / 7)
    ));
  }

  function estimatedCalloutLines(text, capacity) {
    var lineLength = 0;
    var lines = 1;

    text.split(/\s+/).forEach(function(word) {
      var wordLength = Array.from(word).length;
      if (wordLength > capacity) {
        if (lineLength > 0) {
          lines += 1;
        }
        lines += Math.floor((wordLength - 1) / capacity);
        lineLength = wordLength % capacity || capacity;
        return;
      }
      if (lineLength === 0) {
        lineLength = wordLength;
      } else if (lineLength + wordLength + 1 <= capacity) {
        lineLength += wordLength + 1;
      } else {
        lines += 1;
        lineLength = wordLength;
      }
    });

    return lines;
  }

  function stackedCalloutShape(text) {
    if (estimatedCalloutLines(text, CALLOUT_LINE_CAPACITY[2]) <= 2) {
      return { rows: 2, span: 2 };
    }
    if (estimatedCalloutLines(text, CALLOUT_LINE_CAPACITY[3]) <= 2) {
      return { rows: 2, span: 3 };
    }
    if (estimatedCalloutLines(text, CALLOUT_LINE_CAPACITY[3]) <= 3) {
      return { rows: 3, span: 3 };
    }
    return null;
  }

  function verticalCalloutShape(text) {
    var rows = estimatedCalloutLines(text, CALLOUT_LINE_CAPACITY[3]);
    return rows <= 3 ? { rows: rows, span: 3 } : null;
  }

  function calloutFootprint(candidate, option, rowBoxesByRow) {
    var rowIndexes = [];
    var columnIndexes = [];
    var footprint = [];

    if (option.orientation === 'vertical') {
      var cardinalStep = option.direction === 'below' ? 1 : -1;
      for (var cardinalOffset = 1; cardinalOffset <= option.rows; cardinalOffset += 1) {
        rowIndexes.push(candidate.rowIndex + cardinalStep * cardinalOffset);
      }
      for (var centeredOffset = -1; centeredOffset <= 1; centeredOffset += 1) {
        columnIndexes.push(candidate.column + centeredOffset);
      }
    } else {
      var horizontalStep = option.direction === 'right' ? 1 : -1;
      rowIndexes.push(candidate.rowIndex);
      for (var columnOffset = 1; columnOffset <= option.span; columnOffset += 1) {
        columnIndexes.push(candidate.column + horizontalStep * columnOffset);
      }

      if (option.rows > 1) {
        if (option.vertical === 'center') {
          rowIndexes.push(candidate.rowIndex - 1, candidate.rowIndex + 1);
        } else {
          var verticalStep = option.vertical === 'down' ? 1 : -1;
          for (var verticalOffset = 1; verticalOffset < option.rows; verticalOffset += 1) {
            rowIndexes.push(candidate.rowIndex + verticalStep * verticalOffset);
          }
        }
      }
    }

    for (var rowOffset = 0; rowOffset < rowIndexes.length; rowOffset += 1) {
      var rowIndex = rowIndexes[rowOffset];
      var rowBoxes = rowBoxesByRow[rowIndex];
      if (!rowBoxes) {
        return [];
      }

      for (var columnIndex = 0; columnIndex < columnIndexes.length; columnIndex += 1) {
        var column = columnIndexes[columnIndex];
        if (!rowBoxes[column]) {
          return [];
        }
        footprint.push({
          box: rowBoxes[column],
          column: column,
          rowIndex: rowIndex
        });
      }
    }

    return footprint;
  }

  function calloutLayouts(candidate, reserved, rowBoxesByRow) {
    var variants = [];
    var layouts = [];

    function addLayout(option) {
      option.footprint = calloutFootprint(candidate, option, rowBoxesByRow);

      var isAvailable = option.footprint.length === option.rows * option.span && option.footprint.every(function(cell) {
        return (
          !reserved[cell.rowIndex][cell.column] &&
          cell.box.isFuture === candidate.box.isFuture
        );
      });

      if (isAvailable) {
        layouts.push(option);
      }
    }

    if (candidate.wideFits) {
      variants.push({ rows: 1, span: candidate.wideSpan, vertical: 'center' });
    }

    if (candidate.wideSpan >= 3 && candidate.stackedShape) {
      variants.push({ rows: candidate.stackedShape.rows, span: candidate.stackedShape.span, vertical: 'up' });
      variants.push({ rows: candidate.stackedShape.rows, span: candidate.stackedShape.span, vertical: 'down' });
      if (candidate.stackedShape.rows === 3) {
        variants.push({ rows: 3, span: candidate.stackedShape.span, vertical: 'center' });
      }
    }

    variants.forEach(function(variant) {
      ['left', 'right'].forEach(function(direction) {
        addLayout({
          orientation: 'side',
          direction: direction,
          rows: variant.rows,
          span: variant.span,
          vertical: variant.vertical
        });
      });
    });

    if (candidate.verticalShape) {
      ['above', 'below'].forEach(function(direction) {
        addLayout({
          orientation: 'vertical',
          direction: direction,
          rows: candidate.verticalShape.rows,
          span: candidate.verticalShape.span,
          vertical: direction
        });
      });
    }

    return layouts;
  }

  function appendCallout(candidate, option) {
    var callout = document.createElement('span');
    var label = document.createElement('span');

    callout.className = 'liw-callout liw-callout-' + option.direction;
    callout.setAttribute('aria-hidden', 'true');
    callout.setAttribute('data-rows', String(option.rows));
    callout.setAttribute('data-span', String(option.span));
    callout.setAttribute('data-vertical', option.vertical);

    label.className = 'liw-callout-label';
    label.textContent = candidate.text;
    callout.appendChild(label);

    candidate.box.element.classList.add('liw-callout-anchor');
    candidate.box.element.style.setProperty('--liw-callout-fill', candidate.palette.fill);
    candidate.box.element.style.setProperty('--liw-callout-border', candidate.palette.border);
    candidate.box.element.insertBefore(callout, candidate.box.element.querySelector('.liw-tip'));
  }

  function placeDecadeCallouts(rowBoxesByRow, palette) {
    var reserved = rowBoxesByRow.map(function(rowBoxes) {
      return rowBoxes.map(function(box) {
        return box.hasEvents || box.isNow;
      });
    });
    var candidates = [];

    rowBoxesByRow.forEach(function(rowBoxes, rowIndex) {
      rowBoxes.forEach(function(box, column) {
        var text = !box.isNow ? calloutText(box.eventsThisWeek) : '';
        if (!text) {
          return;
        }

        var candidate = {
          box: box,
          column: column,
          palette: palette,
          rowIndex: rowIndex,
          stackedShape: stackedCalloutShape(text),
          text: text,
          verticalShape: verticalCalloutShape(text),
          wideSpan: calloutSpan(text)
        };
        candidate.wideFits = Array.from(text).length <= candidate.wideSpan * 7 - 2;
        candidate.prefersStacked = candidate.wideSpan >= 4;
        candidate.initialLayouts = calloutLayouts(candidate, reserved, rowBoxesByRow);
        if (candidate.initialLayouts.length > 0) {
          candidates.push(candidate);
        }
      });
    });

    candidates.sort(function(first, second) {
      if (first.prefersStacked !== second.prefersStacked) {
        return first.prefersStacked ? -1 : 1;
      }
      if (first.initialLayouts.length !== second.initialLayouts.length) {
        return first.initialLayouts.length - second.initialLayouts.length;
      }
      if (first.wideSpan !== second.wideSpan) {
        return second.wideSpan - first.wideSpan;
      }
      if (first.rowIndex !== second.rowIndex) {
        return first.rowIndex - second.rowIndex;
      }
      return first.column - second.column;
    });

    candidates.forEach(function(candidate) {
      var layouts = calloutLayouts(candidate, reserved, rowBoxesByRow);
      if (layouts.length === 0) {
        return;
      }

      var preferredDirection = candidate.column < rowBoxesByRow[candidate.rowIndex].length / 2 ? 'right' : 'left';
      var preferredVertical = candidate.rowIndex < rowBoxesByRow.length / 2 ? 'down' : 'up';
      var preferredCardinal = candidate.rowIndex < rowBoxesByRow.length / 2 ? 'below' : 'above';
      layouts.sort(function(first, second) {
        var firstLayoutRank = (first.rows > 1) === candidate.prefersStacked ? 0 : 1;
        var secondLayoutRank = (second.rows > 1) === candidate.prefersStacked ? 0 : 1;
        if (firstLayoutRank !== secondLayoutRank) {
          return firstLayoutRank - secondLayoutRank;
        }
        if (first.rows * first.span !== second.rows * second.span) {
          return first.rows * first.span - second.rows * second.span;
        }
        if (first.orientation !== second.orientation) {
          return first.orientation === 'side' ? -1 : 1;
        }
        if (first.direction !== second.direction) {
          var preferred = first.orientation === 'side' ? preferredDirection : preferredCardinal;
          return first.direction === preferred ? -1 : 1;
        }
        if (first.orientation === 'side' && first.vertical !== second.vertical) {
          var firstVerticalRank = first.vertical === 'center' || first.vertical === preferredVertical ? 0 : 1;
          var secondVerticalRank = second.vertical === 'center' || second.vertical === preferredVertical ? 0 : 1;
          return firstVerticalRank - secondVerticalRank;
        }
        return 0;
      });

      var chosen = layouts[0];
      chosen.footprint.forEach(function(cell) {
        reserved[cell.rowIndex][cell.column] = true;
      });
      appendCallout(candidate, chosen);
    });
  }

  var eventsByDecade = {};
  var nowBox = null;

  function collapsedCardText(isExpanded) {
    return isExpanded ? 'Collapse <span class="liw-expand-arrow">\u2191</span>' : 'Expand <span class="liw-expand-arrow">\u2193</span>';
  }

  function createCollapsedCard(decade, events, decadeColors) {
    var wrapper = document.createElement('div');
    var decadeId = 'liw-decade-' + decade;
    var decadeInfo = DECADES[decade] || {};
    var decadeLabel = decadeInfo.label || ('Decade ' + (decade * 10));
    var decadeStartYear = BIRTH.getFullYear() + decade * 10;
    var decadeEndYear = decadeStartYear + 10;
    var isDefaultExpanded = decade === defaultExpandedDecade;

    wrapper.className = 'liw-decade-wrapper';
    wrapper.setAttribute('data-collapsed', isDefaultExpanded ? 'false' : 'true');
    wrapper.setAttribute('data-decade', String(decade));

    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'liw-decade-collapsed';
    card.style.background = decadeColors.fill;
    card.style.borderColor = decadeColors.border;
    card.setAttribute('aria-expanded', isDefaultExpanded ? 'true' : 'false');
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
    stats.textContent = eventCount + ' event' + (eventCount === 1 ? '' : 's') + ' \u00B7 10 years';

    header.appendChild(title);
    header.appendChild(stats);

    var eventPreview = document.createElement('span');
    eventPreview.className = 'liw-collapsed-events';
    events.slice(0, 4).forEach(function(eventItem) {
      var emoji = eventItem.label.match(emojiPattern);
      if (emoji && emoji[0]) {
        var emojiSpan = document.createElement('span');
        emojiSpan.textContent = emoji[0];
        emojiSpan.title = eventItem.label;
        eventPreview.appendChild(emojiSpan);
      }
    });

    var expandLabel = document.createElement('span');
    expandLabel.className = 'liw-expand-btn';
    expandLabel.innerHTML = collapsedCardText(isDefaultExpanded);

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

  function ensureDecadeRendered(wrapper) {
    var decadeElement = wrapper.querySelector('.liw-decade');
    if (!decadeElement || decadeElement.getAttribute('data-rendered') === 'true') {
      return;
    }

    renderDecade(parseInt(wrapper.getAttribute('data-decade'), 10), decadeElement);
  }

  function toggleDecade(wrapper) {
    var isCollapsed = wrapper.getAttribute('data-collapsed') === 'true';
    var nextCollapsed = !isCollapsed;

    if (isCollapsed) {
      ensureDecadeRendered(wrapper);
    }

    wrapper.setAttribute('data-collapsed', nextCollapsed ? 'true' : 'false');

    var toggleButton = wrapper.querySelector('.liw-decade-collapsed');
    var expandLabel = wrapper.querySelector('.liw-expand-btn');

    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', isCollapsed ? 'true' : 'false');
    }

    if (expandLabel) {
      expandLabel.innerHTML = collapsedCardText(isCollapsed);
    }

    scheduleLegendContextUpdate();

    if (isCollapsed) {
      setTimeout(function() {
        wrapper.scrollIntoView({ behavior: prefersReducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
      }, 100);
    }
  }

  function hideLegendContext() {
    if (!legend || !legendContext) {
      return;
    }
    if (
      activeContextDecade === -1 &&
      !legendContext.classList.contains('is-visible') &&
      legendContext.getAttribute('aria-hidden') === 'true'
    ) {
      return;
    }

    legend.querySelectorAll('.liw-legend-item.is-context-source').forEach(function(item) {
      item.classList.remove('is-context-source');
    });
    legendContext.classList.remove('is-visible');
    legendContext.setAttribute('aria-hidden', 'true');
    legendContext.removeAttribute('aria-controls');
    legendContext.tabIndex = -1;
    activeContextDecade = -1;
    if (legendContextPositionFrame !== null) {
      cancelAnimationFrame(legendContextPositionFrame);
      legendContextPositionFrame = null;
    }
  }

  function positionLegendContext(decade) {
    if (!legend || !legendContext) {
      return;
    }

    var source = legend.querySelector('.liw-legend-item[data-decade="' + decade + '"]');
    if (!source) {
      hideLegendContext();
      return;
    }

    var palette = DECADES[decade] || DECADES[DECADES.length - 1];
    var label = (DECADES[decade] && DECADES[decade].label) || ('Decade ' + (decade * 10));
    var labelElement = legendContext.querySelector('.liw-legend-context-label');
    var contextChanged = activeContextDecade !== decade;

    legend.querySelectorAll('.liw-legend-item.is-context-source').forEach(function(item) {
      item.classList.remove('is-context-source');
    });
    if (contextChanged) {
      legendContext.classList.remove('is-visible');
    }
    source.style.setProperty('--liw-context-fill', palette.fill);
    source.style.setProperty('--liw-context-border', palette.border);
    source.classList.add('is-context-source');
    legendContext.style.setProperty('--liw-context-fill', palette.fill);
    legendContext.style.setProperty('--liw-context-border', palette.border);
    labelElement.textContent = 'Collapse ' + label;
    legendContext.setAttribute('aria-label', 'Collapse ' + label);
    legendContext.setAttribute('aria-controls', 'liw-decade-' + decade);
    legendContext.setAttribute('aria-hidden', 'false');
    legendContext.tabIndex = 0;

    var legendRect = legend.getBoundingClientRect();
    var sourceRect = source.getBoundingClientRect();
    var contextWidth = legendContext.offsetWidth;
    var desiredLeft = sourceRect.left - legendRect.left + (sourceRect.width - contextWidth) / 2;
    var left = Math.max(8, Math.min(legendRect.width - contextWidth - 8, desiredLeft));
    var anchor = sourceRect.left - legendRect.left + sourceRect.width / 2 - left;

    legendContext.style.left = left + 'px';
    legendContext.style.setProperty('--liw-context-anchor', Math.max(16, Math.min(contextWidth - 16, anchor)) + 'px');
    activeContextDecade = decade;

    if (legendContextPositionFrame !== null) {
      cancelAnimationFrame(legendContextPositionFrame);
    }
    legendContextPositionFrame = requestAnimationFrame(function() {
      legendContextPositionFrame = null;
      if (activeContextDecade !== decade) {
        return;
      }
      var contextRect = legendContext.getBoundingClientRect();
      var liveSourceRect = source.getBoundingClientRect();
      var sourceGap = contextRect.top - liveSourceRect.bottom + 1;
      var stemHeight = sourceGap >= 0 && sourceGap <= 18 ? sourceGap : 0;
      legendContext.style.setProperty('--liw-context-stem', stemHeight + 'px');
      legendContext.classList.add('is-visible');
    });
  }

  function syncLegendContext() {
    legendContextFrame = null;
    var needsPosition = legendContextNeedsPosition;
    legendContextNeedsPosition = false;
    if (!legend || !legendContext) {
      return;
    }

    var readingTop = legend.classList.contains('liw-legend-sticky') ? legend.offsetHeight : 0;
    var readingBottom = window.innerHeight;
    var candidate = -1;
    var nearestDistance = Number.POSITIVE_INFINITY;

    gridEl.querySelectorAll('.liw-decade-wrapper[data-collapsed="false"]').forEach(function(wrapper) {
      var rect = wrapper.getBoundingClientRect();
      var intersects = rect.bottom > readingTop + 12 && rect.top < readingBottom - 32;
      if (!intersects) {
        return;
      }

      var distance = Math.abs(rect.top - readingTop);
      if (distance < nearestDistance) {
        candidate = parseInt(wrapper.getAttribute('data-decade'), 10);
        nearestDistance = distance;
      }
    });

    if (candidate === -1) {
      hideLegendContext();
      return;
    }

    if (
      candidate === activeContextDecade &&
      legendContext.classList.contains('is-visible') &&
      !needsPosition
    ) {
      return;
    }

    positionLegendContext(candidate);
  }

  function scheduleLegendContextUpdate(forcePosition) {
    legendContextNeedsPosition = legendContextNeedsPosition || Boolean(forcePosition);
    if (legendContextFrame !== null) {
      return;
    }
    legendContextFrame = requestAnimationFrame(syncLegendContext);
  }

  function createWeekTooltip(weekStart, eventsThisWeek, isNow) {
    var tip = document.createElement('span');
    tip.className = 'liw-tip';

    if (eventsThisWeek) {
      eventsThisWeek.forEach(function(eventItem) {
        var eventDateDiv = document.createElement('div');
        eventDateDiv.className = 'liw-tip-date';
        eventDateDiv.textContent = formatDate(eventItem.eventDate);
        tip.appendChild(eventDateDiv);

        var eventLabelDiv = document.createElement('div');
        eventLabelDiv.className = 'liw-tip-label';
        eventLabelDiv.textContent = eventItem.label;
        tip.appendChild(eventLabelDiv);

        if (eventItem.description) {
          var eventDescriptionDiv = document.createElement('div');
          eventDescriptionDiv.className = 'liw-tip-desc';
          eventDescriptionDiv.textContent = eventItem.description;
          tip.appendChild(eventDescriptionDiv);
        }
      });
    } else {
      var dateDiv = document.createElement('div');
      dateDiv.className = 'liw-tip-date';
      dateDiv.textContent = formatDate(weekStart);
      tip.appendChild(dateDiv);

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

    return tip;
  }

  function createWeekBox(weekIdx, palette) {
    var weekStart = new Date(BIRTH.getTime() + weekIdx * MS_PER_WEEK);
    var isFuture = weekStart > NOW;
    var isNow = weekIdx === currentWeekIdx;
    var eventsThisWeek = eventsByWeek[weekIdx];
    var boxLabel = '';

    if (eventsThisWeek) {
      boxLabel = eventsThisWeek.map(function(eventItem) {
        return eventItem.label;
      }).join(' \u00B7 ');
    }

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
      var eventMark = document.createElement('span');
      var eventEmoji = eventsThisWeek.map(function(eventItem) {
        var matches = eventItem.label.match(emojiPattern);
        return matches && matches[0] ? matches[0] : '\u25C6';
      });

      eventMark.className = 'liw-event-mark';
      eventMark.setAttribute('aria-hidden', 'true');
      eventMark.textContent = eventEmoji.slice(0, 2).join('');
      box.appendChild(eventMark);
      box.setAttribute('aria-label', eventsThisWeek.map(function(eventItem) {
        return formatDate(eventItem.eventDate) + ': ' + eventItem.label;
      }).join('. '));
    }

    box.appendChild(createWeekTooltip(weekStart, eventsThisWeek, isNow));
    box.setAttribute('data-week-index', String(weekIdx));
    box.setAttribute('data-has-events', eventsThisWeek ? 'true' : 'false');
    box.setAttribute('data-is-current', isNow ? 'true' : 'false');
    box.setAttribute('data-is-future', isFuture ? 'true' : 'false');

    return {
      element: box,
      eventsThisWeek: eventsThisWeek,
      hasEvents: Boolean(eventsThisWeek),
      isFuture: isFuture,
      isNow: isNow
    };
  }

  function renderDecade(decade, decadeElement) {
    if (decadeElement.getAttribute('data-rendered') === 'true') {
      return;
    }

    var fragment = document.createDocumentFragment();
    var palette = DECADES[decade] || DECADES[DECADES.length - 1];
    var firstWeek = decade * WEEKS_PER_DECADE;
    var lastWeek = Math.min(firstWeek + WEEKS_PER_DECADE, totalWeeks);
    var currentRow = null;
    var currentRowBoxes = [];
    var decadeRows = [];
    var boxesInRow = 0;

    function createRow() {
      currentRow = document.createElement('div');
      currentRow.className = 'liw-flex-row';
      fragment.appendChild(currentRow);
      currentRowBoxes = [];
      decadeRows.push(currentRowBoxes);
      boxesInRow = 0;
    }

    for (var weekIdx = firstWeek; weekIdx < lastWeek; weekIdx += 1) {
      var weekBox = createWeekBox(weekIdx, palette);
      if (!currentRow || boxesInRow === MAX_BOXES_IN_ROW) {
        createRow();
      }

      currentRow.appendChild(weekBox.element);
      currentRowBoxes.push(weekBox);
      boxesInRow += 1;
    }

    placeDecadeCallouts(decadeRows, palette);

    decadeElement.appendChild(fragment);
    decadeElement.setAttribute('data-rendered', 'true');
  }

  for (var decadeIndex = 0; decadeIndex < totalDecades; decadeIndex += 1) {
    eventsByDecade[decadeIndex] = [];
  }

  Object.keys(eventsByWeek).map(function(weekKey) {
    return parseInt(weekKey, 10);
  }).filter(function(weekIndex) {
    return weekIndex >= 0 && weekIndex < totalWeeks;
  }).sort(function(firstWeek, secondWeek) {
    return firstWeek - secondWeek;
  }).forEach(function(weekIndex) {
    var decadeIndex = Math.floor(weekIndex / WEEKS_PER_DECADE);
    eventsByWeek[weekIndex].forEach(function(eventItem) {
      if (!eventItem.isBirthday || eventsByDecade[decadeIndex].length === 0) {
        var alreadyPresent = eventsByDecade[decadeIndex].some(function(existingEvent) {
          return existingEvent.label === eventItem.label;
        });
        if (!alreadyPresent) {
          eventsByDecade[decadeIndex].push(eventItem);
        }
      }
    });
  });

  var gridFragment = document.createDocumentFragment();
  for (var decade = 0; decade < totalDecades; decade += 1) {
    var decadeColors = DECADES[decade] || DECADES[DECADES.length - 1];
    var decadeWrapper = createCollapsedCard(decade, eventsByDecade[decade], decadeColors);
    var decadeElement = document.createElement('div');
    decadeElement.className = 'liw-decade';
    decadeElement.id = decadeWrapper.dataset.controls;
    decadeElement.setAttribute('data-rendered', 'false');
    decadeWrapper.appendChild(decadeElement);
    gridFragment.appendChild(decadeWrapper);

    if (decade === defaultExpandedDecade) {
      renderDecade(decade, decadeElement);
    }
  }
  gridEl.appendChild(gridFragment);

  if (legend) {
    var legendTop = legend.offsetTop;
    var legendResizeFrame = null;
    var updateStickyOffset = function() {
      legendResizeFrame = null;
      document.documentElement.style.setProperty('--liw-sticky-offset', (legend.offsetHeight + 16) + 'px');
      scheduleLegendContextUpdate(true);
    };
    var scheduleStickyOffsetUpdate = function() {
      if (legendResizeFrame !== null) {
        return;
      }
      legendResizeFrame = requestAnimationFrame(updateStickyOffset);
    };
    updateStickyOffset();
    window.addEventListener('resize', scheduleStickyOffsetUpdate, { passive: true });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(scheduleStickyOffsetUpdate);
    }
    window.addEventListener('scroll', function() {
      var shouldStick = window.scrollY > legendTop;
      var stickyChanged = legend.classList.contains('liw-legend-sticky') !== shouldStick;
      legend.classList.toggle('liw-legend-sticky', shouldStick);
      scheduleLegendContextUpdate(stickyChanged);
    }, { passive: true });
  }

  var goNowButton = document.getElementById('go-now');
  if (legendContext) {
    legendContext.addEventListener('click', function() {
      if (activeContextDecade === -1) {
        return;
      }
      var wrapper = gridEl.querySelector('.liw-decade-wrapper[data-decade="' + activeContextDecade + '"]');
      if (wrapper && wrapper.getAttribute('data-collapsed') === 'false') {
        toggleDecade(wrapper);
      }
    });
  }

  scheduleLegendContextUpdate(true);

  if (goNowButton) {
    goNowButton.addEventListener('click', function() {
      if (!nowBox) {
        return;
      }

      var currentDecadeWrapper = nowBox.closest('.liw-decade-wrapper');
      var expandedCurrentDecade = false;

      if (currentDecadeWrapper && currentDecadeWrapper.getAttribute('data-collapsed') === 'true') {
        toggleDecade(currentDecadeWrapper);
        expandedCurrentDecade = true;
      }

      setTimeout(function() {
        nowBox.scrollIntoView({ behavior: prefersReducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
        nowBox.style.transition = 'box-shadow 0.3s ease';

        var accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#D2691E';
        var accentRgb = document.documentElement.classList.contains('dark') ? '232, 133, 58' : '210, 105, 30';

        setTimeout(function() {
          nowBox.style.boxShadow = '0 0 0 4px ' + accent + ', 0 0 20px rgba(' + accentRgb + ', 0.6)';
          setTimeout(function() {
            nowBox.style.boxShadow = '0 0 0 2px ' + accent + ', 0 0 12px rgba(' + accentRgb + ', 0.4)';
          }, 600);
        }, 500);
      }, expandedCurrentDecade ? 500 : 0);
    });
  }
})();
