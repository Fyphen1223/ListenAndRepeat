"use strict";

const STORAGE_KEY = "toefl_listen_repeat_v2";
const state = {
  sets: [], questions: [], setIndex: 0, sentenceIndex: 0,
  timer: null, responseTimer: null, responseSeconds: 0, responseStartedAt: 0,
  recognition: null, recording: false, audioPlayed: false, answered: false, timedOut: false,
  recognitionConfidence: null,
  recognitionConfidenceSamples: [], transcriptParts: [], stopRequested: false,
  mediaRecorder: null, mediaStream: null, recordedChunks: [], userAudioUrl: null,
  audioResultTarget: null,
  autoAdvanceTimer: null, examStarted: false, responsePending: false,
  results: [],
  endShown: false,
};

const $ = (id) => document.getElementById(id);
const els = {
  loading: $("loading"), quiz: $("quiz-screen"), empty: $("empty-screen"), end: $("end-screen"),
  counter: $("q-counter"), sentenceCounter: $("sentence-counter"), topic: $("badge-topic"),
  questionId: $("badge-id"), questionIdInput: $("question-id-input"), jumpId: $("btn-jump-id"),
  jumpStatus: $("jump-status"),
  difficulty: $("badge-difficulty"), topicTitle: $("topic-title"), context: $("context-text"),
  sceneLocation: $("scene-location"), progressLabel: $("progress-label"), progress: $("scenario-progress"),
  sceneIllustration: $("scene-illustration"),
  progressCaption: $("progress-caption"), targetTime: $("target-time"), audio: $("audio-player"),
  start: $("btn-start"), play: $("btn-play"), listenStatus: $("listen-status"), responseCountdown: $("response-countdown"),
  record: $("btn-record"), recordingStatus: $("recording-status"), transcript: $("transcript"),
  feedback: $("feedback-panel"), feedbackHeader: $("feedback-header"), feedbackBody: $("feedback-body"),
  next: $("btn-next"), skip: $("btn-skip"), showAnswer: $("btn-show-answer"),
  timer: $("timer-display"), finalStats: $("final-stats"), setResults: $("set-results"),
  browserWarning: $("browser-warning"),
};

function stored() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return data && Array.isArray(data.attempts) ? data : { attempts: [] };
  } catch {
    return { attempts: [] };
  }
}

function currentSet() { return state.questions[state.setIndex]; }
function currentSentence() { return currentSet().sentences[state.sentenceIndex]; }
function mode() { return $("filter-mode").value; }

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

