## 成果物

# Claude Code のサブエージェントとスキル：運用担当者向け解説メモ

## 1. このメモの目的と対象

Claude Code で作業を分担させる2つの仕組みを説明します。
読み手は、team のエージェントチームを運用する非エンジニアの方です。
仕様の記述には出典ID（[C1] など）を付けています。

## 2. 用語の早見表

| 用語 | 説明 |
|---|---|
| サブエージェント | 特定の作業だけを任せる、役割つきの補助AIです。 |
| 委任 | メインの Claude が作業をサブエージェントに任せることです。 |
| スキル | 作業手順をまとめたファイルで、必要なときに使われます[C16]。 |
| ツール | ファイルの読み書きや検索など、Claude が使う機能です。 |
| モデル | 回答を作るAIの種類（opus など）です。 |
| frontmatter | ファイル冒頭の `---` で囲んだ設定欄です。 |
| YAML | 「項目名: 値」の形で設定を書く記法です。 |
| セッション | Claude Code を起動してから終えるまでの一続きの作業です。 |
| 権限ルール | ツールの使用を許可・確認・拒否する設定です[C23]。 |

## 3. サブエージェントとは

### 3.1 定義ファイルの置き場所

- ユーザー単位：`~/.claude/agents/`。全プロジェクトで使えます[C1]。
- プロジェクト単位：`.claude/agents/`。チームと共有できます[C2]。
- 同名が両方にあれば、プロジェクト側が優先されます[C3]。

team の4ファイルは `~/.claude/agents/` にあり、ユーザー単位です［実物：planner.md ほか］。

### 3.2 書き方：name / description / tools / model

```yaml
---
name: planner
description: エージェントチームの司令塔。人間の依頼を、完了条件つきの作業指示書（task_brief.json）に変換する。agent-team ワークフローの最初の段階で使う。調査や本文作成はしない。
tools: Read, Glob, Grep, Write
model: opus
---
```
［実物：planner.md］

**name**：一意の識別子で、最大256文字です[C4]。
実物では「planner」という名前で呼び出します［実物：planner.md］。

**description**：いつ委任すべきかを示す説明です[C5]。
Claude は自動委任の判断にこれを使います[C5]。
実物は「最初の段階で使う」「調査や本文作成はしない」と書いています［実物：planner.md］。

**tools**：省略すると、メイン会話のツールをすべて受け継ぎます[C6]。
指定すると、列挙したツールだけを使えます[C7]。
書式はカンマ区切りか YAML のリストです[C7]。
有効な名前が1つもないと、通常は起動に失敗します[C8]。
実物の planner は読む・探す・書くの4つだけで、Edit を持ちません［実物：planner.md］。

**model**：sonnet・opus・haiku・fable、完全なモデルID、inherit を指定できます[C10]。
inherit はメイン会話と同じモデルです[C11]。
省略すると所定の順序で選ばれ、最後はメイン会話のモデルになります[C12]。
実物は planner が opus、researcher が haiku です［実物：planner.md、researcher.md］。

frontmatter の下には、役割・手順・ルールを書いています［実物：planner.md］。

## 4. スキルとは

### 4.1 置き場所

- 個人用：`~/.claude/skills/<skill-name>/SKILL.md`。全プロジェクトで使えます[C13]。
- プロジェクト用：`.claude/skills/<skill-name>/SKILL.md`。そのリポジトリで使えます[C14]。

agent-team は `~/.claude/skills/agent-team/` にあり、個人用です［実物：SKILL.md］。

### 4.2 SKILL.md の書き方

frontmatter の項目はすべて任意で、推奨は description だけです[C15]。

```yaml
---
name: agent-team
description: Planner → Researcher → Builder → Reviewer の4体のエージェントチームで、依頼から成果物を作り、人間の最終承認まで進める。「agent-team で〜を作って」「チームで〜を作成して」「/agent-team」と言われたときに使う。
---
```
［実物：SKILL.md］

**name**：実物ではフォルダ名と同じ agent-team です［実物：SKILL.md］。
公式な役割は [要調査] です。

**description**：使う場面を書きます。
Claude は関連があると判断したときにスキルを使います[C16]。
実物は、きっかけになる言い回しを並べています［実物：SKILL.md］。

**本文**：進行役の手順を0〜6段階で書いています［実物：SKILL.md］。

呼び出し方は2つです。
- 自動：Claude が関連ありと判断したとき[C16]。
- 明示：`/skill-name` の形で直接呼ぶ[C17]（例：`/agent-team`）。

