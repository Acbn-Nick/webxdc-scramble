// build-dawg.js — Compile words.txt into a packed binary DAWG (dict.bin)
//
// Node encoding (3 bytes = 24 bits per node):
//   bits 0-4:   letter (a=0 .. z=25)
//   bit 5:      end-of-word flag
//   bit 6:      last-sibling flag
//   bits 7-23:  first-child index (17 bits, max 131071)

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

// --- Minimize trie (share identical subtrees) ---

var sigMap = new Map(); // signature string -> canonical node

function signature(node) {
  if (node._sig !== undefined) return node._sig;
  var keys = Object.keys(node.children).sort();
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    parts.push(keys[i] + signature(node.children[keys[i]]));
  }
  node._sig = (node.end ? '!' : '') + '(' + parts.join(',') + ')';
  return node._sig;
}

function minimize(node) {
  var keys = Object.keys(node.children);
  for (var i = 0; i < keys.length; i++) {
    var child = node.children[keys[i]];
    minimize(child);
    var sig = signature(child);
    if (sigMap.has(sig)) {
      node.children[keys[i]] = sigMap.get(sig);
    } else {
      sigMap.set(sig, child);
    }
  }
}

minimize(root);

// --- Flatten into array ---
// Each node group = sorted children of a parent.
// Root node at index 0 is a virtual node whose children are root.children.

var nodes = []; // [{letter, end, lastSibling, firstChild}]
var nodeIndex = new Map(); // node object -> assigned index of first child group start

// BFS to assign indices: first pass counts, second pass encodes
// We need to assign each unique node an index for its children group.

// Collect all unique nodes reachable from root
var uniqueNodes = new Set();

function collectUnique(node) {
  if (uniqueNodes.has(node)) return;
  uniqueNodes.add(node);
  var keys = Object.keys(node.children).sort();
  for (var i = 0; i < keys.length; i++) {
    collectUnique(node.children[keys[i]]);
  }
}
collectUnique(root);
console.log('Unique DAWG nodes:', uniqueNodes.size);

// BFS assign indices
// Index 0 = root (virtual). Root's children start at index 1.
// For each node, its children form a contiguous block.

var flatNodes = []; // will hold {letter, end, lastSibling, firstChildIndex}
// Index 0 is the root virtual node
flatNodes.push({ letter: 0, end: false, lastSibling: true, firstChildIndex: 0 });

var queue = [root];
var childGroupIndex = new Map(); // node -> index where its children start
// We need to process by assigning children groups

var nextIndex = 1; // next available slot

// First, assign where root's children go
var rootKeys = Object.keys(root.children).sort();
if (rootKeys.length > 0) {
  flatNodes[0].firstChildIndex = nextIndex;
  // Reserve slots for root's children
  for (var i = 0; i < rootKeys.length; i++) {
    flatNodes.push(null); // placeholder
  }
  nextIndex += rootKeys.length;
}

// BFS queue: each entry is {parentSlotStart, keys, parentNode}
var bfsQueue = [];
if (rootKeys.length > 0) {
  bfsQueue.push({ slotStart: 1, keys: rootKeys, parent: root });
}

// Track which child groups we've already assigned (by node identity)
var assignedChildGroup = new Map(); // node -> firstChildIndex

var head = 0;
while (head < bfsQueue.length) {
  var item = bfsQueue[head++];
  var slotStart = item.slotStart;
  var keys = item.keys;
  var parent = item.parent;

  for (var i = 0; i < keys.length; i++) {
    var ch = keys[i];
    var child = parent.children[ch];
    var letterIdx = ch.charCodeAt(0) - 97;
    var childKeys = Object.keys(child.children).sort();
    var firstChildIndex = 0;

    if (childKeys.length > 0) {
      if (assignedChildGroup.has(child)) {
        firstChildIndex = assignedChildGroup.get(child);
      } else {
        firstChildIndex = nextIndex;
        assignedChildGroup.set(child, firstChildIndex);
        for (var k = 0; k < childKeys.length; k++) {
          flatNodes.push(null); // placeholder
        }
        nextIndex += childKeys.length;
        bfsQueue.push({ slotStart: firstChildIndex, keys: childKeys, parent: child });
      }
    }

    flatNodes[slotStart + i] = {
      letter: letterIdx,
      end: child.end,
      lastSibling: (i === keys.length - 1),
      firstChildIndex: firstChildIndex,
    };
  }
}

console.log('Flat nodes:', flatNodes.length);

if (flatNodes.length > 131071) {
  console.error('ERROR: Too many nodes for 17-bit index! Got', flatNodes.length);
  process.exit(1);
}

// --- Encode to binary ---
var buf = new Uint8Array(flatNodes.length * 3);
for (var i = 0; i < flatNodes.length; i++) {
  var n = flatNodes[i];
  var packed = (n.letter & 0x1F)
    | (n.end ? 0x20 : 0)
    | (n.lastSibling ? 0x40 : 0)
    | ((n.firstChildIndex & 0x1FFFF) << 7);
  var off = i * 3;
  buf[off] = packed & 0xFF;
  buf[off + 1] = (packed >>> 8) & 0xFF;
  buf[off + 2] = (packed >>> 16) & 0xFF;
}

writeFileSync(outPath, buf);
console.log('Wrote', outPath, '(' + buf.length + ' bytes, ' + flatNodes.length + ' nodes)');

// --- Verify ---
function lookupWord(word) {
  word = word.toLowerCase();
  var off0 = 0;
  var n0 = buf[off0] | (buf[off0 + 1] << 8) | (buf[off0 + 2] << 16);
  var ci = n0 >>> 7;
  for (var i = 0; i < word.length; i++) {
    if (!ci) return false;
    var target = word.charCodeAt(i) - 97;
    while (true) {
      var off = ci * 3;
      var n = buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16);
      if ((n & 0x1F) === target) {
        if (i === word.length - 1) return !!(n & 0x20);
        ci = n >>> 7;
        break;
      }
      if (n & 0x40) return false;
      ci++;
    }
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
  console.error('VERIFY FAIL:', failures, 'words missing from DAWG');
  process.exit(1);
}
console.log('Verification passed: all', words.length, 'words found in DAWG');
