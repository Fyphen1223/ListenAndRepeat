"use strict";

const fs = require("fs");
const path = require("path");
const wordnet = require("wordnet-db");

const root = __dirname;
const outputPath = path.join(root, "output.jsonl");
const destination = path.join(root, "vendor", "wordnet-synonyms.json");
const sourceWords = new Set();
const posFiles = { noun: "index.noun", verb: "index.verb", adjective: "index.adj", adverb: "index.adv" };
const dataFiles = { noun: "data.noun", verb: "data.verb", adjective: "data.adj", adverb: "data.adv" };

function normalize(word) {
  return String(word || "").toLowerCase().replace(/_/g, " ").replace(/[^\w\s'-]/g, "").trim();
}

for (const line of fs.readFileSync(outputPath, "utf8").split(/\r?\n/).filter(Boolean)) {
  const set = JSON.parse(line);
  for (const sentence of set.sentences || []) {
    for (const word of String(sentence.sentence || "").split(/\s+/)) {
      const value = normalize(word);
      if (value && !value.includes(" ")) sourceWords.add(value);
    }
  }
}

function indexEntries(filePath) {
  const entries = new Map();
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith(" ")) continue;
    const fields = line.trim().split(/\s+/);
    const lemma = normalize(fields[0]);
    if (lemma && sourceWords.has(lemma)) {
      const pointerCountIndex = 3;
      const pointerCount = Number(fields[pointerCountIndex]);
      const offsetStart = pointerCountIndex + 3 + pointerCount;
      entries.set(lemma, fields.slice(offsetStart, offsetStart + Number(fields[2])));
    }
  }
  return entries;
}

function dataSynsets(filePath) {
  const synsets = new Map();
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!/^\d{8}\s/.test(line)) continue;
    const [record] = line.split("|");
    const fields = record.trim().split(/\s+/);
    const offset = fields[0];
    const wordCount = Number.parseInt(fields[3], 16);
    if (!Number.isFinite(wordCount)) continue;
    const words = [];
    for (let index = 0; index < wordCount; index++) {
      words.push(normalize(fields[4 + index * 2]));
    }
    synsets.set(offset.trim(), words.filter((word) => word && !word.includes(" ")));
  }
  return synsets;
}

const result = {};
for (const [pos, indexName] of Object.entries(posFiles)) {
  const entries = indexEntries(path.join(wordnet.path, indexName));
  const synsets = dataSynsets(path.join(wordnet.path, dataFiles[pos]));
  for (const [word, offsets] of entries) {
    const alternatives = new Set(result[`${pos}:${word}`] || []);
    for (const offset of offsets) {
      for (const alternative of synsets.get(offset) || []) {
        if (alternative !== word) alternatives.add(alternative);
      }
    }
    if (alternatives.size) result[`${pos}:${word}`] = [...alternatives].slice(0, 12);
  }
}

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${JSON.stringify(result)}\n`);
console.log(`Generated ${Object.keys(result).length} WordNet entries at ${destination}`);
