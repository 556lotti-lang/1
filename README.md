# 雀魂 牌譜レビュー（ローカル専用）

雀魂の牌譜を読み込み、麻雀AIの判断と自分の打牌を並べて「ここは鳴いたほうがよかった」
「この牌を切ったほうがよかった」を局ごとに振り返るための、自分用のWeb画面です。

- 解析は [mjai-reviewer](https://github.com/Equim-chan/mjai-reviewer)（Rust製）に任せ、
  この画面はその結果（JSON）を読みやすく表示することに専念します。
- すべて自分のPCの中だけで動きます。どこにも公開されません。

---

## 0. はじめに読んでほしいこと（エンジンの選択）

mjai-reviewer は 2 つのAIエンジンを使えます。

| エンジン | 学習済みモデル | 入手 | このツールでの扱い |
|---|---|---|---|
| **akochan** | **不要** | ソースからビルドするだけ | **既定。まずこちら** |
| Mortal | **必要**（`mortal.pth`） | **公開されていない** | 手元にモデルがある人だけ |

Mortal の作者は「オンライン版（https://mjai.ekyu.moe ）で目的は果たせているので、
現時点で学習済みモデルを公開する予定はない」と表明しています（2022-08-19 時点）。
そのため **モデルファイルを自分で持っていない限り、ローカルでは Mortal は動きません**。
この README の手順は akochan を前提に書いてあります。

> Mortal の精度でレビューしたいだけなら、公式のWebサービス https://mjai.ekyu.moe
> を使うのがいちばん簡単です（ただしHTMLのレポートが出るだけで、この画面とは連携しません）。

---

## 1. セットアップ（macOS）

ターミナル（アプリケーション → ユーティリティ → ターミナル）を開いて、上から順に実行します。
`$` は入力しません。コピーして貼り付け、Enter を押してください。

### 1-1. Homebrew（パッケージ管理ツール）を入れる

すでに入っていれば飛ばしてかまいません。`brew --version` が動けば入っています。

```shell
$ /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

インストール後、画面に出てくる "Next steps" の `echo ... >> ~/.zprofile` と
`eval ...` の 2 行も実行してください（Apple Silicon の場合に必要です）。

### 1-2. 必要なものを入れる

```shell
$ brew install python@3.12 rustup llvm libomp boost
$ rustup-init -y          # Rust の本体を入れる（質問には Enter でOK）
$ source "$HOME/.cargo/env"
$ rustc --version         # バージョンが表示されれば成功
```

### 1-3. 作業用フォルダを決める

このリポジトリと、mjai-reviewer・akochan を**同じ階層**に置くと設定が楽です。

```shell
$ mkdir -p ~/mahjong && cd ~/mahjong
$ git clone https://github.com/Equim-chan/mjai-reviewer.git
$ git clone https://github.com/critter-mj/akochan.git
# このリポジトリも ~/mahjong の下に置いてください（例: ~/mahjong/mjsoul-review）
```

最終的にこうなります。

```
~/mahjong/
├── mjai-reviewer/      # 解析ツール本体（Rust）
├── akochan/            # AIエンジン（C++）
└── mjsoul-review/      # ★このリポジトリ
```

### 1-4. mjai-reviewer をビルドする

```shell
$ cd ~/mahjong/mjai-reviewer
$ cargo build --release
```

初回は 5〜15 分ほどかかります。終わると
`~/mahjong/mjai-reviewer/target/release/mjai-reviewer` ができます。

```shell
$ ./target/release/mjai-reviewer --version   # 1.5.x と出れば成功
```

### 1-5. akochan をビルドする

AIライブラリ → 本体の順に 2 回ビルドします。

```shell
$ cd ~/mahjong/akochan/ai_src
$ make -f Makefile_MacOS
$ cd ..
$ make -f Makefile_MacOS
$ ls system.exe libai.so    # 2 つとも表示されれば成功
```

`Makefile_MacOS` は Homebrew の場所と Apple Silicon かどうかを自動で見てくれるので、
通常は書き換え不要です。数分〜10分ほどかかります。

### 1-6. このツールを用意する

```shell
$ cd ~/mahjong/mjsoul-review
$ python3.12 -m venv .venv          # 専用のPython環境を作る
$ source .venv/bin/activate         # 以降、ターミナルの行頭に (.venv) が付く
$ pip install -r requirements.txt
$ cp settings.example.toml settings.toml
```

`settings.toml` をテキストエディタで開き、パスを自分の環境に合わせます。
上の構成どおりなら、次のままでそのまま動きます。

```toml
reviewer_bin = "../mjai-reviewer/target/release/mjai-reviewer"
engine = "akochan"
akochan_dir = "../akochan"
akochan_tactics = "../mjai-reviewer/tactics.json"
```

### 1-7. 起動する

```shell
$ streamlit run app.py
```

ブラウザが開きます。開かなければ表示された `http://localhost:8501` を自分で開いてください。
止めるときはターミナルで `Control + C` です。

次回以降は次の 2 行だけで起動できます。

```shell
$ cd ~/mahjong/mjsoul-review && source .venv/bin/activate
$ streamlit run app.py
```

---

## 2. 雀魂の牌譜を手に入れる

雀魂の牌譜はログインが必要で形式も独自のため、**ブラウザから保存する**のがいちばん確実です
（mjai-reviewer 公式も同じ方法を案内しています）。

1. ブラウザに拡張機能 [Tampermonkey](https://www.tampermonkey.net/) を入れる
2. Equim 氏の [downloadlogs スクリプト](https://gist.github.com/Equim-chan/875a232a2c1d31181df8b3a8704c3112)
   を Tampermonkey に追加する
3. 雀魂にログインし、振り返りたい対局の牌譜を開く
4. 牌譜が読み込まれた状態で **`S` キー**を押す → JSONファイルがダウンロードされる
5. そのファイルを、このリポジトリの `logs/` フォルダに入れる
   （画面左のアップローダからでも入れられます）

保存されるのは tenhou.net/6 形式のJSONで、これがそのまま mjai-reviewer の入力になります。

> **注意**
> - 公式の案内でも「別環境・サブアカウントでの利用を推奨」とされています。
> - 自動取得（牌譜URLを貼るだけで解析）は、雀魂のログインを伴うため規約・認証の面で
>   慎重な検討が必要です。かつて使われていた自動取得サービス（tensoul）の公開インスタンスは
>   雀魂側にブロックされて使えなくなっています。現時点でこのツールには実装していません。

---

## 3. 使い方

1. 左サイドバーで **牌譜ファイル** を選ぶ
2. **振り返るプレイヤー** を選ぶ（自分の名前を選べばOK）
3. **エンジン** は `akochan`
4. 最初は **「局を絞る」に `E1` と入れて試す**（akochan は 1 局あたり数十秒かかります）
5. **「この条件で解析する」** を押す

同じ条件の解析結果は `cache/` に保存され、2回目からは即座に表示されます。

### 画面の見かた

- **気になる場面** タブ
  - AI と判断が違った場面だけを一覧表示します
  - **損失が大きい順**に並べ替えられます（既定）
  - スライダーで「損失がこの値以上の場面だけ」に絞れます
  - 各行の詳細を開くと、AI が挙げた**全候補とその評価値**が見られます
- **局ごと** タブ
  - 局ごとの「判断した場面数 / 違った場面数 / 損失合計 / 結果」の一覧
  - 局を選ぶと、その局の場面を**時系列**で確認できます
- **解析の情報** タブ
  - 実行されたコマンド、結果JSONの場所、評価値の意味

### 印の意味

| 印 | 種別 | 意味 |
|---|---|---|
| 🔴 | 打牌 | 切った牌が AI の推奨と違う |
| 🤝 | 鳴き推奨 | AI は鳴きを推奨（実際はスルーした） |
| 🙅 | 鳴き不要 | AI はスルーを推奨（実際は鳴いた） |
| 🔀 | 鳴き方違い | 鳴くこと自体は同じだが、鳴き方や鳴いた後の打牌が違う |
| 🔔 / 🔕 | リーチ推奨 / 非推奨 | リーチの判断が違う |
| 💰 / ⏭️ | 和了見逃し / 見逃し推奨 | 和了するかどうかの判断が違う |
| 🏳️ | 流局宣言 | 九種九牌の判断が違う |
| ✅ | 一致 | AI と同じ選択（既定では非表示） |

### 評価値と「損失」

- **損失 = AI の最善手の評価値 − 実際に選んだ手の評価値**。大きいほど AI との差が大きい場面です。
- akochan の評価値は **pt期待値**（最終順位の期待値）です。
- Mortal の評価値は **Q値**（局開始時点を基準にした pt期待値の変化量）です。
  Mortal 作者の FAQ にあるとおり、Q値は「局収支」でも「清算ポイント」でもありません。
  最善手以外の値は不正確になりうるので、**順位と大小の傾向を見る程度**に使ってください。
- どちらのエンジンも「AI がそう言っている」だけで、**正解ではありません**。
  鳴き・リーチの判断は特に流派が分かれるところです。

### 速度の目安

akochan は 1 局あたり数十秒（手数の多い局はもっと）かかります。
半荘まるごとだと 10〜30 分かかることもあるので、

- まず `E1` だけ解析して様子を見る
- 気になる局だけ `E1,S3.1` のように指定する
- 全局解析は時間に余裕があるときに（サイドバーのタイムアウトを長めに）

という使い方がおすすめです。

---

## 4. Mortal を使う場合（学習済みモデルが手元にある人だけ）

1. [Mortal](https://github.com/Equim-chan/Mortal) のドキュメントに従って
   Python環境 + PyTorch + libriichi をビルドする
2. 手元の `mortal.pth` を指すように Mortal 側の `config.toml` を書く
3. このツールの `settings.toml` に次を追加する

```toml
mortal_exe = "../Mortal/mortal/mortal"
mortal_cfg = "../Mortal/mortal/config.toml"
temperature = 0.1
```

4. 画面左の「エンジン」で `mortal` を選ぶ

Mortal は**半荘のみ対応**です（東風戦の牌譜はエラーになります）。

### 画面だけ先に試したいとき（ダミーエンジン）

エンジンをまだ用意できていなくても、画面の動きだけ確認できます。

```toml
mortal_exe = "tools/dummy_mortal_engine.py"
mortal_cfg = "tools/dummy_config.toml"
```

**このダミーは擬似乱数で評価値を作っているだけで、麻雀の強さはまったくありません。**
牌譜の振り返りには絶対に使わないでください。

---

## 5. うまくいかないとき

| 症状 | 原因と対処 |
|---|---|
| `mjai-reviewer の実行ファイルが見つかりません` | `settings.toml` の `reviewer_bin` のパスを確認。`cargo build --release` が成功しているか確認 |
| `akochan の実行ファイルが見つかりません` | `akochan_dir` に `system.exe` があるか確認。無ければ 1-5 をやり直す |
| akochan 起動時に `libai.so` が見つからない | `akochan/` の中に `libai.so` があるか確認（`ai_src` のビルドで自動コピーされます） |
| `Mortal supports hanchan games only` | 東風戦の牌譜です。akochan を使ってください |
| 三人麻雀の牌譜がエラーになる | mjai-reviewer は四人麻雀専用です（三麻は非対応） |
| 解析が終わらない | 「局を絞る」で局数を減らす。タイムアウトを延ばす |
| 画面に古い結果が出る | 「同じ条件ならキャッシュを使う」のチェックを外して再解析、または `cache/` を削除 |
| 牌が □ になる | 画面左の「牌の表示」を **文字** にすると `1萬` のような表記になります |

---

## 6. ファイル構成

```
.
├── app.py                     # Streamlit の画面
├── mjsreview/
│   ├── config.py              # settings.toml の読み込み
│   ├── runner.py              # mjai-reviewer の呼び出し・キャッシュ
│   ├── parse.py               # 解析JSON → 「場面」への変換
│   ├── events.py              # 行動の日本語化・ミスの種類判定
│   └── tiles.py               # 牌の表示（絵文字 / 文字）
├── tools/
│   ├── dummy_mortal_engine.py # 動作確認用のダミーエンジン（強さなし）
│   └── dummy_config.toml
├── logs/                      # 雀魂から落とした牌譜を置く場所
├── cache/                     # 解析結果のキャッシュ（消してよい）
├── samples/                   # 動作確認用のサンプル牌譜
├── settings.example.toml      # 設定のひな形（コピーして settings.toml を作る）
└── requirements.txt
```

---

## 7. 制限事項・ことわり

- 四人麻雀の半荘・東風戦（akochan）のみ。**三人麻雀は非対応**です。
- AIの評価は参考情報です。特に Mortal の Q値 は最善手以外の精度が保証されません。
- このツールは個人の振り返り用です。公開や共有を前提にしていません。
- 解析エンジンは別プロジェクトです。ライセンスと利用条件はそれぞれを参照してください。
  - mjai-reviewer: Apache-2.0 / akochan: 配布元のライセンス / Mortal: AGPL-3.0
