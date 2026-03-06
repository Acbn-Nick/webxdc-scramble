// webxdc dev simulator - localStorage + BroadcastChannel
//@ts-check
(function () {
  if (window.webxdc) return;

  var STORAGE_KEY = 'webxdc-scramble-updates';
  var channel = new BroadcastChannel('webxdc-scramble');
  var selfAddr = localStorage.getItem('webxdc-scramble-addr');
  if (!selfAddr) {
    selfAddr = 'player' + Math.random().toString(36).slice(2, 6) + '@test.local';
    localStorage.setItem('webxdc-scramble-addr', selfAddr);
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
    for (var i = listenerSerial; i < updates.length; i++) {
      listener({ serial: i + 1, payload: updates[i].payload });
    }
    listenerSerial = updates.length;
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
      var updates = getUpdates();
      updates.push({ payload: update.payload, summary: update.summary });
      saveUpdates(updates);
      channel.postMessage('update');
      processUpdates();
    },

    sendToChat: function (msg) {
      console.log('sendToChat:', msg);
    },
  };

  // Dev toolbar
  var toolbar = document.createElement('div');
  toolbar.style.cssText =
    'position:fixed;bottom:0;left:0;right:0;background:#333;color:#fff;padding:4px 8px;font:12px monospace;z-index:99999;display:flex;gap:8px;align-items:center;';
  toolbar.innerHTML =
    '<span>webxdc dev | ' + selfAddr + '</span>' +
    '<button id="xdc-peer" style="margin-left:auto;cursor:pointer;">Add Peer (new tab)</button>' +
    '<button id="xdc-clear" style="cursor:pointer;">Clear State</button>';
  document.addEventListener('DOMContentLoaded', function () {
    document.body.appendChild(toolbar);
    document.getElementById('xdc-peer').onclick = function () {
      window.open(location.href, '_blank');
    };
    document.getElementById('xdc-clear').onclick = function () {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('webxdc-scramble-addr');
      location.reload();
    };
  });
})();