function sceneIllustration(topic, step) {
  const name = String(topic || "").toLowerCase();
  const isLibrary = name.includes("library");
  const isFood = name.includes("café") || name.includes("cafe") || name.includes("dining");
  const isTransport = name.includes("bus");
  const isSport = /fitness|pool|tennis/.test(name);
  const isOffice = /office|center|registrar|admissions|bookstore/.test(name);
  const title = isLibrary ? "LIBRARY" : isFood ? "CAMPUS DINING" : isTransport ? "BUS STOP" :
    isSport ? "CAMPUS SPORTS" : isOffice ? "CAMPUS OFFICE" : "CAMPUS SCENE";
  const object = isLibrary
    ? `<rect class="scene-building" x="24" y="42" width="152" height="86" rx="4"/><path class="scene-roof" d="M18 45h164l-12-18H30z"/><rect class="scene-door" x="91" y="91" width="22" height="37" rx="2"/><path class="scene-window" d="M38 61h26v19H38zm40 0h26v19H78zm40 0h26v19h-26z"/><path class="scene-shelf" d="M39 101h38m-38 8h38m45-8h38m-38 8h38"/>`
    : isFood
      ? `<rect class="scene-building" x="25" y="48" width="150" height="80" rx="5"/><path class="scene-roof" d="M25 48h150v17H25z"/><text class="scene-sign" x="67" y="60">CAFÉ</text><rect class="scene-counter" x="42" y="91" width="112" height="14" rx="3"/><circle class="scene-plate" cx="60" cy="84" r="7"/><circle class="scene-plate" cx="89" cy="84" r="7"/><path class="scene-steam" d="M126 85q-5-8 1-13m8 13q-5-8 1-13"/>`
      : isTransport
        ? `<path class="scene-road" d="M0 125h200v45H0z"/><rect class="scene-building" x="24" y="50" width="44" height="78" rx="3"/><path class="scene-roof" d="M18 52h56l-7-12H25z"/><rect class="scene-bus" x="76" y="62" width="105" height="58" rx="12"/><path class="scene-window" d="M88 74h24v18H88zm31 0h24v18h-24zm31 0h12v18h-12z"/><circle class="scene-wheel" cx="101" cy="121" r="9"/><circle class="scene-wheel" cx="158" cy="121" r="9"/><text class="scene-sign" x="35" y="88">BUS</text>`
        : isSport
          ? `<rect class="scene-building" x="24" y="48" width="152" height="80" rx="5"/><path class="scene-roof" d="M24 48h152v14H24z"/><circle class="scene-sport" cx="101" cy="91" r="27"/><path class="scene-line" d="M74 91h54M101 64v54"/><circle class="scene-ball" cx="147" cy="105" r="7"/>`
          : `<rect class="scene-building" x="24" y="45" width="152" height="83" rx="5"/><path class="scene-roof" d="M24 45h152v16H24z"/><text class="scene-sign" x="63" y="57">WELCOME</text><path class="scene-window" d="M40 73h34v25H40zm51 0h34v25H91zm51 0h18v25h-18z"/><rect class="scene-door" x="80" y="101" width="22" height="27" rx="2"/>`;
  const highlights = Array.from({ length: 7 }, (_, index) => {
    const active = index === step;
    return `<circle class="scene-marker ${active ? "active" : ""}" cx="${28 + index * 25}" cy="145" r="${active ? 7 : 4}"><title>Sentence ${index + 1}</title></circle>`;
  }).join("");
  return `<svg class="scenario-svg" viewBox="0 0 200 170" role="img" aria-label="${title} illustration">
    <defs><linearGradient id="scene-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dff2ff"/><stop offset="1" stop-color="#f8fbff"/></linearGradient></defs>
    <rect class="scene-sky" x="0" y="0" width="200" height="170" rx="8"/>
    <circle class="scene-sun" cx="171" cy="25" r="11"/>
    <path class="scene-cloud" d="M20 30q4-9 12 0q7-11 15 0h-27zm105 5q4-8 11 0q7-10 14 0h-25z"/>
    <text class="scene-title" x="12" y="21">${title}</text>
    <path class="scene-ground" d="M0 128h200v42H0z"/>
    ${object}
    <circle class="scene-person-head" cx="184" cy="96" r="7"/><path class="scene-person" d="M184 103v20m-9-10h18m-6 10-5 14m5-14 5 14"/>
    ${highlights}
  </svg>`;
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^\w\s']/g, "").replace(/\s+/g, " ").trim();
}

function analyzedTokens(text) {
  const source = String(text || "");
  if (typeof window.nlp !== "function") {
    return normalize(source).split(" ").filter(Boolean).map((word) => ({
      word,
      isContent: !functionWords.has(word),
    }));
  }
  return window.nlp(source).terms().data().flatMap((term) => term.terms.map((item) => ({
    word: item.normal || normalize(item.text),
    isContent: item.tags.some((tag) => ["Noun", "Verb", "Adjective", "Adverb"].includes(tag)),
  }))).filter((item) => item.word);
}

function wordSimilarity(target, actual) {
  const expected = analyzedTokens(target).map((token) => token.word);
  const heard = analyzedTokens(actual).map((token) => token.word);
  if (!expected.length || !heard.length) return 0;
  const matrix = Array.from({ length: expected.length + 1 }, () => new Array(heard.length + 1).fill(0));
  for (let i = 1; i <= expected.length; i++) {
    for (let j = 1; j <= heard.length; j++) {
      matrix[i][j] = expected[i - 1] === heard[j - 1]
        ? matrix[i - 1][j - 1] + 1
        : Math.max(matrix[i - 1][j], matrix[i][j - 1]);
    }
  }
  return Math.round((matrix[expected.length][heard.length] / expected.length) * 100);
}

