(function() {
  var roots = document.querySelectorAll('[data-hn-terminal-demo]');

  if (!roots.length) {
    return;
  }

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var LISTENER_COMMAND = 'nc -l 5420';
  var CLIENT_COMMAND = 'nc mcbook.local 5420';
  var MESSAGE = 'hello';
  var KEY_DELAYS = [54, 47, 62, 50, 58, 45, 64, 49];

  function init(root) {
    var stage = root.querySelector('[data-hn-stage]');
    var listenerCommand = root.querySelector('[data-hn-listener-command]');
    var listenerOutput = root.querySelector('[data-hn-listener-output]');
    var listenerStatus = root.querySelector('[data-hn-listener-status]');
    var clientCommand = root.querySelector('[data-hn-client-command]');
    var clientMessage = root.querySelector('[data-hn-client-message]');
    var clientStatus = root.querySelector('[data-hn-client-status]');
    var listenerCommandCursor = root.querySelector('[data-hn-listener-command-cursor]');
    var listenerOutputCursor = root.querySelector('[data-hn-listener-output-cursor]');
    var clientCommandCursor = root.querySelector('[data-hn-client-command-cursor]');
    var clientMessageCursor = root.querySelector('[data-hn-client-message-cursor]');
    var timers = [];
    var runId = 0;
    var isVisible = false;
    var observer = null;

    if (!stage || !listenerCommand || !listenerOutput || !listenerStatus ||
        !clientCommand || !clientMessage || !clientStatus) {
      return;
    }

    var cursors = [listenerCommandCursor, listenerOutputCursor, clientCommandCursor, clientMessageCursor];

    function clearTimers() {
      timers.forEach(function(timer) {
        window.clearTimeout(timer);
      });
      timers = [];
    }

    function schedule(callback, delay, token) {
      var timer = window.setTimeout(function() {
        if (token === runId) {
          callback();
        }
      }, delay);
      timers.push(timer);
    }

    function activateCursor(activeCursor) {
      cursors.forEach(function(cursor) {
        if (cursor) {
          cursor.classList.toggle('is-active', cursor === activeCursor);
        }
      });
    }

    function reset() {
      runId += 1;
      clearTimers();
      listenerCommand.textContent = '';
      listenerOutput.textContent = '';
      clientCommand.textContent = '';
      clientMessage.textContent = '';
      listenerStatus.textContent = 'ready';
      clientStatus.textContent = 'ready';
      stage.classList.remove('is-listening', 'is-connected', 'is-received');
      root.setAttribute('data-animation-state', 'ready');
      activateCursor(null);
    }

    function typeText(element, text, startAt, token, cursor) {
      var elapsed = startAt;

      schedule(function() {
        activateCursor(cursor);
      }, startAt, token);

      Array.prototype.forEach.call(text, function(character, index) {
        elapsed += KEY_DELAYS[index % KEY_DELAYS.length];
        schedule(function() {
          element.textContent += character;
        }, elapsed, token);
      });

      return elapsed;
    }

    function showFinalState() {
      reset();
      listenerCommand.textContent = LISTENER_COMMAND;
      listenerOutput.textContent = MESSAGE;
      clientCommand.textContent = CLIENT_COMMAND;
      clientMessage.textContent = MESSAGE;
      listenerStatus.textContent = 'listening';
      clientStatus.textContent = 'connected';
      stage.classList.add('is-listening', 'is-connected', 'is-received');
      root.setAttribute('data-animation-state', 'complete');
      activateCursor(null);
    }

    function play() {
      if (reducedMotion.matches) {
        showFinalState();
        return;
      }

      reset();
      var token = runId;
      var at = 180;
      root.setAttribute('data-animation-state', 'playing');

      at = typeText(listenerCommand, LISTENER_COMMAND, at, token, listenerCommandCursor);
      at += 110;
      schedule(function() {
        listenerStatus.textContent = 'listening';
        stage.classList.add('is-listening');
        activateCursor(listenerOutputCursor);
      }, at, token);

      at += 260;
      at = typeText(clientCommand, CLIENT_COMMAND, at, token, clientCommandCursor);
      at += 120;
      schedule(function() {
        clientStatus.textContent = 'connected';
        stage.classList.add('is-connected');
        activateCursor(clientMessageCursor);
      }, at, token);

      at += 270;
      at = typeText(clientMessage, MESSAGE, at, token, clientMessageCursor);
      at += 520;
      schedule(function() {
        listenerOutput.textContent = MESSAGE;
        stage.classList.add('is-received');
        root.setAttribute('data-animation-state', 'complete');
        activateCursor(null);
      }, at, token);

      at += 1900;
      schedule(function() {
        if (isVisible) {
          play();
        }
      }, at, token);
    }

    function observe() {
      if (observer) {
        observer.disconnect();
      }

      if (!('IntersectionObserver' in window)) {
        isVisible = true;
        play();
        return;
      }

      observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          var wasVisible = isVisible;
          isVisible = entry.isIntersecting && entry.intersectionRatio >= 0.25;

          if (isVisible && !wasVisible) {
            play();
          } else if (!isVisible && wasVisible) {
            reset();
          }
        });
      }, { threshold: [0, 0.25, 0.6] });

      observer.observe(root);
    }

    function handleMotionPreference() {
      if (reducedMotion.matches) {
        if (observer) {
          observer.disconnect();
        }
        showFinalState();
      } else {
        reset();
        isVisible = false;
        observe();
      }
    }

    if (typeof reducedMotion.addEventListener === 'function') {
      reducedMotion.addEventListener('change', handleMotionPreference);
    } else if (typeof reducedMotion.addListener === 'function') {
      reducedMotion.addListener(handleMotionPreference);
    }

    if (reducedMotion.matches) {
      showFinalState();
    } else {
      reset();
      observe();
    }
  }

  Array.prototype.forEach.call(roots, init);
})();
