# TOEFL Listen & Repeat Text Generator

TOEFL iBT スピーキングの「Listen & Repeat」問題用に、練習用の英文を自動生成するツールです。

Mistral API（および Groq / Ollama Cloud API）を使用して、**1つのシチュエーションにつき7文のセット**を生成し、`output.jsonl` に保存します。

## セットアップ

### 1. 依存パッケージをインストール

```bash
cd C:\Users\Shuto\Desktop\Code\ListenAndRepeat
npm install
```

練習画面ではリポジトリ内の`vendor/compromise.js`（ブラウザ向け`compromise`）を使って、認識テキストを品詞解析します。
内容語（名詞・動詞・形容詞・副詞）と機能語を区別し、Listen and Repeatの補助評価
（内容語の再現率・機能語・語順）に利用します。これはETSの公式採点エンジンではありません。

WordNet由来の同義語候補は`vendor/wordnet-synonyms.json`にローカル同梱しています。
更新する場合は`npm run build:synonyms`を実行してください。同義語は完全一致の代わりではなく、
compromiseで品詞が一致する内容語の補助評価（通常一致の80%）としてのみ利用します。

### 2. API Key を設定

`env.json` を編集し、使うサービスの API Key を入力してください。複数入れておくと、各サービスの複数モデルをランダムに切り替えながら生成し、429 を返したモデルは一時的に避けます。

```json
{
  "mistral": "あなたのMistral API Key",
  "groq": "あなたのGroq API Key",
  "ollama": "あなたのOllama Cloud API Key"
}
```

- Mistral API Key: https://console.mistral.ai/
- Groq API Key: https://console.groq.com/keys
- Ollama Cloud API Key: https://ollama.com/settings/keys

使うプロバイダーは `PROVIDER` で指定できます（既定は `auto`）。

```bash
set PROVIDER=auto     # 設定済みの全プロバイダー・全モデルからランダムに選択（既定）
set PROVIDER=mistral  # Mistral のみ
set PROVIDER=groq     # Groq のみ
set PROVIDER=ollama   # Ollama Cloud のみ
```

モデルは複数指定でき、リクエストごとにランダムに切り替わります。

```bash
set MISTRAL_MODELS=ministral-8b-latest,ministral-14b-latest
set GROQ_MODELS=openai/gpt-oss-120b,qwen/qwen3.8-27b
set OLLAMA_MODELS=gpt-oss:120b,gemma4:31b,glm-5.3
set GROQ_MAX_TOKENS=4000
set GROQ_QWEN_MAX_TOKENS=950
set OLLAMA_MAX_TOKENS=4000
```

既定のモデル:
- Mistral: `ministral-8b-latest`, `ministral-14b-latest`
- Groq: `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`
- Ollama Cloud: `gpt-oss:120b`, `gemma4:31b`, `glm-5.3`

`qwen` は Groq 無料枠の出力トークン/分（OTPM）制限が低いため、既定で `950` に抑えています。

Ollama Cloud は OpenAI 互換エンドポイント `https://ollama.com/v1/chat/completions` を使用します。モデル名は `https://ollama.com/api/tags` で確認できます。ローカルの Ollama を使う場合は `set OLLAMA_API_URL=http://localhost:11434/v1/chat/completions` で切り替えられます。

### 3. 実行

```bash
npm start
```

生成セット数を変更したい場合は環境変数 `TARGET_COUNT` で指定できます（1セット＝7文）。

```bash
# 例: 50 セット生成（合計350文）
set TARGET_COUNT=50
npm start
```

難易度は既定で `hard`（実際のTOEFL 2026相当）です。より易しめの練習にしたい場合は `DIFFICULTY=standard` を指定します。

```bash
set DIFFICULTY=standard
npm start
```

`hard` は実際のTOEFL 2026のListen and Repeatに合わせた長さで、目安は easy 5〜8語 / medium 9〜12語 / hard 12〜16語（音節数目安：9〜11 / 14〜16 / 19〜23）です。

生成される英文には固有名詞（人名・大学名・ブランド名・都市名・特定の施設名）を含めず、「the university」「the library」などの一般名詞で表現するようプロンプトで指示しています。部屋番号・日付・時刻は使用できます。

### 並列生成

既定では3並列で生成します。増やすと速くなりますが、429が増えやすくなります。

```bash
set CONCURRENCY=5   # 同時実行数（既定 3、最大 10）
npm start
```

429 が多い場合は `CONCURRENCY=1` または `2` に下げてください。Ctrl+C は1回で受付中のジョブを完了して停止し、2回で即終了します。

### レート制限（429）対策

429 が返った場合は、通常のエラーとは別枠で最大 `MAX_RATE_LIMIT_RETRIES` 回まで再試行します。待ち時間は `RATE_LIMIT_RETRY_MS` を基準に指数バックオフ（上限 `MAX_RETRY_DELAY_MS`）し、`Retry-After` ヘッダーがあればそれも尊重します。

