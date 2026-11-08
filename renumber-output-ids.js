"use strict";

const fs = require("fs");
const path = require("path");

const inputFile = path.join(__dirname, "output.jsonl");
const tempFile = `${inputFile}.tmp`;

const lines = fs
  .readFileSync(inputFile, "utf8")
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0);

const renumberedLines = lines.map((line, index) => {
  let record;

  try {
    record = JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`);
  }

  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`Line ${index + 1} must contain a JSON object.`);
  }

  record.id = index + 1;
  return JSON.stringify(record);
});

fs.writeFileSync(tempFile, `${renumberedLines.join("\n")}\n`, "utf8");
fs.renameSync(tempFile, inputFile);

console.log(`Renumbered ${renumberedLines.length} records in output.jsonl.`);
