# 科学技術部 ゲーム認証管理システム

学校の科学技術部ゲーム発表会向けの、
QRコード認証管理システムです。

## ログイン権限

2種類のパスワードを使用します。

### 管理者

環境変数:

ADMIN_PASSWORD

利用できる機能:

- 受付開始
- 受付終了
- 昼休み終了時刻設定
- プレイヤー一覧
- 個別停止
- 全員停止
- 管理者としてゲーム起動

ログイン後:

/admin/dashboard

### 受付担当

環境変数:

RECEPTION_PASSWORD

利用できる機能:

- 受付専用QRコード画面
- QRコード自動更新
- 受付PCハートビート

ログイン後:

/reception

受付担当はプレイヤー停止APIを使用できません。

## 必要な環境変数

ADMIN_PASSWORD

管理者用パスワード。

RECEPTION_PASSWORD

受付担当用パスワード。

SECRET_KEY

Flask用の秘密鍵。

32文字以上にしてください。

管理者パスワードと受付パスワードは
異なる値にしてください。

## Renderへのデプロイ

GitHubにファイルをアップロードします。

RenderのBlueprintまたはWeb Serviceでデプロイします。

RenderのEnvironmentに次の値を設定してください。

ADMIN_PASSWORD

RECEPTION_PASSWORD

SECRET_KEY

SECRET_KEYはrender.yamlのgenerateValueを使用できます。

## Gunicorn

必ず1ワーカーで起動します。

```bash
gunicorn app:app --workers 1 --threads 8 --bind 0.0.0.0:$PORT