```bash
set MODEL_DELAY_MS=3000          # 各ワーカーのリクエスト間隔（既定 3000ms）
set MAX_RATE_LIMIT_RETRIES=8     # 429 の最大再試行回数（既定 8）
set RATE_LIMIT_RETRY_MS=10000    # 429 の初回待機（既定 10000ms）
set MAX_RETRY_DELAY_MS=60000     # 待機時間の上限（既定 60000ms）
npm start
```

失敗したジョブは `output.jsonl` に保存されないため、再実行すると自動的に再試行されます。

## 出力形式 (`output.jsonl`)

1 行 1 JSON の JSONL 形式です。1レコード = 1シチュエーション×7文です。

```json
{
  "id": "uuid",
  "generatedAt": "2026-11-07T...",
  "topic": "University Library",
  "sentence_count": 7,
  "sentences": [
    {
      "sentence": "Welcome to the university library.",
      "difficulty": "easy",
      "target_seconds": 8,
      "japanese_context": "大学図書館へようこそという案内"
    },
    {
      "sentence": "Please keep your voice down.",
      "difficulty": "easy",
      "target_seconds": 8,
      "japanese_context": "声をひそめてくださいという注意"
    },
    {
      "sentence": "The reference books are located on the third floor.",
      "difficulty": "medium",
      "target_seconds": 10,
      "japanese_context": "参考図書は3階にあるという案内"
    },
    {
      "sentence": "You can reserve a study room online.",
      "difficulty": "medium",
      "target_seconds": 10,
      "japanese_context": "オンラインで学習室を予約できるという案内"
    },
    {
      "sentence": "Return all borrowed books by the due date.",
      "difficulty": "medium",
      "target_seconds": 10,
      "japanese_context": "借りた本は返却日までに返すようにという案内"
    },
    {
      "sentence": "The library will be closed for renovation next week.",
      "difficulty": "hard",
      "target_seconds": 12,
      "japanese_context": "来週は改装のため図書館が閉館するという案内"
    },
    {
      "sentence": "Please return overdue items to the front desk before leaving.",
      "difficulty": "hard",
      "target_seconds": 12,
      "japanese_context": "退出前に延期品をカウンターに返却するようにという案内"
    }
  ]
}
```

- `topic`: 出題シーン（例：University Library）
- `sentence_count`: 7（固定）
- `sentences`: 7文の配列
  - `difficulty`: easy（8秒）×2 / medium（10秒）×3 / hard（12秒）×2
  - `target_seconds`: 解答時間の目安
  - `japanese_context`: 学習者向けの日本語シーン説明

## ファイル構成

| ファイル | 説明 |
|----------|------|
| `generator.js` | メイン生成スクリプト |
| `env.json` | API Key 設定（git へのコミットは避けてください） |
| `topics.json` | 出題シーン一覧 |
| `types.json` | 難易度別スキルタイプ |
| `generator.txt` | AI へのシステムプロンプト |
| `output.jsonl` | 生成結果（実行後に作成） |
| `errors.log` | エラーログ（実行後に作成） |

## 中断・再開

途中で停止しても、`output.jsonl` は保存されます。再度 `npm start` を実行すると、既存の件数を読み込んで残りの生成を再開します。

## 音声生成 (`tts.py`)

生成したテキストを Kokoro TTS で音声化します。`output.jsonl` の全問題を読み込み、
1 問題につき 7 文の WAV を生成します。

### 1. 依存パッケージをインストール

```bash
pip install kokoro soundfile
```

### 2. 実行

```bash
python tts.py
# または
npm run tts
```

主なオプション:

```bash
python tts.py --limit 5        # 先頭 5 問だけ生成
python tts.py --start 10       # 10 問目から生成
python tts.py --force          # 既存の WAV も上書き再生成
python tts.py --voice af_heart # 声を固定
python tts.py --speed 1.0      # 話速を固定（既定は文ごとに 0.9〜1.2 でランダム）
```

### 3. 出力フォルダ構成

```
audio/
├── 1/
│   ├── 1-1.wav
│   ├── 1-2.wav
│   ├── ...
│   └── 1-7.wav
├── 2/
│   ├── 2-1.wav
│   └── ...
└── ...
```

- `audio/<セット番号>/` フォルダに1セットずつ保存
- 各セットは**1つの声（speaker）**で統一（`tts.py` の `SPEAKERS` 配列からランダム割り当て）
- 話速は**文ごとに 0.9〜1.2 でランダム**に散らします
- ファイル名は `<セット番号>-<文番号>.wav`（例：`1-1.wav`, `1-7.wav`）
- 既存の WAV は既定でスキップされます（`--force` で上書き）

### 4. スピーカー（声）の変更

`tts.py` の `SPEAKERS` 配列を編集すると、使用する声を変更できます。

```python
SPEAKERS = [
    "af_bella",
    "af_sarah",
    "am_adam",
    "am_michael",
    "bf_emma",
    # ... 追加・削除可能
]
```

## 注意

- API Key は `env.json` に直接書き込みますが、コードには埋め込まないでください。
- Mistral API の利用には別途料金が発生する場合があります。
- 1セット＝7文なので、TARGET_COUNT=100 で700文生成されます。
- Kokoro TTS の利用には別途モデルファイルや Python 環境が必要です。