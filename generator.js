"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ============================================================
// Configuration
// ============================================================
const ROOT = __dirname;
const TARGET_COUNT = Number(process.env.TARGET_COUNT || 1000); // セット数（1セット＝7文）
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 3);
const MAX_RATE_LIMIT_RETRIES = Number(
  process.env.MAX_RATE_LIMIT_RETRIES || 8,
);
const MODEL_DELAY_MS = Number(process.env.MODEL_DELAY_MS || 3000);
const RATE_LIMIT_RETRY_MS = Number(
  process.env.RATE_LIMIT_RETRY_MS || 10000,
);
const MAX_RETRY_DELAY_MS = Number(process.env.MAX_RETRY_DELAY_MS || 60000);
const rawConcurrency = Number(process.env.CONCURRENCY);
const CONCURRENCY =
  Number.isFinite(rawConcurrency) && rawConcurrency >= 1
    ? Math.min(10, Math.floor(rawConcurrency))
    : 3;
const SENTENCES_PER_SET = 7;
let stopping = false;

// Providers: "auto" (rotate all configured models) | "mistral" | "groq" | "ollama"
const PROVIDER = (process.env.PROVIDER || "auto").toLowerCase();

function parseModelList(value, fallback) {
  const models = String(value || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return models.length > 0 ? models : fallback;
}

const MISTRAL_MODELS = parseModelList(
  process.env.MISTRAL_MODELS || process.env.MISTRAL_MODEL,
  ["ministral-8b-latest", "ministral-14b-latest"],
);
const GROQ_MODELS = parseModelList(
  process.env.GROQ_MODELS || process.env.GROQ_MODEL,
  ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"],
);
const GROQ_MAX_TOKENS = Number(process.env.GROQ_MAX_TOKENS || 4000);
// qwen has a low output-tokens-per-minute limit on Groq's free tier.
const GROQ_QWEN_MAX_TOKENS = Number(
  process.env.GROQ_QWEN_MAX_TOKENS || 950,
);
const GROQ_API_URL =
  process.env.GROQ_API_URL ||
  "https://api.groq.com/openai/v1/chat/completions";
const OLLAMA_MODELS = parseModelList(
  process.env.OLLAMA_MODELS || process.env.OLLAMA_MODEL,
  ["gpt-oss:120b", "gemma4:31b", "glm-5.3"],
);
const OLLAMA_MAX_TOKENS = Number(process.env.OLLAMA_MAX_TOKENS || 4000);
const OLLAMA_API_URL =
  process.env.OLLAMA_API_URL ||
  "https://ollama.com/v1/chat/completions";
// Difficulty: "standard" | "hard" (default: hard)
const DIFFICULTY = (process.env.DIFFICULTY || "hard").toLowerCase();

const DIFFICULTY_PROFILES = {
  standard: {
    label: "standard",
    guide: [
      "- Use everyday campus / public facility English.",
      "- Word count: easy 4-7, medium 7-10, hard 10-13.",
      "- Syllable target: easy about 7-9, medium about 11-14, hard about 15-18.",
      "- Keep most sentences to one clause; prioritize clear, simple announcements.",
      "- Do not use proper nouns (people, universities, brands, cities, or specific places); use generic campus terms instead.",
    ].join("\n"),
  },
  hard: {
    label: "hard",
    guide: [
      "- Match the real TOEFL 2026 Listen and Repeat length and complexity.",
      "- Word count: easy 5-8, medium 9-12, hard 12-16.",
      "- Syllable target: easy about 9-11, medium about 14-16, hard about 19-23.",
      "- Structure: easy = one short clause; medium = add a prepositional or dependent clause; hard = modifiers, lists, or dependent clauses.",
      "- Add concrete details such as numbers, times, locations, or conditions where natural.",
      "- Use precise campus / academic words where they fit naturally.",
      "- Avoid slang and rare words; every sentence must sound like a natural announcement.",
      "- Do not use proper nouns (people, universities, brands, cities, or specific places); use generic campus terms instead.",
      "- Keep every sentence comfortably speakable within its target_seconds.",
    ].join("\n"),
  },
};

// ============================================================
// File paths
// ============================================================
const ENV_FILE = path.join(ROOT, "env.json");
const TOPICS_FILE = path.join(ROOT, "topics.json");
const TYPES_FILE = path.join(ROOT, "types.json");
const PROMPT_FILE = path.join(ROOT, "generator.txt");
const OUTPUT_FILE = path.join(ROOT, "output.jsonl");
const ERROR_FILE = path.join(ROOT, "errors.log");

// ============================================================
// Load files
// ============================================================
function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Failed to load ${file}: ${error.message}`);
  }
}

const env = loadJSON(ENV_FILE);
const topics = loadJSON(TOPICS_FILE);
const types = loadJSON(TYPES_FILE);
const prompt = fs.readFileSync(PROMPT_FILE, "utf8").trim();

// API keys can come from env.json or environment variables
const mistralKey = env.mistral || process.env.MISTRAL_API_KEY || "";
const groqKey = env.groq || process.env.GROQ_API_KEY || "";
const ollamaKey = env.ollama || process.env.OLLAMA_API_KEY || "";

// Validate
const hasMistral =
  Boolean(mistralKey) && mistralKey !== "YOUR_MISTRAL_API_KEY_HERE";
const hasGroq = Boolean(groqKey) && groqKey !== "YOUR_GROQ_API_KEY_HERE";
const hasOllama =
  Boolean(ollamaKey) && ollamaKey !== "YOUR_OLLAMA_API_KEY_HERE";

if (!["auto", "mistral", "groq", "ollama"].includes(PROVIDER)) {
  throw new Error(
    `Unknown PROVIDER "${PROVIDER}". Use "auto", "mistral", "groq", or "ollama".`,
  );
}
if (PROVIDER === "mistral" && !hasMistral) {
  throw new Error(
    'PROVIDER=mistral requires a valid "mistral" key in env.json.',
  );
}
if (PROVIDER === "groq" && !hasGroq) {
  throw new Error(
    'PROVIDER=groq requires a valid "groq" key in env.json.',
  );
}
if (PROVIDER === "ollama" && !hasOllama) {
  throw new Error(
    'PROVIDER=ollama requires a valid "ollama" key in env.json or OLLAMA_API_KEY.',
  );
}
if (PROVIDER === "auto" && !hasMistral && !hasGroq && !hasOllama) {
  throw new Error(
    'env.json needs a valid "mistral", "groq", or "ollama" API key. Please set one first.',
  );
}
if (!Array.isArray(topics) || topics.length === 0) {
  throw new Error("topics.json must contain a non-empty array.");
}
if (!Array.isArray(types.easy) || types.easy.length === 0) {
  throw new Error('types.json["easy"] must contain a non-empty array.');
}
if (!Array.isArray(types.medium) || types.medium.length === 0) {
  throw new Error('types.json["medium"] must contain a non-empty array.');
}
if (!Array.isArray(types.hard) || types.hard.length === 0) {
  throw new Error('types.json["hard"] must contain a non-empty array.');
}
if (!DIFFICULTY_PROFILES[DIFFICULTY]) {
  throw new Error(
    `Unknown DIFFICULTY "${DIFFICULTY}". Use "standard" or "hard".`,
  );
}
const difficultyProfile = DIFFICULTY_PROFILES[DIFFICULTY];

// ============================================================
// Helpers
// ============================================================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sleep that wakes up early when Ctrl+C is pressed.
async function sleepWithStop(ms) {
  const end = Date.now() + ms;
  while (!stopping && Date.now() < end) {
    await sleep(Math.min(250, end - Date.now()));
  }
}

function getRetryAfterMs(error) {
  const direct = error?.retryAfter;
  if (direct != null) {
    const seconds = Number(direct);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  }
  const headers = error?.response?.headers ?? error?.headers;
  if (!headers) return null;
  const value =
    typeof headers.get === "function"
      ? headers.get("retry-after")
      : headers["retry-after"];
  if (value == null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null;
}

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function timestamp() {
  return new Date().toISOString();
}

function makeId() {
  return crypto.randomUUID();
}

function writeError(message) {
  fs.appendFileSync(ERROR_FILE, `[${timestamp()}] ${message}\n`, "utf8");
}

function log(message) {
  console.log(`[${timestamp()}] ${message}`);
}

// ============================================================
// Generation spec (1 set = 1 topic, 7 sentences)
// ============================================================
function generateSpec() {
  const topic = randomItem(topics);
  return { topic };
}

// ============================================================
// User prompt (asks for 7 sentences in one set)
// ============================================================
function buildUserPrompt(spec) {
  return `
Topic / scene: ${spec.topic}

Generate ONE set of 7 sentences for TOEFL Listen & Repeat matching the above topic.
All 7 sentences must relate to the same scene.

Difficulty level: ${difficultyProfile.label}
${difficultyProfile.guide}
`.trim();
}

// ============================================================
// JSON parsing (handles markdown fences)
// ============================================================
function parseModelJSON(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Model returned empty content.");
  }
  let cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("No JSON object found in model response.");
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

// ============================================================
// Validate generated item (expects 7 sentences)
// ============================================================
function validateItem(item, spec) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error("Model output is not an object.");
  }
  if (
    !Array.isArray(item.sentences) ||
    item.sentences.length !== SENTENCES_PER_SET
  ) {
    throw new Error(`Expected exactly ${SENTENCES_PER_SET} sentences.`);
  }

  const validatedSentences = item.sentences.map((s, index) => {
    if (typeof s.sentence !== "string" || !s.sentence.trim()) {
      throw new Error(`Sentence ${index + 1} is missing or invalid.`);
    }
    const sentence = s.sentence.trim();
    if (sentence.length > 400) {
      throw new Error(`Sentence ${index + 1} is too long.`);
    }
    return {
      sentence,
      difficulty: s.difficulty || "easy",
      target_seconds: s.target_seconds || 8,
      japanese_context: s.japanese_context || "",
    };
  });

  return {
    topic: item.topic || spec.topic,
    sentences: validatedSentences,
  };
}

// ============================================================
// Mistral request
// ============================================================
async function generateMistral(mistralClient, spec, model) {
  const response = await mistralClient.chat.complete({
    model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: buildUserPrompt(spec) },
    ],
    temperature: 0.8,
    maxTokens: 1200,
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Mistral returned empty content.");
  }

  let text;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((part) =>
        typeof part === "string"
          ? part
          : part && typeof part.text === "string"
            ? part.text
            : "",
      )
      .join("");
  } else {
    throw new Error("Unexpected Mistral content format.");
  }

  return validateItem(parseModelJSON(text), spec);
}

// ============================================================
// OpenAI-compatible requests (Groq / Ollama Cloud)
// ============================================================
async function generateOpenAICompatible({
  providerName,
  url,
  apiKey,
  spec,
  model,
  maxTokens,
}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: buildUserPrompt(spec) },
      ],
      temperature: 0.8,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(
      `${providerName} API error: Status ${response.status} ${body}`,
    );
    error.status = response.status;
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${providerName} returned empty content.`);
  }

  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              typeof part === "string"
                ? part
                : part && typeof part.text === "string"
                  ? part.text
                  : "",
            )
            .join("")
        : JSON.stringify(content);

  return validateItem(parseModelJSON(text), spec);
}