const functionWords = new Set(
  "a an the and or but so if because as at by for from in into of on onto to with without about after before during over under up down is am are was were be been being do does did have has had can could may might must shall should will would this that these those it its i you he she we they".split(" "),
);

function rubricMetrics(target, actual) {
  const expectedTokens = analyzedTokens(target);
  const heardTokens = analyzedTokens(actual);
  const expected = expectedTokens.map((token) => token.word);
  const heard = heardTokens.map((token) => token.word);
  const expectedContent = expectedTokens.filter((token) => token.isContent).map((token) => token.word);
  const heardSet = new Set(heardTokens.map((token) => token.word));
  const contentCoverage = expectedContent.length
    ? Math.round((expectedContent.filter((word) => heardSet.has(word)).length / expectedContent.length) * 100)
    : 0;
  const expectedFunction = expectedTokens.filter((token) => !token.isContent).map((token) => token.word);
  const functionAccuracy = expectedFunction.length
    ? Math.round((expectedFunction.filter((word) => heardSet.has(word)).length / expectedFunction.length) * 100)
    : 100;
  const orderAccuracy = expected.length && heard.length
    ? Math.round((longestCommonSubsequence(expected, heard) / expected.length) * 100)
    : 0;
  return {
    exact: normalize(target) === normalize(actual),
    contentCoverage,
    functionAccuracy,
    orderAccuracy,
  };
}

function longestCommonSubsequence(left, right) {
  const matrix = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      matrix[i][j] = left[i - 1] === right[j - 1]
        ? matrix[i - 1][j - 1] + 1
        : Math.max(matrix[i - 1][j], matrix[i][j - 1]);
    }
  }
  return matrix[left.length][right.length];
}

function estimateBand(metrics, transcript) {
  if (!transcript.trim() || metrics.contentCoverage === 0) return 0;
  if (metrics.exact) return 5;
  if (metrics.contentCoverage >= 90 && metrics.orderAccuracy >= 80 &&
      metrics.functionAccuracy >= 70) return 4;
  if (metrics.contentCoverage >= 60 && metrics.orderAccuracy >= 55) return 3;
  if (metrics.contentCoverage >= 35) return 2;
  return 1;
}

