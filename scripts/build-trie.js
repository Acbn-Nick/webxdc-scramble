// build-trie.js — Compile words.txt into a pointer-free trie (dict.bin)
//
// Node encoding (1 byte per node):
//   bits 0-4:  letter (a=0 .. z=25)
//   bit 5:     end-of-word flag
//   bit 6:     last-sibling flag
//   bit 7:     has-children flag
//
// Layout: "grouped DFS" — sibling groups are contiguous, children follow recursively.
// Identical subtrees produce identical byte sequences for deflate to match.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

var __dirname = dirname(fileURLToPath(import.meta.url));
var wordsPath = join(__dirname, '..', 'src', 'words.txt');
var outPath = join(__dirname, '..', 'public', 'dict.bin');

// --- Build trie ---

function createTrieNode() {
  return { children: {}, end: false };
}

var root = createTrieNode();
var words = readFileSync(wordsPath, 'utf8').trim().split('\n');

for (var i = 0; i < words.length; i++) {
  var word = words[i].trim().toLowerCase();
  if (!word) continue;
  var node = root;
  for (var j = 0; j < word.length; j++) {
    var ch = word[j];
    if (!node.children[ch]) {
      node.children[ch] = createTrieNode();
    }
    node = node.children[ch];
  }
  node.end = true;
}

console.log('Words loaded:', words.length);

// --- Encode trie as grouped DFS (1 byte per node) ---

var bytes = [];
var nodeCount = 0;

function encodeGroup(node) {
  var keys = Object.keys(node.children).sort();
  if (keys.length === 0) return;

  // Emit sibling bytes
  for (var i = 0; i < keys.length; i++) {
    var ch = keys[i];
    var child = node.children[ch];
    var letter = ch.charCodeAt(0) - 97;
    var hasChildren = Object.keys(child.children).length > 0;
    var lastSibling = (i === keys.length - 1);

    var b = (letter & 0x1F)
      | (child.end ? 0x20 : 0)
      | (lastSibling ? 0x40 : 0)
      | (hasChildren ? 0x80 : 0);

    bytes.push(b);
    nodeCount++;
  }

  // Recurse into children that have children
  for (var i = 0; i < keys.length; i++) {
    var child = node.children[keys[i]];
    if (Object.keys(child.children).length > 0) {
      encodeGroup(child);
    }
  }
}

encodeGroup(root);

var buf = new Uint8Array(bytes.length);
for (var i = 0; i < bytes.length; i++) {
  buf[i] = bytes[i];
}

writeFileSync(outPath, buf);
console.log('Wrote', outPath, '(' + buf.length + ' bytes, ' + nodeCount + ' nodes)');

// --- Verify ---

function skipGroup(data, pos) {
  var childBearers = 0;
  while (true) {
    var b = data[pos];
    if (b & 0x80) childBearers++;
    pos++;
    if (b & 0x40) break;
  }
  for (var i = 0; i < childBearers; i++) {
    pos = skipGroup(data, pos);
  }
  return pos;
}

// Precompute root index
var rootIndex = new Array(26);
for (var i = 0; i < 26; i++) rootIndex[i] = null;

var pos = 0;
var rootSiblings = [];
while (true) {
  var b = buf[pos];
  rootSiblings.push({ letter: b & 0x1F, eow: !!(b & 0x20), hasChildren: !!(b & 0x80) });
  pos++;
  if (b & 0x40) break;
}

var cpos = pos;
for (var i = 0; i < rootSiblings.length; i++) {
  var s = rootSiblings[i];
  if (s.hasChildren) {
    rootIndex[s.letter] = { eow: s.eow, childrenPos: cpos, hasChildren: true };
    cpos = skipGroup(buf, cpos);
  } else {
    rootIndex[s.letter] = { eow: s.eow, childrenPos: -1, hasChildren: false };
  }
}

function lookupWord(word) {
  word = word.toLowerCase();
  if (!word) return false;

  var letter0 = word.charCodeAt(0) - 97;
  if (letter0 < 0 || letter0 > 25) return false;
  var info = rootIndex[letter0];
  if (!info) return false;
  if (word.length === 1) return info.eow;
  if (!info.hasChildren) return false;

  var pos = info.childrenPos;

  for (var i = 1; i < word.length; i++) {
    var target = word.charCodeAt(i) - 97;

    var found = false;
    var skipCount = 0;
    var targetHasChildren = false;
    var targetEow = false;
    var scanPos = pos;

    while (true) {
      var b = buf[scanPos];
      var letter = b & 0x1F;
      var hasChildren = !!(b & 0x80);
      var lastSib = !!(b & 0x40);
      var eow = !!(b & 0x20);

      if (letter === target) {
        found = true;
        targetHasChildren = hasChildren;
        targetEow = eow;
        scanPos++;
        if (!lastSib) {
          while (true) {
            var b2 = buf[scanPos];
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

    var nextPos = scanPos;
    for (var s = 0; s < skipCount; s++) {
      nextPos = skipGroup(buf, nextPos);
    }
    pos = nextPos;
  }

  return false;
}

// Spot check
var testWords = ['cat', 'dog', 'hello', 'world', 'aa', 'zyzzyva', 'xyz', 'qqq', 'abcdef'];
for (var i = 0; i < testWords.length; i++) {
  var w = testWords[i];
  var expected = words.indexOf(w) >= 0;
  var got = lookupWord(w);
  if (got !== expected) {
    console.error('VERIFY FAIL:', w, 'expected', expected, 'got', got);
    process.exit(1);
  }
}

// Full verification: check every word in the list
var failures = 0;
for (var i = 0; i < words.length; i++) {
  var w = words[i].trim().toLowerCase();
  if (!w) continue;
  if (!lookupWord(w)) {
    if (failures < 10) console.error('MISSING:', w);
    failures++;
  }
}
if (failures > 0) {
  console.error('VERIFY FAIL:', failures, 'words missing from trie');
  process.exit(1);
}
console.log('Verification passed: all', words.length, 'words found in trie');