async function generateGroq(spec, model) {
  const maxTokens = model.startsWith("qwen/")
    ? GROQ_QWEN_MAX_TOKENS
    : GROQ_MAX_TOKENS;
  return generateOpenAICompatible({
    providerName: "Groq",
    url: GROQ_API_URL,
    apiKey: groqKey,
    spec,
    model,
    maxTokens,
  });
}

async function generateOllama(spec, model) {
  return generateOpenAICompatible({
    providerName: "Ollama",
    url: OLLAMA_API_URL,
    apiKey: ollamaKey,
    spec,
    model,
    maxTokens: OLLAMA_MAX_TOKENS,
  });
}

// ============================================================
// Retry logic
// ============================================================
const targetCooldowns = new Map();
const targetInFlight = new Set();

function targetKey(target) {
  return `${target.name}:${target.model}`;
}

function getTargetCooldown(target) {
  return targetCooldowns.get(targetKey(target)) ?? 0;
}

async function generateWithRetry(targets, spec, jobId) {
  let lastError = null;
  let attempt = 0;
  let normalFailures = 0;
  let rateLimitFailures = 0;

  while (true) {
    const now = Date.now();
    const available = targets.filter((t) => getTargetCooldown(t) <= now);

    if (available.length === 0) {
      const waitUntil = Math.min(
        ...targets.map((t) => getTargetCooldown(t)),
      );
      const wait = Math.max(0, waitUntil - now);
      log(`JOB=${jobId} ALL MODELS COOLING DOWN wait=${wait}ms`);
      await sleepWithStop(wait);
      if (stopping) throw new Error("Stopped by signal");
      continue;
    }

    const idle = available.filter((t) => !targetInFlight.has(targetKey(t)));
    const target = randomItem(idle.length > 0 ? idle : available);
    targetInFlight.add(targetKey(target));
    attempt++;
    const started = Date.now();
    log(
      `JOB=${jobId} ATTEMPT ${attempt} provider=${target.name} model=${target.model} ` +
        `(normal ${normalFailures}/${MAX_RETRIES}, 429 ${rateLimitFailures}/${MAX_RATE_LIMIT_RETRIES}) ` +
        `TOPIC=${spec.topic}`,
    );
    try {
      const result = await target.generate(spec);
      const latency = Date.now() - started;
      log(
        `JOB=${jobId} SUCCESS provider=${target.name} model=${target.model} latency=${latency}ms`,
      );
      return result;
    } catch (error) {
      lastError = error;
      const latency = Date.now() - started;
      const status =
        error?.status ??
        error?.response?.status ??
        error?.statusCode ??
        "unknown";
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimit = Number(status) === 429;

      log(
        `JOB=${jobId} ERROR provider=${target.name} model=${target.model} status=${status} latency=${latency}ms message=${message}`,
      );
      writeError(
        [
          `JOB=${jobId}`,
          `PROVIDER=${target.name}`,
          `MODEL=${target.model}`,
          `ATTEMPT=${attempt}`,
          `STATUS=${status}`,
          `TOPIC=${spec.topic}`,
          `LATENCY=${latency}ms`,
          `ERROR=${message}`,
        ].join(" "),
      );

      let cooldown;
      if (isRateLimit) {
        rateLimitFailures++;
        const backoff = Math.min(
          RATE_LIMIT_RETRY_MS * Math.pow(2, rateLimitFailures - 1),
          MAX_RETRY_DELAY_MS,
        );
        const retryAfter = getRetryAfterMs(error);
        cooldown = Math.max(backoff, retryAfter ?? 0);
        cooldown += Math.floor(Math.random() * 1000);
        log(
          `JOB=${jobId} ${target.name.toUpperCase()}/${target.model} RATE LIMITED cooldown=${cooldown}ms`,
        );

        if (rateLimitFailures > MAX_RATE_LIMIT_RETRIES) break;
      } else {
        normalFailures++;
        cooldown =
          Math.min(500 * Math.pow(2, normalFailures - 1), MAX_RETRY_DELAY_MS) +
          Math.floor(Math.random() * 1000);
        log(
          `JOB=${jobId} ${target.name.toUpperCase()}/${target.model} ERROR cooldown=${cooldown}ms`,
        );

        if (normalFailures >= MAX_RETRIES) break;
      }

      targetCooldowns.set(targetKey(target), Date.now() + cooldown);
      // 他のモデルが使えれば、待たずに次へ切り替える
      continue;
    } finally {
      targetInFlight.delete(targetKey(target));
    }
  }
  throw lastError;
}