function saveAttempt(sentence, transcript, score, band, confidence = null, combinedScore = score, skipped = false, metrics = null) {
  const data = stored();
  data.attempts.unshift({
    id: currentSet().id, sentenceIndex: state.sentenceIndex, topic: currentSet().topic,
    target: sentence.sentence, transcript, similarity: score, confidence,
    combinedScore, estimatedBand: band, rubricMetrics: metrics,
    skipped, timestamp: new Date().toISOString(),
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

async function init() {
  try {
    const response = await fetch("./output.jsonl");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.sets = (await response.text()).split(/\r?\n/).filter(Boolean).map(JSON.parse)
      .filter((set) => Array.isArray(set.sentences) && set.sentences.length === 7);
    if (!state.sets.length) throw new Error("7文セットが見つかりません。");
    applyFilters();
    els.loading.classList.add("hidden");
  } catch (error) {
    els.loading.innerHTML = `<div class="error-box"><strong>問題を読み込めませんでした。</strong><br>ローカルサーバー経由で開き、output.jsonl を確認してください。<br><small>${error.message}</small></div>`;
  }
}

function applyFilters() {
  stopAllTimers();
  const difficulty = $("filter-difficulty").value;
  const selectedMode = mode();
  const data = stored();
  let filtered = state.sets.filter((set) => difficulty === "all" || set.sentences.some((s) => s.difficulty === difficulty));
  const attempts = new Set(data.attempts.map((a) => `${a.id}-${a.sentenceIndex}`));
  if (selectedMode === "review") {
    const mistakes = new Set(data.attempts.filter((a) => a.estimatedBand < 4 || a.similarity < 88).map((a) => `${a.id}-${a.sentenceIndex}`));
    filtered = filtered.filter((set) => set.sentences.some((_, index) => mistakes.has(`${set.id}-${index}`)));
  } else if (selectedMode === "unsolved") {
    const unsolved = filtered.filter((set) => !attempts.has(`${set.id}-0`));
    const solved = filtered.filter((set) => attempts.has(`${set.id}-0`));
    filtered = [...shuffle(unsolved), ...shuffle(solved)];
  } else {
    filtered = shuffle(filtered);
  }
  if (selectedMode === "exam") filtered = filtered.slice(0, 1);
  state.questions = filtered;
  state.setIndex = 0;
  state.sentenceIndex = 0;
  state.results = [];
  state.endShown = false;
  if (!filtered.length) {
    els.quiz.classList.add("hidden"); els.end.classList.add("hidden"); els.empty.classList.remove("hidden");
  } else {
    els.empty.classList.add("hidden"); els.end.classList.add("hidden"); els.quiz.classList.remove("hidden"); render();
  }
}

function render() {
  clearTimeout(state.autoAdvanceTimer);
  if (!els.audio.paused) els.audio.pause();
  els.audio.currentTime = 0;
  stopMediaRecorder();
  if (state.recognition) {
    state.stopRequested = true;
    state.recognition.stop();
    state.recognition = null;
  }
  state.recording = false;
  const set = currentSet();
  const sentence = currentSentence();
  const maxSeconds = Math.max(8, Math.min(12, Number(sentence.target_seconds) || 10));
  const location = ["場面の入口", "案内カウンター", "主要な設備", "利用エリア", "掲示・案内", "サービス窓口", "場面の出口"][state.sentenceIndex];
  els.counter.textContent = `Set ${state.setIndex + 1} / ${state.questions.length}`;
  els.sentenceCounter.textContent = `Sentence ${state.sentenceIndex + 1} / 7`;
  els.topic.textContent = `Topic: ${set.topic || "-"}`;
  els.questionId.textContent = `ID: ${set.id}`;
  els.difficulty.textContent = `Difficulty: ${sentence.difficulty || "medium"}`;
  els.topicTitle.textContent = set.topic || "Campus situation";
  els.context.textContent = sentence.japanese_context || "キャンパス内の場面を説明する英文です。";
  els.sceneLocation.textContent = `現在地: ${location}`;
  els.sceneIllustration.innerHTML = sceneIllustration(set.topic, state.sentenceIndex);
  els.progressLabel.textContent = `${state.sentenceIndex + 1} / 7`;
  els.progress.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const step = document.createElement("span");
    step.className = `progress-step ${i < state.sentenceIndex ? "done" : ""} ${i === state.sentenceIndex ? "current" : ""}`;
    step.textContent = i + 1;
    step.setAttribute("aria-label", `Sentence ${i + 1}`);
    els.progress.appendChild(step);
  }

  els.progressCaption.textContent = state.sentenceIndex === 0
    ? "この場面の最初の文です。"
    : state.sentenceIndex === 6 ? "最後の文です。聞こえた通りに再現しましょう。" : "場面の次の場所へ進みます。";
  els.targetTime.textContent = `最大 ${maxSeconds} 秒`;
  els.audio.src = `./audio/${encodeURIComponent(set.id)}/${encodeURIComponent(set.id)}-${state.sentenceIndex + 1}.wav`;
  els.audio.load();
  state.audioPlayed = false; state.answered = false; state.timedOut = false;
  state.responsePending = false; state.recognitionConfidence = null;
  state.recognitionConfidenceSamples = []; state.transcriptParts = []; state.stopRequested = false;
  state.responseSeconds = maxSeconds;
  state.examStarted = false;
  els.responseCountdown.textContent = `${maxSeconds}s`;
  els.transcript.textContent = "音声を聞いてから録音してください。";
  els.listenStatus.textContent = mode() === "practice" ? "音声を再生してください。" : "「問題をスタート」を押すと自動で進行します。";
  els.feedback.className = "feedback-panel hidden";
  els.next.classList.add("hidden"); els.showAnswer.classList.add("hidden");
  els.record.disabled = true; els.skip.disabled = false;
  els.start.classList.toggle("hidden", mode() !== "exam");
  els.play.classList.toggle("hidden", mode() === "exam");
  els.play.disabled = false; els.play.innerHTML = '<i class="fa-solid fa-volume-high"></i><span>音声を再生</span>';
  els.recordingStatus.innerHTML = '<i class="fa-solid fa-microphone"></i> 待機中';
  startTimer();
}

function jumpToQuestionId() {
  const requestedId = els.questionIdInput.value.trim();
  const target = state.sets.find((set) => String(set.id) === requestedId);
  if (!requestedId || !target) {
    els.jumpStatus.textContent = "該当するIDがありません";
    els.jumpStatus.className = "jump-status error";
    return;
  }
  stopAllTimers();
  state.questions = [target];
  state.setIndex = 0;
  state.sentenceIndex = 0;
  state.results = [];
  state.endShown = false;
  els.questionIdInput.value = String(target.id);
  els.jumpStatus.textContent = `ID ${target.id} を表示中`;
  els.jumpStatus.className = "jump-status success";
  els.empty.classList.add("hidden");
  els.end.classList.add("hidden");
  els.quiz.classList.remove("hidden");
  render();
}

function playAudio() {
  if (state.audioPlayed || !els.audio.paused) return;
  state.audioPlayed = true;
  els.play.disabled = mode() === "exam";
  els.play.innerHTML = '<i class="fa-solid fa-volume-high"></i><span>再生中...</span>';
  els.listenStatus.textContent = "再生中...";
  els.audio.pause();
  els.audio.currentTime = 0;
  const playback = els.audio.play();
  playback.catch(() => {
    state.audioPlayed = false;
    els.listenStatus.textContent = "音声を再生できません。audioフォルダーの配置を確認してください。";
    armResponse();
  });
}

function startExam() {
  if (state.examStarted || state.answered) return;
  state.examStarted = true;
  els.start.classList.add("hidden");
  playAudio();
}

function armResponse() {
  if (state.answered || state.responsePending) return;
  state.responsePending = true;
  els.listenStatus.textContent = "再生終了。録音ボタンを押して繰り返してください。";
  els.record.disabled = false;
  els.play.innerHTML = mode() === "practice"
    ? '<i class="fa-solid fa-rotate-right"></i><span>もう一度聞く</span>'
    : '<i class="fa-solid fa-check"></i><span>再生済み</span>';
  if (mode() === "exam" && !state.answered) {
    els.record.disabled = true;
    els.listenStatus.textContent = "1秒後にビープ音が鳴り、録音が始まります。";
    state.autoAdvanceTimer = setTimeout(() => {
      state.responsePending = false;
      playBeep();
      beginResponseCountdown();
      startRecording();
    }, 1000);
  } else {
    state.responsePending = false;
    beginResponseCountdown();
  }
}

function playBeep() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
  oscillator.addEventListener("ended", () => context.close());
}

function beginResponseCountdown() {
  clearInterval(state.responseTimer);
  const maxSeconds = Math.max(8, Math.min(12, Number(currentSentence().target_seconds) || 10));
  state.responseSeconds = maxSeconds;
  state.responseStartedAt = Date.now();
  els.responseCountdown.textContent = `${maxSeconds}s`;
  state.responseTimer = setInterval(() => {
    const remaining = maxSeconds - Math.floor((Date.now() - state.responseStartedAt) / 1000);
    state.responseSeconds = Math.max(0, remaining);
    els.responseCountdown.textContent = `${state.responseSeconds}s`;
    if (remaining <= 0) {
      clearInterval(state.responseTimer);
      state.responseTimer = null;
      state.timedOut = true;
      if (state.recording && state.recognition) state.recognition.stop();
      else if (!state.answered) showFeedback("", true, "時間切れ");
    }
  }, 250);
}

function startTimer() {
  clearInterval(state.timer);
  const started = Date.now();
  state.timer = setInterval(() => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    els.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }, 500);
}

