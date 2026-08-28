(function() {
  var root = document.documentElement;
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

  function parseDate(value) {
    var parts = value.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  // <span class="x">text</span>, the shape almost every node here takes.
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  var BIRTH = parseDate(CONFIG.birthday);
  var LIFESPAN = CONFIG.lifespan_years;
  var MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  var WEEKS_PER_YEAR = 52;
  var NOW = new Date();
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  var DECADES = CONFIG.decades;

  // Two files, one timeline. _data/world-events.yml is the world's list and
  // _data/life-in-weeks.yml is the personal one; membership in the former is
  // what makes an event a world event, so neither file carries a per-event flag.
  var worldEl = document.getElementById('life-in-weeks-world');
  var WORLD_EVENTS = [];
  if (worldEl) {
    try {
      WORLD_EVENTS = JSON.parse(worldEl.textContent) || [];
    } catch (error) {
      WORLD_EVENTS = [];
    }
  }

  var EVENTS = CONFIG.events.concat(WORLD_EVENTS.map(function(eventItem) {
    eventItem.kind = 'world';
    return eventItem;
  }));
  // Weeks per row, owned by the stylesheet's --liw-cols so the breakpoint that
  // changes it and the rule that lays the row out cannot drift apart. A narrow
  // screen buys column width with rows: a callout has to fit in the columns
  // beside its anchor, and at 21 columns on a phone none of them holds a word.
  var DEFAULT_BOXES_IN_ROW = 21;
  var boxesInRow = DEFAULT_BOXES_IN_ROW;

  function readBoxesInRow() {
    var declared = parseInt(getComputedStyle(gridEl).getPropertyValue('--liw-cols'), 10);
    return declared > 0 ? declared : DEFAULT_BOXES_IN_ROW;
  }

  var CALLOUT_MIN_SPAN = 2;
  var CALLOUT_MAX_SPAN = 5;
  var CALLOUT_RULER = 'MMMMMMMMMMxxxxxxxxxx';
  var GRID_GAP = 2;
  var textRuler = null;
  var WEEKS_PER_DECADE = WEEKS_PER_YEAR * 10;
  var totalWeeks = LIFESPAN * WEEKS_PER_YEAR;
  var totalDecades = Math.ceil(totalWeeks / WEEKS_PER_DECADE);
  // Keycaps lead: they open with an ASCII digit, which Extended_Pictographic does
  // not cover, so a label like "0\uFE0F\u20E3 NetZero" would keep its 0 in the
  // callout text and fall back to the generic diamond on the week box.
  var emojiPattern = /(?:[0-9#*]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/gu;
  var currentWeekIdx = Math.floor((NOW - BIRTH) / MS_PER_WEEK);
  var defaultExpandedDecade = Math.max(0, Math.min(
    totalDecades - 1,
    Math.floor(Math.floor(currentWeekIdx / WEEKS_PER_YEAR) / 10)
  ));

  function scrollIntoView(element, block) {
    element.scrollIntoView({ behavior: prefersReducedMotion.matches ? 'auto' : 'smooth', block: block });
  }

  function decadePalette(decade) {
    return DECADES[decade] || DECADES[DECADES.length - 1];
  }

  function decadeLabel(decade) {
    return (DECADES[decade] || {}).label || ('Decade ' + (decade * 10));
  }

  var legend = document.querySelector('.liw-legend');

  var eventsByWeek = {};

  function weekBucket(date) {
    var weekIdx = Math.floor((date - BIRTH) / MS_PER_WEEK);
    return eventsByWeek[weekIdx] || (eventsByWeek[weekIdx] = []);
  }

  EVENTS.forEach(function(eventItem) {
    eventItem.eventDate = parseDate(eventItem.date);
    weekBucket(eventItem.eventDate).push(eventItem);
  });

  for (var age = 1; age < LIFESPAN; age += 1) {
    var birthdayDate = new Date(BIRTH.getFullYear() + age, BIRTH.getMonth(), BIRTH.getDate());
    weekBucket(birthdayDate).unshift({
      label: '\uD83C\uDF82 ' + age + ' in ' + (BIRTH.getFullYear() + age),
      description: 'Turned ' + age + ' year' + (age !== 1 ? 's' : '') + ' old',
      isBirthday: true,
      eventDate: birthdayDate
    });
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

  // A week reads as the world's only when nothing personal happened in it -- on
  // a week holding both, the personal event wins the styling.
  function isWorldWeek(eventsThisWeek) {
    var owned = (eventsThisWeek || []).filter(function(eventItem) {
      return !eventItem.isBirthday;
    });

    return owned.length > 0 && owned.every(function(eventItem) {
      return eventItem.kind === 'world';
    });
  }

  // Both the week column and the callout font scale with the viewport, so a
  // fixed characters-per-week number is only ever right at one window size.
  // Measure the pair the label geometry actually depends on.
  var calloutMetrics = { advance: 6.34, worldAdvance: 6.34, column: 46, measuredAt: 0 };

  // World labels are set smaller, uppercase and tracked out, so they hold a
  // different number of characters per week than personal labels do. Measure the
  // two faces separately rather than letting one stand in for both.
  function measureAdvance(className) {
    var probe = el('span', className);
    probe.style.visibility = 'hidden';
    gridEl.appendChild(probe);

    var probeStyle = window.getComputedStyle(probe);
    var font = probeStyle.fontWeight + ' ' + probeStyle.fontSize + ' ' + probeStyle.fontFamily;
    var tracking = parseFloat(probeStyle.letterSpacing) || 0;
    var isUpper = probeStyle.textTransform === 'uppercase';
    gridEl.removeChild(probe);

    textRuler = textRuler || document.createElement('canvas').getContext('2d');
    textRuler.font = font;

    var sample = isUpper ? CALLOUT_RULER.toUpperCase() : CALLOUT_RULER;
    return textRuler.measureText(sample).width / sample.length + tracking;
  }

  function measureCalloutMetrics() {
    var gridWidth = gridEl.clientWidth;
    if (!gridWidth || gridWidth === calloutMetrics.measuredAt) {
      return;
    }

    calloutMetrics.measuredAt = gridWidth;
    calloutMetrics.column = (gridWidth - (boxesInRow - 1) * GRID_GAP) / boxesInRow;

    var advance = measureAdvance('liw-callout');
    if (advance > 0) {
      calloutMetrics.advance = advance;
    }

    var worldAdvance = measureAdvance('liw-callout liw-callout-world');
    if (worldAdvance > 0) {
      calloutMetrics.worldAdvance = worldAdvance;
    }
  }

  // Characters that fit on one line of a callout spanning `span` weeks. Mirrors
  // .liw-callout[data-span] in the stylesheet: each week contributes a box
  // padding box (4px of border in from the column), plus the rule's 6px-per-
  // extra-week bonus, less the callout's own 20px of padding and border.
  function calloutCapacity(span, isWorld) {
    var width = span * (calloutMetrics.column - 4) + 6 * span - 22;
    var advance = isWorld ? calloutMetrics.worldAdvance : calloutMetrics.advance;
    return Math.max(1, Math.floor(width / advance));
  }

  // Narrowest span holding the text on one line, and whether it got there --
  // the loop can also stop at CALLOUT_MAX_SPAN, meaning it never fits.
  function calloutOneLine(text, isWorld) {
    var characterCount = Array.from(text).length;
    var span = CALLOUT_MIN_SPAN;

    while (span < CALLOUT_MAX_SPAN && calloutCapacity(span, isWorld) < characterCount) {
      span += 1;
    }

    return { span: span, fits: characterCount <= calloutCapacity(span, isWorld) };
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

  // Footprints a stacked callout can take, smallest first.
  var STACKED_SHAPES = [
    { rows: 2, span: 2 },
    { rows: 2, span: 3 },
    { rows: 2, span: 4 },
    { rows: 3, span: 3 },
    { rows: 3, span: 4 }
  ];

  function longestWordLength(text) {
    return text.split(/\s+/).reduce(function(longest, word) {
      return Math.max(longest, Array.from(word).length);
    }, 0);
  }

  /*
    The stacked shape is the smallest footprint the text fits in -- but the
    smallest one that can break between words, when there is one. Three columns
    on a phone is an eight-character line, which cuts "internship" in half; the
    fourth column buys the four characters that keep it whole, and is worth the
    three extra cells. Only if nothing wraps cleanly does the smallest shape
    win and the word get broken.

    The vertical shape stays at span 3: it is centred on its anchor, and the
    stylesheet's above/below rules are written for that width.
  */
  function calloutShapes(text, isWorld) {
    var longestWord = longestWordLength(text);
    var wordSafe = null;
    var smallest = null;

    STACKED_SHAPES.forEach(function(shape) {
      var capacity = calloutCapacity(shape.span, isWorld);
      if (estimatedCalloutLines(text, capacity) > shape.rows) {
        return;
      }
      if (!smallest) {
        smallest = shape;
      }
      if (!wordSafe && longestWord <= capacity) {
        wordSafe = shape;
      }
    });

    var atThree = estimatedCalloutLines(text, calloutCapacity(3, isWorld));

    return {
      stacked: wordSafe || smallest,
      stackedWraps: Boolean(wordSafe),
      vertical: atThree <= 3 ? { rows: atThree, span: 3 } : null
    };
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
    var callout = el('span', 'liw-callout liw-callout-' + option.direction +
      (candidate.isWorld ? ' liw-callout-world' : ''));
    var anchor = candidate.box.element;

    callout.setAttribute('aria-hidden', 'true');
    callout.setAttribute('data-rows', String(option.rows));
    callout.style.setProperty('--liw-span', String(option.span));
    callout.setAttribute('data-vertical', option.vertical);
    callout.appendChild(el('span', 'liw-callout-label', candidate.text));

    anchor.classList.add('liw-callout-anchor');
    anchor.style.setProperty('--liw-callout-fill', candidate.palette.fill);
    anchor.style.setProperty('--liw-callout-border', candidate.palette.border);
    anchor.insertBefore(callout, anchor.querySelector('.liw-tip'));
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

        var isWorld = isWorldWeek(box.eventsThisWeek);
        var shapes = calloutShapes(text, isWorld);
        var oneLine = calloutOneLine(text, isWorld);
        var candidate = {
          box: box,
          column: column,
          isWorld: isWorld,
          palette: palette,
          rowIndex: rowIndex,
          stackedShape: shapes.stacked,
          text: text,
          verticalShape: shapes.vertical,
          wideSpan: oneLine.span
        };
        candidate.wideFits = oneLine.fits;
        // Rank the compact stacked form first only when it wraps between words;
        // otherwise a wider single line is the more readable of the two.
        candidate.prefersStacked = candidate.wideSpan >= 4 && shapes.stackedWraps;
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
  var nowDecade = Math.floor(currentWeekIdx / WEEKS_PER_DECADE);

  // Looked up rather than held: a decade is thrown away and laid out again when
  // the column count changes, so a cached element outlives the box it names.
  function currentWeekBox() {
    return gridEl.querySelector('.liw-box[data-is-current="true"]');
  }

  function collapsedCardText(isExpanded) {
    return isExpanded ? 'Collapse <span class="liw-expand-arrow">\u2191</span>' : 'Expand <span class="liw-expand-arrow">\u2193</span>';
  }

  function createCollapsedCard(decade, events, decadeColors) {
    var decadeId = 'liw-decade-' + decade;
    var decadeStartYear = BIRTH.getFullYear() + decade * 10;
    var isDefaultExpanded = decade === defaultExpandedDecade;
    var eventCount = events.filter(function(eventItem) {
      return !eventItem.isBirthday;
    }).length;

    var wrapper = el('div', 'liw-decade-wrapper');
    wrapper.setAttribute('data-collapsed', isDefaultExpanded ? 'false' : 'true');
    wrapper.setAttribute('data-decade', String(decade));

    var card = el('button', 'liw-decade-collapsed');
    card.type = 'button';
    card.style.setProperty('--liw-card-fill', decadeColors.fill);
    card.style.setProperty('--liw-card-border', decadeColors.border);
    card.setAttribute('aria-expanded', isDefaultExpanded ? 'true' : 'false');
    card.setAttribute('aria-controls', decadeId);

    var header = el('span', 'liw-collapsed-header');
    header.appendChild(el('span', 'liw-collapsed-title',
      decadeLabel(decade) + ' (' + decadeStartYear + '-' + (decadeStartYear + 10) + ')'));
    header.appendChild(el('span', 'liw-collapsed-stats',
      eventCount + ' event' + (eventCount === 1 ? '' : 's') + ' \u00B7 10 years'));

    var eventPreview = el('span', 'liw-collapsed-events');
    events.slice(0, 4).forEach(function(eventItem) {
      var emoji = eventItem.label.match(emojiPattern);
      if (emoji && emoji[0]) {
        var emojiSpan = el('span', '', emoji[0]);
        emojiSpan.title = eventItem.label;
        eventPreview.appendChild(emojiSpan);
      }
    });

    var expandLabel = el('span', 'liw-expand-btn');
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

    // The window may have resized since the last render.
    measureCalloutMetrics();
    renderDecade(parseInt(wrapper.getAttribute('data-decade'), 10), decadeElement);
  }

  function setDecadeOpen(wrapper, shouldOpen) {
    if (shouldOpen) {
      ensureDecadeRendered(wrapper);
    }

    wrapper.setAttribute('data-collapsed', shouldOpen ? 'false' : 'true');

    var toggleButton = wrapper.querySelector('.liw-decade-collapsed');
    var expandLabel = wrapper.querySelector('.liw-expand-btn');

    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    }

    if (expandLabel) {
      expandLabel.innerHTML = collapsedCardText(shouldOpen);
    }
  }

  // One decade at a time. Opening one closes the rest, which holds the page at
  // roughly two screens instead of letting it grow past fourteen.
  function openDecade(wrapper) {
    gridEl.querySelectorAll('.liw-decade-wrapper[data-collapsed="false"]').forEach(function(openWrapper) {
      if (openWrapper !== wrapper) {
        setDecadeOpen(openWrapper, false);
      }
    });

    setDecadeOpen(wrapper, true);
    markActiveDecade();
  }

  function scrollToDecade(wrapper) {
    // Let the reflow from closing the previous decade settle before chasing it.
    setTimeout(function() {
      scrollIntoView(wrapper, 'start');
    }, 100);
  }

  function toggleDecade(wrapper) {
    if (wrapper.getAttribute('data-collapsed') === 'false') {
      setDecadeOpen(wrapper, false);
      markActiveDecade();
      return;
    }

    openDecade(wrapper);
    scrollToDecade(wrapper);
  }

  // A legend chip navigates; closing a decade stays the decade bar's job.
  function jumpToDecade(decade) {
    var wrapper = gridEl.querySelector('.liw-decade-wrapper[data-decade="' + decade + '"]');
    if (wrapper) {
      openDecade(wrapper);
      scrollToDecade(wrapper);
    }
  }

  // Exactly one decade is open, so the legend highlight is simply that decade
  // -- no scroll tracking, no measuring, no floating anchor to position.
  function markActiveDecade() {
    if (!legend) {
      return;
    }

    var openWrapper = gridEl.querySelector('.liw-decade-wrapper[data-collapsed="false"]');
    var openDecadeIndex = openWrapper ? openWrapper.getAttribute('data-decade') : null;

    legend.querySelectorAll('.liw-legend-item[data-decade]').forEach(function(chip) {
      if (chip.getAttribute('data-decade') === openDecadeIndex) {
        chip.setAttribute('aria-current', 'true');
      } else {
        chip.removeAttribute('aria-current');
      }
    });
  }


  function createWeekTooltip(weekStart, eventsThisWeek, isNow) {
    var tip = el('span', 'liw-tip');

    if (eventsThisWeek) {
      eventsThisWeek.forEach(function(eventItem) {
        tip.appendChild(el('div', 'liw-tip-date', formatDate(eventItem.eventDate)));
        tip.appendChild(el('div', 'liw-tip-label', eventItem.label));
        if (eventItem.description) {
          tip.appendChild(el('div', 'liw-tip-desc', eventItem.description));
        }
      });
    } else {
      var ageForWeek = weekStart.getFullYear() - BIRTH.getFullYear();
      if (
        weekStart.getMonth() < BIRTH.getMonth() ||
        (weekStart.getMonth() === BIRTH.getMonth() && weekStart.getDate() < BIRTH.getDate())
      ) {
        ageForWeek -= 1;
      }

      tip.appendChild(el('div', 'liw-tip-date', formatDate(weekStart)));
      tip.appendChild(el('div', 'liw-tip-label', 'Age ' + ageForWeek));
    }

    if (isNow) {
      var nowDiv = el('div', 'liw-tip-label', '\u2190 You are here');
      nowDiv.style.fontWeight = 'bold';
      tip.appendChild(nowDiv);
    }

    return tip;
  }

  function createWeekBox(weekIdx, palette) {
    var weekStart = new Date(BIRTH.getTime() + weekIdx * MS_PER_WEEK);
    var isFuture = weekStart > NOW;
    var isNow = weekIdx === currentWeekIdx;
    var eventsThisWeek = eventsByWeek[weekIdx];
    var hasEvents = Boolean(eventsThisWeek);

    var isWorld = isWorldWeek(eventsThisWeek);

    var box = el('button', 'liw-box' + (isFuture ? ' liw-future' : '') + (hasEvents ? ' liw-has-label' : '') + (isNow ? ' liw-now' : ''));
    box.type = 'button';

    // A world week is painted from the world tokens in the stylesheet instead,
    // so the decade's colours are left off rather than overridden.
    if (!isWorld) {
      box.style.borderColor = palette.border;
      if (!isFuture) {
        box.style.backgroundColor = palette.fill;
      }
    }

    if (hasEvents) {
      var eventMark = el('span', 'liw-event-mark', eventsThisWeek.slice(0, 2).map(function(eventItem) {
        var matches = eventItem.label.match(emojiPattern);
        return matches && matches[0] ? matches[0] : '\u25C6';
      }).join(''));

      eventMark.setAttribute('aria-hidden', 'true');
      box.appendChild(eventMark);
      box.setAttribute('aria-label', eventsThisWeek.map(function(eventItem) {
        return formatDate(eventItem.eventDate) + ': ' + eventItem.label;
      }).join('. '));
    }

    box.appendChild(createWeekTooltip(weekStart, eventsThisWeek, isNow));
    box.setAttribute('data-week-index', String(weekIdx));
    box.setAttribute('data-has-events', String(hasEvents));
    box.setAttribute('data-is-current', String(isNow));
    box.setAttribute('data-is-future', String(isFuture));
    if (isWorld) {
      box.setAttribute('data-kind', 'world');
    }

    return {
      element: box,
      eventsThisWeek: eventsThisWeek,
      hasEvents: hasEvents,
      isFuture: isFuture,
      isNow: isNow
    };
  }

  function renderDecade(decade, decadeElement) {
    if (decadeElement.getAttribute('data-rendered') === 'true') {
      return;
    }

    var fragment = document.createDocumentFragment();
    var palette = decadePalette(decade);
    var firstWeek = decade * WEEKS_PER_DECADE;
    var lastWeek = Math.min(firstWeek + WEEKS_PER_DECADE, totalWeeks);
    var currentRow = null;
    var currentRowBoxes = null;
    var decadeRows = [];

    for (var weekIdx = firstWeek; weekIdx < lastWeek; weekIdx += 1) {
      if (!currentRow || currentRowBoxes.length === boxesInRow) {
        currentRow = el('div', 'liw-flex-row');
        currentRowBoxes = [];
        fragment.appendChild(currentRow);
        decadeRows.push(currentRowBoxes);
      }

      var weekBox = createWeekBox(weekIdx, palette);
      currentRow.appendChild(weekBox.element);
      currentRowBoxes.push(weekBox);
    }

    placeDecadeCallouts(decadeRows, palette);

    decadeElement.appendChild(fragment);
    decadeElement.setAttribute('data-rendered', 'true');
  }

  var labelsSeenByDecade = [];
  for (var decadeIndex = 0; decadeIndex < totalDecades; decadeIndex += 1) {
    eventsByDecade[decadeIndex] = [];
    labelsSeenByDecade[decadeIndex] = new Set();
  }

  // Summary list behind each collapsed card: chronological, deduplicated by
  // label, and carrying at most the decade's opening birthday.
  Object.keys(eventsByWeek).map(Number).filter(function(weekIndex) {
    return weekIndex >= 0 && weekIndex < totalWeeks;
  }).sort(function(firstWeek, secondWeek) {
    return firstWeek - secondWeek;
  }).forEach(function(weekIndex) {
    var decadeIndex = Math.floor(weekIndex / WEEKS_PER_DECADE);
    var decadeEvents = eventsByDecade[decadeIndex];
    var labelsSeen = labelsSeenByDecade[decadeIndex];

    eventsByWeek[weekIndex].forEach(function(eventItem) {
      if (eventItem.isBirthday && decadeEvents.length > 0) {
        return;
      }
      if (!labelsSeen.has(eventItem.label)) {
        labelsSeen.add(eventItem.label);
        decadeEvents.push(eventItem);
      }
    });
  });

  boxesInRow = readBoxesInRow();
  measureCalloutMetrics();

  var gridFragment = document.createDocumentFragment();
  for (var decade = 0; decade < totalDecades; decade += 1) {
    var decadeWrapper = createCollapsedCard(decade, eventsByDecade[decade], decadePalette(decade));
    var decadeElement = el('div', 'liw-decade');
    decadeElement.id = decadeWrapper.dataset.controls;
    decadeElement.setAttribute('data-rendered', 'false');
    decadeWrapper.appendChild(decadeElement);
    gridFragment.appendChild(decadeWrapper);

    if (decade === defaultExpandedDecade) {
      renderDecade(decade, decadeElement);
    }
  }
  gridEl.appendChild(gridFragment);

  /*
    A decade is laid out once and kept, so a resize that changes --liw-cols --
    a rotation, mostly -- leaves rows the wrong length and callouts measured
    against the wrong column. Throw the rendered decades away and lay the open
    one out again at the new width.
  */
  var relayoutTimer = null;

  function relayoutIfColumnsChanged() {
    relayoutTimer = null;

    var columns = readBoxesInRow();
    if (columns === boxesInRow) {
      return;
    }

    boxesInRow = columns;
    calloutMetrics.measuredAt = 0;
    measureCalloutMetrics();

    gridEl.querySelectorAll('.liw-decade[data-rendered="true"]').forEach(function(decadeElement) {
      decadeElement.textContent = '';
      decadeElement.setAttribute('data-rendered', 'false');
    });

    gridEl.querySelectorAll('.liw-decade-wrapper[data-collapsed="false"]').forEach(ensureDecadeRendered);
  }

  // Debounced rather than scheduled on a frame: this rebuilds every box in the
  // open decade, so it wants to run once the drag or the rotation has settled.
  window.addEventListener('resize', function() {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(relayoutIfColumnsChanged, 150);
  }, { passive: true });

  if (legend) {
    var legendTop = legend.offsetTop;
    var legendResizeFrame = null;
    var updateStickyOffset = function() {
      legendResizeFrame = null;
      root.style.setProperty('--liw-sticky-offset', (legend.offsetHeight + 16) + 'px');
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
      legend.classList.toggle('liw-legend-sticky', window.scrollY > legendTop);
    }, { passive: true });

    legend.querySelectorAll('.liw-legend-item[data-decade]').forEach(function(chip) {
      chip.addEventListener('click', function() {
        jumpToDecade(chip.getAttribute('data-decade'));
      });
    });
  }

  var goNowButton = document.getElementById('go-now');

  markActiveDecade();

  if (goNowButton) {
    goNowButton.addEventListener('click', function() {
      var currentDecadeWrapper = gridEl.querySelector('.liw-decade-wrapper[data-decade="' + nowDecade + '"]');
      if (!currentDecadeWrapper) {
        return;
      }

      var accent = getComputedStyle(root).getPropertyValue('--color-accent').trim() || '#D2691E';
      var accentRgb = root.classList.contains('dark') ? '232, 133, 58' : '210, 105, 30';
      var start = 0;

      if (currentDecadeWrapper.getAttribute('data-collapsed') === 'true') {
        openDecade(currentDecadeWrapper);
        start = 500; // let the decade finish opening before chasing the box
      }

      function glow(spread, blur, alpha) {
        var nowBox = currentWeekBox();
        if (nowBox) {
          nowBox.style.boxShadow = '0 0 0 ' + spread + 'px ' + accent + ', 0 0 ' + blur + 'px rgba(' + accentRgb + ', ' + alpha + ')';
        }
      }

      setTimeout(function() {
        var nowBox = currentWeekBox();
        if (!nowBox) {
          return;
        }
        scrollIntoView(nowBox, 'center');
        nowBox.style.transition = 'box-shadow 0.3s ease';
      }, start);
      setTimeout(function() { glow(4, 20, 0.6); }, start + 500);
      setTimeout(function() { glow(2, 12, 0.4); }, start + 1100);
    });
  }
})();
