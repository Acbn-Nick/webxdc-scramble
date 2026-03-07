// dict.js - Word dictionary loaded from packed binary DAWG
//
// Node encoding (3 bytes = 24 bits):
//   bits 0-4:   letter (a=0 .. z=25)
//   bit 5:      end-of-word flag
//   bit 6:      last-sibling flag
//   bits 7-23:  first-child index (17 bits)

var dawg = null;

export function loadDictionary() {
  return fetch('./dict.bin')
    .then(function(r) { return r.arrayBuffer(); })
    .then(function(buf) { dawg = new Uint8Array(buf); });
}

function getNode(i) {
  var off = i * 3;
  return dawg[off] | (dawg[off + 1] << 8) | (dawg[off + 2] << 16);
}

export function isValidWord(word) {
  if (!word || !dawg) return false;
  word = word.toLowerCase();
  var ci = getNode(0) >>> 7; // root's first-child index
  for (var i = 0; i < word.length; i++) {
    if (!ci) return false;
    var target = word.charCodeAt(i) - 97;
    while (true) {
      var n = getNode(ci);
      if ((n & 0x1F) === target) {
        if (i === word.length - 1) return !!(n & 0x20);
        ci = n >>> 7;
        break;
      }
      if (n & 0x40) return false; // last sibling, letter not found
      ci++;
    }
  }
  return false;
}