function stopAllTimers() {
  clearInterval(state.timer); clearInterval(state.responseTimer);
  clearTimeout(state.autoAdvanceTimer);
  state.timer = null; state.responseTimer = null;
  if (state.recording && state.recognition) {
    state.stopRequested = true;
    state.recognition.stop();
  }
  stopMediaRecorder();
}

function stopMediaRecorder() {
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    state.mediaRecorder.stop();
  } else if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
    state.mediaStream = null;
  }
}

function safe(text) {
  const div = document.createElement("div");
  div.textContent = String(text || "");
  return div.innerHTML;
}

function showFeedback(text, skipped = false, label = "") {
  if (state.answered) return;
  state.answered = true; state.responsePending = false;
  clearInterval(state.responseTimer); state.responseTimer = null;
  const sentence = currentSentence();
  if (state.recording && state.recognition) {
    state.stopRequested = true;
    state.recognition.stop();
  }
  const score = wordSimilarity(sentence.sentence, text);
  const metrics = rubricMetrics(sentence.sentence, text);
  const confidence = skipped ? null : state.recognitionConfidence;
  const combinedScore = score;
  const band = skipped ? 0 : estimateBand(metrics, text);
  saveAttempt(sentence, text, skipped ? 0 : score, band, confidence, skipped ? 0 : combinedScore, skipped, metrics);
  const result = {
    setId: currentSet().id,
    index: state.sentenceIndex + 1,
    target: sentence.sentence,
    transcript: text,
    audioSrc: `./audio/${encodeURIComponent(currentSet().id)}/${encodeURIComponent(currentSet().id)}-${state.sentenceIndex + 1}.wav`,
    band, score, confidence, metrics,
    userAudioSrc: null,
  };
  state.results.push(result);
  state.audioResultTarget = result;
  stopMediaRecorder();
  els.transcript.textContent = "";
  els.feedback.classList.remove("hidden");
  els.feedback.className = `feedback-panel ${band >= 4 ? "correct" : band >= 3 ? "review" : "incorrect"}`;
  const confidenceText = confidence == null ? "取得不可" : `${Math.round(confidence * 100)}%`;
  els.feedbackHeader.textContent = skipped ? `${label || "スキップ"}（推定 0 / 5）` : `推定 ${band} / 5　（一致度 ${score}%）`;
  els.feedbackBody.innerHTML = `<div class="score-details"><span>単語一致度 <strong>${score}%</strong></span><span>内容語 <strong>${metrics.contentCoverage}%</strong></span><span>機能語 <strong>${metrics.functionAccuracy}%</strong></span><span>語順 <strong>${metrics.orderAccuracy}%</strong></span><span>認識confidence <strong>${confidenceText}</strong></span></div><small>詳細な認識結果と問題文は、セット完了後の結果カードで確認できます。</small>`;
  els.next.classList.remove("hidden"); els.showAnswer.classList.add("hidden");
  els.record.disabled = true; els.skip.disabled = true;
  els.responseCountdown.textContent = "完了";
  if (mode() === "exam") {
    els.next.classList.add("hidden");
    els.listenStatus.textContent = "次の文へ自動で進みます...";
    state.autoAdvanceTimer = setTimeout(nextSentence, 1200);
  }
}

