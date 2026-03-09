// dict.js - Word dictionary loaded from pointer-free trie
//
// Node encoding (1 byte per node):
//   bits 0-4:  letter (a=0 .. z=25)
//   bit 5:     end-of-word flag
//   bit 6:     last-sibling flag
//   bit 7:     has-children flag
//
// Layout: "grouped DFS" — sibling groups contiguous, children follow recursively.

var trie = null;
var rootIndex = null; // Array[26]: { eow, childrenPos, hasChildren } or null

export function loadDictionary() {
  return fetch('./dict.bin')
    .then(function(r) { return r.arrayBuffer(); })
    .then(function(buf) {
      trie = new Uint8Array(buf);

      // Precompute root-level index for O(1) first-letter lookup
      rootIndex = new Array(26);
      for (var i = 0; i < 26; i++) rootIndex[i] = null;

      var pos = 0;
      var siblings = [];
      while (true) {
        var b = trie[pos];
        siblings.push({ letter: b & 0x1F, eow: !!(b & 0x20), hasChildren: !!(b & 0x80) });
        pos++;
        if (b & 0x40) break;
      }

      var cpos = pos;
      for (var i = 0; i < siblings.length; i++) {
        var s = siblings[i];
        if (s.hasChildren) {
          rootIndex[s.letter] = { eow: s.eow, childrenPos: cpos, hasChildren: true };
          cpos = skipGroup(cpos);
        } else {
          rootIndex[s.letter] = { eow: s.eow, childrenPos: -1, hasChildren: false };
        }
      }
    });
}

function skipGroup(pos) {
  var childBearers = 0;
  while (true) {
    var b = trie[pos];
    if (b & 0x80) childBearers++;
    pos++;
    if (b & 0x40) break;
  }
  for (var i = 0; i < childBearers; i++) {
    pos = skipGroup(pos);
  }
  return pos;
}

export function isValidWord(word) {
  if (!word || !trie) return false;
  word = word.toLowerCase();

  var letter0 = word.charCodeAt(0) - 97;
  if (letter0 < 0 || letter0 > 25) return false;
  var info = rootIndex[letter0];
  if (!info) return false;
  if (word.length === 1) return info.eow;
  if (!info.hasChildren) return false;

  var pos = info.childrenPos;

  for (var i = 1; i < word.length; i++) {
    var target = word.charCodeAt(i) - 97;

    // Scan sibling group for target letter
    var found = false;
    var skipCount = 0; // child-bearing siblings before target
    var targetHasChildren = false;
    var targetEow = false;
    var scanPos = pos;

    while (true) {
      var b = trie[scanPos];
      var letter = b & 0x1F;
      var hasChildren = !!(b & 0x80);
      var lastSib = !!(b & 0x40);

      if (letter === target) {
        found = true;
        targetHasChildren = hasChildren;
        targetEow = !!(b & 0x20);
        scanPos++;
        // Advance past remaining siblings to find end of group
        if (!lastSib) {
          while (true) {
            var b2 = trie[scanPos];
            scanPos++;
            if (b2 & 0x40) break;
          }
        }
        break;
      }

      if (hasChildren) skipCount++;
      scanPos++;
      if (lastSib) break;
    }

    if (!found) return false;
    if (i === word.length - 1) return targetEow;
    if (!targetHasChildren) return false;

    // Skip past child groups of siblings that came before target
    var nextPos = scanPos;
    for (var s = 0; s < skipCount; s++) {
      nextPos = skipGroup(nextPos);
    }
    pos = nextPos;
  }

  return false;
}
