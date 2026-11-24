# LIVING ATLAS 共同開発スタートガイド

このリポジトリがプロジェクトの正本です。

**Repository:** https://github.com/RyoSAKu610/Lumen-atlas-

## まず読む資料
- [プロジェクト概要](../README.md)
- [現在の実装状況](PROJECT_STATUS.md)
- [技術設計](TECHNICAL_ARCHITECTURE.md)
- [AI共同開発ルール](AI_COLLABORATION.md)
- [AI担当表](TEAM_ASSIGNMENTS.md)
- [英語マスタープロンプト](../prompts/MASTER_PROMPT_EN.md)

## AIに割り当てる担当

| 担当 | 最初に渡すプロンプト |
|---|---|
| ChatGPT：世界観・画像・アートディレクション | prompts/ART_DIRECTOR_PROMPT_EN.md |
| UE5エンジニア | prompts/UE5_ENGINEERING_PROMPT_EN.md |
| 生物AI | prompts/CREATURE_AI_PROMPT_EN.md |
| 骨格・アニメーション | prompts/ANIMATION_TD_PROMPT_EN.md |
| 生態系シミュレーション | prompts/ECOLOGY_SIMULATION_PROMPT_EN.md |
| 日本の温泉地・地域調査 | prompts/JAPAN_REGION_RESEARCH_PROMPT_EN.md |
| QA・パフォーマンス | prompts/QA_PERFORMANCE_PROMPT_EN.md |

同じAIに複数の役割を持たせる場合も、最初に担当範囲を明示してください。AIの種類より、担当の明確さとテスト結果を重視します。

## 作業開始手順

    git clone https://github.com/RyoSAKu610/Lumen-atlas-.git
    cd Lumen-atlas-
    git switch -c feat/<workstream>-<task>

例：
- feat/ue5-world-bootstrap
- feat/creature-ai-social
- feat/creature-rigs-animation
- feat/ecology-simulation
- research/japan-geothermal
- art/<region-or-species>

既に担当ブランチがある場合は、mainから新規作成せず、最新状態を確認してから利用してください。

## 参照シミュレーションの起動と検証

Python 3.11以上。外部ライブラリ不要です。

macOS / Linux:

    cd simulation/reference_ecology
    bash scripts/run_reference_demo.sh

Windows PowerShell:

    cd simulation/reference_ecology
    .\scripts\run_reference_demo.ps1

このデモは、5種・9個体のエンジン非依存参照モデルです。21個の自動テスト、個体の欲求、親子行動、遭遇、捕食/逃走、温泉利用、交流フェーズ、衝突、中断・回復、保存/復元を確認できます。

**注意:** これはUnreal Engine 5の製品版ではありません。2Dの参照移動モデルであり、3D骨格・物理接触・IK・実際のアニメーション再生を実装したものではありません。

## PRの出し方
1. 担当Issueを確認する。
2. 担当ブランチで作業する。
3. 該当テストを実行する。
4. PRを作り、実装済み・未実装・テスト結果・既知の問題を書く。
5. 他担当のAPIやデータ形式を変えた場合は、影響範囲と移行方法を記載する。

PRテンプレートは .github/pull_request_template.md にあります。

## 現在の優先順位
1. UE5プロジェクト基盤と一括起動 / 保存 / 復元。
2. 3種の実際の3D骨格・移動・接地。
3. InteractionCoordinatorをUE5のアニメーションと接続。
4. 生物AIの欲求・知覚・記憶・社会関係。
5. 食物網・繁殖・成長・移動・長期生態系。
6. 草津など日本の温泉地を最初の実在地形モジュールにする。
