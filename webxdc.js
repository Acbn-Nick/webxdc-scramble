// webxdc dev simulator - localStorage + BroadcastChannel
//@ts-check
(function () {
  if (window.webxdc) return;

  var STORAGE_KEY = 'webxdc-scramble-updates';
  var channel = new BroadcastChannel('webxdc-scramble');
  // Per-tab identity so every tab is a different player
  // ?player=name picks the player explicitly (e.g. side-by-side iframes)
  var param = new URLSearchParams(location.search).get('player');
  var selfAddr = param ? param + '@test.local' : sessionStorage.getItem('webxdc-scramble-addr');
  if (!selfAddr) {
    selfAddr = 'player' + Math.random().toString(36).slice(2, 6) + '@test.local';
    sessionStorage.setItem('webxdc-scramble-addr', selfAddr);
  }
  var selfName = selfAddr.split('@')[0];

  function getUpdates() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveUpdates(updates) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updates));
  }

  var listener = null;
  var listenerSerial = 0;

  function processUpdates() {
    if (!listener) return;
    var updates = getUpdates();
    // Advance the serial before each call so a listener that sends an
    // update doesn't get earlier updates delivered twice
    while (listenerSerial < updates.length) {
      var i = listenerSerial++;
      listener({ serial: i + 1, payload: updates[i].payload });
    }
  }

  // Tabs append to one shared log; without a lock, tabs sending at the
  // same moment overwrite each other's updates
  function withLock(fn) {
    if (navigator.locks) {
      navigator.locks.request('webxdc-scramble-log', function () { fn(); });
    } else {
      setTimeout(fn, 0);
    }
  }

  channel.onmessage = function () {
    processUpdates();
  };

  window.webxdc = {
    selfAddr: selfAddr,
    selfName: selfName,

    setUpdateListener: function (cb, startSerial) {
      listener = cb;
      listenerSerial = startSerial || 0;
      setTimeout(processUpdates, 0);
    },

    sendUpdate: function (update, descr) {
      // Delivered asynchronously, like a real messenger
      withLock(function () {
        var updates = getUpdates();
        updates.push({ payload: update.payload, summary: update.summary });
        saveUpdates(updates);
        channel.postMessage('update');
        processUpdates();
      });
    },

    sendToChat: function (msg) {
      console.log('sendToChat:', msg);
    },
  };

  // Dev toolbar
  var toolbar = document.createElement('div');
  toolbar.style.cssText =
    'position:fixed;bottom:0;left:0;right:0;background:#333;color:#fff;padding:4px 8px;font:12px monospace;z-index:99999;display:flex;gap:8px;align-items:center;white-space:nowrap;overflow:hidden;';
  toolbar.innerHTML =
    '<span>webxdc dev | ' + selfAddr + '</span>' +
    '<button id="xdc-peer" style="margin-left:auto;cursor:pointer;">Add Peer (new tab)</button>' +
    '<button id="xdc-clear" style="cursor:pointer;">Clear State</button>';
  document.addEventListener('DOMContentLoaded', function () {
    document.body.appendChild(toolbar);
    // Keep the app's bottom bar clear of the toolbar
    var style = document.createElement('style');
    style.textContent = '#app{height:calc(100dvh - ' + toolbar.offsetHeight + 'px)!important}';
    document.head.appendChild(style);
    document.getElementById('xdc-peer').onclick = function () {
      window.open(location.href, '_blank', 'noopener');
    };
    document.getElementById('xdc-clear').onclick = function () {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem('webxdc-scramble-addr');
      location.reload();
    };
  });
})();