async function startRecording() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    showFeedback("", true, "音声認識非対応");
    els.feedbackBody.innerHTML = "<div>Chrome / Edgeなど音声認識に対応したブラウザでお試しください。</div>";
    return;
  }
  const recognition = new Recognition();
  state.recognition = recognition;
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  state.stopRequested = false;
  state.recordedChunks = [];
  state.userAudioUrl = null;
  if (navigator.mediaDevices && typeof MediaRecorder !== "undefined") {
    try {
      state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (state.answered || state.stopRequested || state.recognition !== recognition) {
        state.mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recorder = new MediaRecorder(state.mediaStream);
      const recordedChunks = [];
      state.mediaRecorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
      };
      recorder.onstop = () => {
        if (recordedChunks.length) {
          state.userAudioUrl = URL.createObjectURL(new Blob(recordedChunks, { type: recorder.mimeType || "audio/webm" }));
          if (state.audioResultTarget && !state.audioResultTarget.userAudioSrc) {
            state.audioResultTarget.userAudioSrc = state.userAudioUrl;
          }
        }
        if (state.mediaStream) {
          state.mediaStream.getTracks().forEach((track) => track.stop());
          state.mediaStream = null;
        }
        if (state.mediaRecorder === recorder) state.mediaRecorder = null;
        if (state.endShown) showEnd();
      };
      recorder.start();
    } catch (error) {
      els.recordingStatus.textContent = "マイク録音を保存できませんでした。マイク権限を確認してください。";
    }
  } else {
    els.recordingStatus.textContent = "このブラウザでは自分の音声を保存できません。";
  }
  recognition.onstart = () => {
    state.recording = true; els.record.classList.add("recording");
    els.record.innerHTML = '<i class="fa-solid fa-stop"></i><span>録音停止</span>';
    els.recordingStatus.innerHTML = '<i class="fa-solid fa-circle"></i> 録音中...';
  };
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index];
      if (!result.isFinal) continue;
      const alternative = result[0];
      state.transcriptParts.push(alternative.transcript.trim());
      if (Number.isFinite(alternative.confidence)) {
        state.recognitionConfidenceSamples.push(alternative.confidence);
      }
    }
    const samples = state.recognitionConfidenceSamples;
    state.recognitionConfidence = samples.length
      ? samples.reduce((total, value) => total + value, 0) / samples.length
      : null;
    els.transcript.textContent = state.transcriptParts.join(" ") || "音声を認識中...";
  };
  recognition.onerror = (event) => {
    if (event.error !== "no-speech" && event.error !== "aborted") {
      els.recordingStatus.textContent = `認識エラー: ${event.error}`;
    }
  };
  recognition.onend = () => {
    if (state.recognition !== recognition) return;
    if (state.timedOut && !state.answered) {
      const transcript = state.transcriptParts.join(" ");
      showFeedback(transcript, !transcript, "時間切れ");
    } else if (state.stopRequested && !state.answered) {
      showFeedback(state.transcriptParts.join(" "));
    } else if (!state.answered && !state.stopRequested) {
      window.setTimeout(() => {
        if (!state.answered && !state.stopRequested && state.recognition === recognition) {
          recognition.start();
        }
      }, 50);
    }
    resetRecordButton();
  };
  try {
    recognition.start();
  } catch (error) {
    state.recording = false;
    els.recordingStatus.textContent = "録音を開始できませんでした。もう一度お試しください。";
  }
}

