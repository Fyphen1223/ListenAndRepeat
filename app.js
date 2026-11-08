"use strict";

const STORAGE_KEY = "toefl_listen_repeat_v2";
const state = {
  sets: [], questions: [], setIndex: 0, sentenceIndex: 0,
  timer: null, responseTimer: null, responseSeconds: 0, responseStartedAt: 0,
  recognition: null, recording: false, audioPlayed: false, answered: false, timedOut: false,
  autoAdvanceTimer: null, examStarted: false, responsePending: false,
  results: [],
};

const $ = (id) => document.getElementById(id);
const els = {
  loading: $("loading"), quiz: $("quiz-screen"), empty: $("empty-screen"), end: $("end-screen"),
  counter: $("q-counter"), sentenceCounter: $("sentence-counter"), topic: $("badge-topic"),
  questionId: $("badge-id"), questionIdInput: $("question-id-input"), jumpId: $("btn-jump-id"),
  jumpStatus: $("jump-status"),
  difficulty: $("badge-difficulty"), topicTitle: $("topic-title"), context: $("context-text"),
  sceneLocation: $("scene-location"), progressLabel: $("progress-label"), progress: $("scenario-progress"),
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

function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^\w\s']/g, "").replace(/\s+/g, " ").trim();
}

function wordSimilarity(target, actual) {
  const expected = normalize(target).split(" ").filter(Boolean);
  const heard = normalize(actual).split(" ").filter(Boolean);
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

function estimateBand(score, transcript) {
  if (!transcript.trim() || score === 0) return 0;
  if (score >= 98) return 5;
  if (score >= 88) return 4;
  if (score >= 68) return 3;
  if (score >= 40) return 2;
  return 1;
}

function saveAttempt(sentence, transcript, score, band, skipped = false) {
  const data = stored();
  data.attempts.unshift({
    id: currentSet().id, sentenceIndex: state.sentenceIndex, topic: currentSet().topic,
    target: sentence.sentence, transcript, similarity: score, estimatedBand: band,
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
  if (!filtered.length) {
    els.quiz.classList.add("hidden"); els.end.classList.add("hidden"); els.empty.classList.remove("hidden");
  } else {
    els.empty.classList.add("hidden"); els.end.classList.add("hidden"); els.quiz.classList.remove("hidden"); render();
  }
}

function render() {
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
  state.responsePending = false; state.responseSeconds = maxSeconds;
  state.examStarted = false;
  clearTimeout(state.autoAdvanceTimer);
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
  if (state.recording && state.recognition) state.recognition.stop();
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
  const score = wordSimilarity(sentence.sentence, text);
  const band = skipped ? 0 : estimateBand(score, text);
  saveAttempt(sentence, text, skipped ? 0 : score, band, skipped);
  state.results.push({ index: state.sentenceIndex + 1, band, score });
  els.transcript.textContent = text || "（認識できませんでした）";
  els.feedback.classList.remove("hidden");
  els.feedback.className = `feedback-panel ${band >= 4 ? "correct" : band >= 3 ? "review" : "incorrect"}`;
  els.feedbackHeader.textContent = skipped ? `${label || "スキップ"}（推定 0 / 5）` : `推定 ${band} / 5　（一致度 ${score}%）`;
  els.feedbackBody.innerHTML = `<div><strong>あなたの発話:</strong> ${safe(text || "認識できませんでした")}</div><div class="target-line"><strong>正解英文:</strong> ${safe(sentence.sentence)}</div><small>これは練習用の自動推定です。公式スコアではありません。</small>`;
  els.next.classList.remove("hidden"); els.showAnswer.classList.add("hidden");
  els.record.disabled = true; els.skip.disabled = true;
  els.responseCountdown.textContent = "完了";
  if (mode() === "exam") {
    els.next.classList.add("hidden");
    els.listenStatus.textContent = "次の文へ自動で進みます...";
    state.autoAdvanceTimer = setTimeout(nextSentence, 1200);
  }
}

function startRecording() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    showFeedback("", true, "音声認識非対応");
    els.feedbackBody.innerHTML = "<div>Chrome / Edgeなど音声認識に対応したブラウザでお試しください。</div>";
    return;
  }
  state.recognition = new Recognition();
  state.recognition.lang = "en-US";
  state.recognition.interimResults = false;
  state.recognition.maxAlternatives = 1;
  state.recognition.onstart = () => {
    state.recording = true; els.record.classList.add("recording");
    els.record.innerHTML = '<i class="fa-solid fa-stop"></i><span>録音停止</span>';
    els.recordingStatus.innerHTML = '<i class="fa-solid fa-circle"></i> 録音中...';
  };
  state.recognition.onresult = (event) => showFeedback(event.results[0][0].transcript);
  state.recognition.onerror = (event) => {
    if (event.error === "no-speech") showFeedback("", true, "音声を認識できませんでした");
    else els.recordingStatus.textContent = `認識エラー: ${event.error}`;
  };
  state.recognition.onend = () => {
    if (state.timedOut && !state.answered) showFeedback("", true, "時間切れ");
    resetRecordButton();
  };
  state.recognition.start();
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
  const results = state.results;
  const total = results.length;
  const average = total ? (results.reduce((sum, item) => sum + item.band, 0) / total).toFixed(1) : "0.0";
  els.finalStats.textContent = `${total}文完了 / 推定平均 ${average} / 5（公式スコアではありません）`;
  els.setResults.innerHTML = results.map((item) => `<span class="result-pill band-${item.band}">文${item.index}: ${item.band}/5</span>`).join("");
}

function renderHistory() {
  const attempts = stored().attempts;
  const correct = attempts.filter((a) => a.estimatedBand >= 4).length;
  $("stat-total-attempts").textContent = attempts.length;
  $("stat-accuracy").textContent = `${attempts.length ? Math.round(correct / attempts.length * 100) : 0}%`;
  $("stat-mistakes").textContent = attempts.filter((a) => a.estimatedBand < 4).length;
  $("history-list").innerHTML = attempts.length ? attempts.slice(0, 30).map((a) =>
    `<div class="history-item ${a.estimatedBand >= 4 ? "correct" : "incorrect"}"><strong>${a.estimatedBand}/5</strong>　<span class="history-id">ID: ${safe(a.id)}</span>　${safe(a.target)}<br><small>${safe(a.transcript || "スキップ")}　${new Date(a.timestamp).toLocaleString()}</small></div>`).join("")
    : '<p class="text-muted">まだ履歴がありません。</p>';
}

els.start.addEventListener("click", startExam);
els.play.addEventListener("click", playAudio);
els.audio.addEventListener("ended", armResponse);
els.record.addEventListener("click", () => state.recording ? state.recognition.stop() : startRecording());
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
