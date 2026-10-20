---
name: agent-team
description: Planner → Researcher → Builder → Reviewer の4体のエージェントチームで、依頼から成果物を作り、人間の最終承認まで進める。「agent-team で〜を作って」「チームで〜を作成して」「/agent-team」と言われたときに使う。
---

# エージェントチームの実行手順

あなた（メインの Claude）は進行役です。自分で調査や本文作成はせず、各段階をサブエージェントに任せ、受け渡しはすべて案件フォルダのファイルで行います。会話履歴は渡さず、案件フォルダのパスと必要な指示だけを渡してください。

## 0. 準備
1. team/mission.md を読む。「（未記入）」のままの項目が残っていたら、先に人間に記入を頼んで止まる。
2. 案件フォルダ `cases/YYYY-MM-DD_<短い業務名>/` を作る（日付は今日）。
3. 依頼文を `request.md` として保存する。team/request_template.md の項目が欠けていれば、人間に質問して埋める。

## 1. Planner
- `planner` サブエージェントに、案件フォルダのパスと「task_brief.json を作成して」と渡す。
- open_questions が返ってきたら、人間に質問して request.md に追記し、もう一度 Planner を呼ぶ。
- **任意ゲートA**：mission.md で「計画の承認：あり」になっていれば、task_brief の要点（目的・完了条件・構成）を人間に見せて承認をもらう。

## 2. Researcher
- `researcher` サブエージェントに案件フォルダのパスを渡す。
- needs_permission があれば、その情報源を使ってよいか人間に確認する。許可されたら mission.md の許可リストに追記し、Researcher を再実行する。

## 3. Builder → 4. Reviewer（ループ）
- `builder` に draft_v1.md を作らせる。
- **字数などの数量は進行役が測る。** Builder と Reviewer には字数を正確に数える手段がない。分量の上限がある場合は、草稿ができるたびに進行役が Bash で計測し（例：「## 自己チェック」より前を空白除きで数える）、その結果を `reviewer` に渡す。
- 続けて `reviewer` に review_v1.json を作らせる。
- REVISE：`builder` に最新の review を渡して次の版を作らせ、もう一度 `reviewer` に判定させる。差し戻しは最大2回まで。
- **事実の不足は Researcher に戻す。** Reviewer の指摘が「公式に書いてあるのに research_pack にない」という種類なら、Builder に直させる前に `researcher` に該当ページから claim を追記させる（research_pack.json に追記し、新しい ID を振る）。これは差し戻し回数に数えない。Builder は research_pack にない事実を書けないため、この手順を飛ばすと [要調査] が残り続ける。
- ESCALATE：escalation_reason と high の指摘を人間に示し、どうするか判断を仰ぐ。
- PASS：次へ進む。

## 5. 必須ゲートB：人間による最終承認
- 最新の草稿のパス、自己チェックの結果、要確認事項、Reviewer の残りの指摘を短くまとめて示し、承認・修正指示・中止のどれにするかを人間に尋ねる。
- 修正指示が出たら、その内容を `builder` に渡して次の版を作り、`reviewer` を通してからもう一度このゲートに戻る。
- 承認されたら、最新の草稿を `final.md` としてコピーする。
- **送信・公開・投稿・支払いは絶対に自分で行わない。** それは人間が行う。

## 6. 記録
- team/log.csv に1行追記する：
  `日付,task_id,業務,差し戻し回数,最終判定,人間の修正量(小/中/大),重大ミス(有/無),メモ`
  人間の修正量と重大ミスの有無は、人間に尋ねて記入する。
- 人間が直した点のうち、次回以降にも当てはまるものがあれば、team/lessons.md への追記案を示し、承認されたら追記する（20項目以内に保つ）。