function resetRecordButton() {
  state.recording = false; els.record.classList.remove("recording");
  els.record.innerHTML = '<i class="fa-solid fa-microphone"></i><span>録音開始</span>';
  if (!state.answered) els.recordingStatus.innerHTML = '<i class="fa-solid fa-microphone"></i> 待機中';
}

function showAnswer() {
  els.transcript.textContent = currentSentence().sentence;
  els.feedback.className = "feedback-panel review"; els.feedback.classList.remove("hidden");
  els.feedbackHeader.textContent = "英文を確認中";
  els.feedbackBody.textContent = "音声をもう一度聞いて、語順・機能語・語尾を確認してください。英文表示は採点には含まれません。";
}

function nextSentence() {
  if (state.sentenceIndex < 6) state.sentenceIndex++;
  else if (state.setIndex < state.questions.length - 1) { state.setIndex++; state.sentenceIndex = 0; }
  else { showEnd(); return; }
  render();
  if (mode() === "exam") {
    state.autoAdvanceTimer = setTimeout(startExam, 500);
  }
}

function showEnd() {
  stopAllTimers(); els.quiz.classList.add("hidden"); els.end.classList.remove("hidden");
  state.endShown = true;
  const results = state.results;
  const total = results.length;
  const average = total ? (results.reduce((sum, item) => sum + item.band, 0) / total).toFixed(1) : "0.0";
  els.finalStats.textContent = `${total}文完了 / 推定平均 ${average} / 5（公式スコアではありません）`;
  els.setResults.innerHTML = results.map((item) => `
    <article class="result-card">
      <div class="result-card-header">
        <strong>文${item.index}</strong>
        <span class="result-pill band-${item.band}">${item.band}/5</span>
      </div>
      <div class="result-audio-grid">
        <div>
          <span class="result-label">あなたの音声</span>
          ${item.userAudioSrc
            ? `<audio class="result-audio" controls preload="none" src="${item.userAudioSrc}"></audio>`
            : '<p class="result-unavailable">録音データを保存できませんでした</p>'}
          <p class="result-transcript">${safe(item.transcript || "（認識できませんでした）")}</p>
        </div>
        <div>
          <span class="result-label">本来の音声</span>
          <audio class="result-audio" controls preload="none" src="${item.audioSrc}"></audio>
          <p class="result-target">${safe(item.target)}</p>
        </div>
      </div>
      <div class="result-score-details">
        <span>単語一致度 <strong>${item.score}%</strong></span>
        <span>内容語 <strong>${item.metrics ? item.metrics.contentCoverage : "-"}%</strong></span>
        <span>機能語 <strong>${item.metrics ? item.metrics.functionAccuracy : "-"}%</strong></span>
        <span>語順 <strong>${item.metrics ? item.metrics.orderAccuracy : "-"}%</strong></span>
        <span>confidence <strong>${item.confidence == null ? "取得不可" : `${Math.round(item.confidence * 100)}%`}</strong></span>
      </div>
    </article>`).join("");
}