// ============================================================
// Resume support (read existing output.jsonl)
// ============================================================
function getExistingRecords() {
  if (!fs.existsSync(OUTPUT_FILE)) {
    return [];
  }
  const content = fs.readFileSync(OUTPUT_FILE, "utf8");
  const records = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      if (record && Array.isArray(record.sentences)) {
        records.push(record);
      }
    } catch {
      // ignore malformed lines
    }
  }
  return records;
}

// ============================================================
// Statistics
// ============================================================
function printSummary(initialCount, completed, failed, startTime) {
  const elapsed = (Date.now() - startTime) / 1000;
  const generatedSets = completed - initialCount;
  const generatedSentences = generatedSets * SENTENCES_PER_SET;
  const rate = generatedSets / Math.max(elapsed, 0.001);
  const remaining = Math.max(TARGET_COUNT - completed, 0);
  log("============================================================");
  log(
    `PROGRESS ${completed}/${TARGET_COUNT} sets | remaining=${remaining} sets | ` +
      `generated_this_run=${generatedSets} sets (${generatedSentences} sentences) | ` +
      `failed=${failed} | rate=${rate.toFixed(2)} sets/s`,
  );
  log(`ELAPSED ${elapsed.toFixed(1)}s`);
  log("============================================================");
}

// ============================================================
// Main
// ============================================================
async function main() {
  // Dynamic import for ESM module (@mistralai/mistralai)
  const { Mistral } = await import("@mistralai/mistralai");
  const mistralClient = hasMistral
    ? new Mistral({ apiKey: mistralKey })
    : null;

  const targets = [];
  const useMistral =
    PROVIDER === "mistral" || (PROVIDER === "auto" && hasMistral);
  const useGroq = PROVIDER === "groq" || (PROVIDER === "auto" && hasGroq);
  const useOllama =
    PROVIDER === "ollama" || (PROVIDER === "auto" && hasOllama);

  if (useMistral) {
    for (const model of MISTRAL_MODELS) {
      targets.push({
        name: "mistral",
        model,
        generate: (spec) => generateMistral(mistralClient, spec, model),
      });
    }
  }
  if (useGroq) {
    for (const model of GROQ_MODELS) {
      targets.push({
        name: "groq",
        model,
        generate: (spec) => generateGroq(spec, model),
      });
    }
  }
  if (useOllama) {
    for (const model of OLLAMA_MODELS) {
      targets.push({
        name: "ollama",
        model,
        generate: (spec) => generateOllama(spec, model),
      });
    }
  }
  if (targets.length === 0) {
    throw new Error("No models configured. Check env.json and PROVIDER.");
  }

  // Resume
  const existing = getExistingRecords();
  const initialCount = existing.length;

  if (initialCount >= TARGET_COUNT) {
    log(`Already complete: ${initialCount}/${TARGET_COUNT} sets`);
    return;
  }

  const remaining = TARGET_COUNT - initialCount;
  log("============================================================");
  log("TOEFL Listen & Repeat Set Generator (Mistral / Groq / Ollama)");
  log("============================================================");
  log(
    `Target       : ${TARGET_COUNT} sets (${TARGET_COUNT * SENTENCES_PER_SET} sentences)`,
  );
  log(`Existing     : ${initialCount} sets`);
  log(`Remaining    : ${remaining} sets`);
  log(`Provider mode: ${PROVIDER}`);
  log(
    `Mistral models: ${useMistral ? MISTRAL_MODELS.join(", ") : "(disabled)"}`,
  );
  log(
    `Groq models   : ${useGroq ? GROQ_MODELS.join(", ") : "(disabled)"}`,
  );
  log(
    `Ollama models : ${useOllama ? OLLAMA_MODELS.join(", ") : "(disabled)"}`,
  );
  log(`Difficulty   : ${difficultyProfile.label}`);
  log(`Sentences/set: ${SENTENCES_PER_SET}`);
  log(`Concurrency  : ${CONCURRENCY}`);
  log(`Delay        : ${MODEL_DELAY_MS}ms`);
  log(
    `429 retry    : base=${RATE_LIMIT_RETRY_MS}ms, max=${MAX_RATE_LIMIT_RETRIES}回, cap=${MAX_RETRY_DELAY_MS}ms`,
  );
  log("============================================================");

  let nextJob = 0;
  let completed = initialCount;
  let failed = 0;
  const startTime = Date.now();

  function saveRecord(record) {
    fs.appendFileSync(OUTPUT_FILE, JSON.stringify(record) + "\n", "utf8");
  }

  async function runWorker(workerId) {
    while (!stopping) {
      const jobIndex = nextJob++;
      if (jobIndex >= remaining) return;

      const jobId = initialCount + jobIndex + 1;
      const spec = generateSpec();
      log(`JOB=${jobId} START topic=${spec.topic} worker=${workerId}`);

      try {
        const result = await generateWithRetry(targets, spec, jobId);
        const record = {
          id: makeId(),
          generatedAt: timestamp(),
          topic: result.topic,
          sentence_count: result.sentences.length,
          sentences: result.sentences,
        };
        saveRecord(record);
        completed++;
        log(
          `JOB=${jobId} SAVED progress=${completed}/${TARGET_COUNT} sets worker=${workerId}`,
        );
      } catch (error) {
        if (stopping) {
          log(`JOB=${jobId} CANCELLED by signal`);
          return;
        }
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        log(`JOB=${jobId} FINAL FAILURE ${message}`);
        writeError(
          [
            "FINAL_FAILURE",
            `JOB=${jobId}`,
            `TOPIC=${spec.topic}`,
            `ERROR=${message}`,
          ].join(" "),
        );
      }

      const totalProcessed = completed - initialCount + failed;
      if (totalProcessed % 10 === 0) {
        printSummary(initialCount, completed, failed, startTime);
      }

      if (!stopping) {
        await sleepWithStop(
          MODEL_DELAY_MS + Math.floor(Math.random() * 1000),
        );
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, remaining);
  log(`Starting ${workerCount} parallel worker(s)`);
  await Promise.all(
    Array.from({ length: workerCount }, (_, index) => runWorker(index + 1)),
  );

  if (stopping) {
    log("STOPPED by signal. Re-run to resume remaining jobs.");
  } else {
    log("ALL JOBS DONE");
  }

  printSummary(initialCount, completed, failed, startTime);
  log("GENERATION FINISHED");
  log(
    `Final count: ${completed}/${TARGET_COUNT} sets (${completed * SENTENCES_PER_SET} sentences)`,
  );
}

// Graceful shutdown
function requestStop(signal) {
  if (stopping) {
    console.log("");
    log(`${signal} received again. Exiting immediately.`);
    process.exit(1);
  }
  stopping = true;
  console.log("");
  log(`${signal} received. Finishing in-flight jobs...`);
  log("Press Ctrl+C again to force exit.");
  log("output.jsonl has been preserved. Re-run to resume.");
}

process.on("SIGINT", () => requestStop("SIGINT"));
process.on("SIGTERM", () => requestStop("SIGTERM"));

main().catch((error) => {
  console.error("");
  console.error(`[${timestamp()}] FATAL ERROR`);
  console.error(error);
  process.exit(1);
});