## 5. ツール権限の考え方

結論：ツールは必要な分だけに絞るのが推奨です[C9]。

- 作業ディレクトリ内の読み取りと Grep は承認不要です[C22]。
- Bash は、組み込みの読み取り専用コマンド以外は承認が必要です[C22]。
- ファイルの編集・書き込みは承認が必要です[C22]。
- 権限ルールは deny → ask → allow の順で評価されます[C23]。
- 最初に一致したルールが結果を決めます[C23]。
- deny は指定したツールの使用を防ぎます[C24]。

team では Edit を持つのは builder だけです［実物：builder.md ほか］。
Web 系ツールは researcher と reviewer だけが持ちます［実物：researcher.md、reviewer.md］。

tools 欄と権限ルールの連動の仕様は [要調査] です。

## 6. 変更が反映されるタイミング

- サブエージェント：通常は数秒で検知され、次の委任から反映されます[C18]。
- 再起動が必要な例外が3つあります[C19]。
  - agents ディレクトリを初めて作った場合
  - `--add-dir` で追加したディレクトリのエージェント
  - `--disable-slash-commands` 付きで起動したセッション
- `/agents` は、Claude への依頼か直接編集を促す案内を表示します[C20]。
- スキル：現在のセッション内で反映され、再起動は不要です[C21]。
- 開始時になかった skills ディレクトリを新設したら `/reload-skills` が必要です[C21]。

## 7. 運用担当者が次にやること（修正時のチェック項目）

- 直すファイルの置き場所を確認する（同名はプロジェクト側が優先）[C3]。
- description に「いつ使うか」を具体的に書いたか確認する[C5]。
- tools は必要最小限か、ツール名の綴りは正しいか確認する[C8][C9]。
- model が有効な値（opus など）か確認する[C10]。
- 保存後、次の委任で変更が効いたか確認する[C18]。
- ディレクトリを新設したら、再起動または `/reload-skills` を行う[C19][C21]。
- 外部への送信・公開は行わず、人間の判断に回す。

## 出典一覧

- C1〜C12、C18〜C20：https://code.claude.com/docs/en/sub-agents
- C13〜C17、C21：https://code.claude.com/docs/en/skills
- C22〜C24：https://code.claude.com/docs/en/permissions
- ［実物］：/home/user/.claude/agents/（planner.md、researcher.md、builder.md、reviewer.md）、/home/user/.claude/skills/agent-team/SKILL.md

## 自己チェック

- 完了条件1：✅ 4項目すべてに専用見出し（3.1/3.2、4.1/4.2、5、6）があり、各項目に公式由来の出典IDがあります。name / description / tools / model を個別に説明しています。
- 完了条件2：✅ 仕様の記述はすべて C1〜C24 に紐づけています。確認できない点（スキルの name の役割、tools と権限ルールの連動、description の照合方法、ツール名一覧）は書かずに [要調査] にしました。
- 完了条件3：✅ 初出の専門用語は2章の早見表で1文説明しています（サブエージェント、スキル、ツール、モデル、frontmatter、YAML など）。
- 完了条件4：✅ planner.md（サブエージェント）と agent-team の SKILL.md（スキル）の frontmatter を引用し、各フィールドに対応づけています。他の3ファイルも tools・model の例として参照しています。
- 完了条件5：✅ 7章に修正時のチェック項目を7つ示しています。
- 分量（request.md 追記）：✅ 本文は3,000字以内に収めた見込みです（Builder にはツール上の字数計測手段がないため、目視の概算）。

## 要確認事項

- [要調査] スキルの frontmatter の name の公式な役割（research_pack に claim なし）。
- [要調査] サブエージェントの tools 欄と権限ルール（permissions）の連動の仕様（unverified に記載あり）。
- [要調査] スキルの description が自動判断でどう照合されるか（本文では詳細を書いていません）。
- [要調査] tools 欄に書けるツール名の正式な一覧（tools-reference 未取得）。
- [要調査] C3 の優先度の数字は要約ツール経由のため、原文での再確認が望ましい（confidence: medium）。
- [要調査] C11・C12・C20 は confidence: medium。特に C20 の v2.1.197 の版番号は本文から省きました。
- [要調査] 各ページの公開日・更新日が未取得で、鮮度（365日基準）は未確認。
- [人間判断] このメモの社内配布の可否と範囲。