function renderHistory() {
  const attempts = stored().attempts;
  const correct = attempts.filter((a) => a.estimatedBand >= 4).length;
  $("stat-total-attempts").textContent = attempts.length;
  $("stat-accuracy").textContent = `${attempts.length ? Math.round(correct / attempts.length * 100) : 0}%`;
  $("stat-mistakes").textContent = attempts.filter((a) => a.estimatedBand < 4).length;
  $("history-list").innerHTML = attempts.length ? attempts.slice(0, 30).map((a) =>
    `<div class="history-item ${a.estimatedBand >= 4 ? "correct" : "incorrect"}"><strong>${a.estimatedBand}/5</strong>　<span class="history-id">ID: ${safe(a.id)}</span>　${safe(a.target)}<br><small>${safe(a.transcript || "スキップ")}　confidence: ${a.confidence == null ? "-" : `${Math.round(a.confidence * 100)}%`}　${new Date(a.timestamp).toLocaleString()}</small></div>`).join("")
    : '<p class="text-muted">まだ履歴がありません。</p>';
}

els.start.addEventListener("click", startExam);
els.play.addEventListener("click", playAudio);
els.audio.addEventListener("ended", armResponse);
els.record.addEventListener("click", () => {
  if (state.recording && state.recognition) {
    state.stopRequested = true;
    state.recognition.stop();
  } else {
    startRecording();
  }
});
els.next.addEventListener("click", nextSentence);
els.skip.addEventListener("click", () => showFeedback("", true, "スキップ"));
els.showAnswer.addEventListener("click", showAnswer);
$("filter-mode").addEventListener("change", applyFilters);
$("filter-difficulty").addEventListener("change", applyFilters);
$("btn-jump-id").addEventListener("click", jumpToQuestionId);
$("question-id-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") jumpToQuestionId();
});
$("btn-restart").addEventListener("click", applyFilters);
$("btn-open-history").addEventListener("click", () => { renderHistory(); $("modal-history").classList.remove("hidden"); });
$("btn-close-history").addEventListener("click", () => $("modal-history").classList.add("hidden"));
$("modal-history").addEventListener("click", (event) => { if (event.target === $("modal-history")) $("modal-history").classList.add("hidden"); });
const userAgent = navigator.userAgent;
const isChrome = /Chrome\//.test(userAgent) && !/Edg\//.test(userAgent) && !/OPR\//.test(userAgent);
if (!isChrome) els.browserWarning.classList.remove("hidden");
init();
