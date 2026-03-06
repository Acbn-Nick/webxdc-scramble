// dict.js - Word dictionary loaded from word list

import wordData from './words.txt?raw';

var wordSet = null;

function ensureLoaded() {
  if (!wordSet) {
    wordSet = new Set(wordData.trim().split('\n'));
  }
}

export function isValidWord(word) {
  ensureLoaded();
  return wordSet.has(word.toLowerCase());
}
