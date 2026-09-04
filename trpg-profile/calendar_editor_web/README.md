# 卓予定カレンダー Web編集版

このREADMEは、CloudflareやGitHubに慣れていなくても、所有者用の編集画面を最初から公開し、実際に保存できるところまで進められるように書いた手順書です。

編集画面は一般公開しません。Cloudflare Accessで所有者のメールアドレスだけを許可し、保存処理はブラウザではなくCloudflare Pages FunctionsからGitHubへ行います。

## 最初に知っておくこと

### 完成後の構成

このリポジトリには、用途が違う2つのWebサイトがあります。

| サイト | 利用者 | 役割 |
| --- | --- | --- |
| 既存の公開Pages | 誰でも閲覧可能 | calendar.htmlで卓予定を見る |
| 新しい編集用Pages | 所有者だけ | calendar.jsonを編集してGitHubへ保存する |

編集用Pagesを作るとき、既存の公開Pagesプロジェクトの設定は変更しません。Cloudflare Dashboardで、同じGitHubリポジトリから別のPagesプロジェクトを1つ追加します。

### 保存の流れ

1. 所有者が編集用URLを開く。
2. Cloudflare Accessがログインを求める。
3. 許可されたメールアドレスなら編集画面が開く。
4. 編集画面がPages Functionへ読込を依頼する。
5. FunctionがGitHubから trpg-profile/data/calendar.json を取得する。
6. 画面内で編集し、「GitHubへ保存」を押す。
7. FunctionがGitHubへ新しいコミットを作る。
8. GitHubへのpushをきっかけに、既存の公開Pagesが再デプロイされる。
9. 公開 calendar.html に変更が反映される。

「GitHubへ保存」が成功した時点ではGitHubへのコミットまで完了しています。公開サイトへの反映は、既存Pagesの再デプロイ完了後です。

### 安全のための仕組み

- GitHubトークンはCloudflareのSecretにだけ保存し、ブラウザへ渡しません。
- Cloudflare Accessを通過しただけでなく、FunctionでもJWTの署名、issuer、audience、有効期限、メールアドレスを検証します。
- APIは同一サイトからのリクエストだけを受け付けます。
- 読み込んだ時点のGitHub blob SHAと保存直前のSHAが違う場合は、他の更新を上書きせず409エラーにします。
- 認証設定が不足している状態では、編集画面を公開せずエラーで停止するfail-closed構成です。

## 作業前チェック

次のものを用意します。

- GitHubの対象リポジトリを管理できるアカウント
- Cloudflareアカウント
- Cloudflare Zero Trustで利用できるログイン方法
- 編集を許可する自分のメールアドレス
- Node.js 20以上とnpm（ローカル確認をする場合）

設定中に何度も使う値を、先にメモしておくと迷いません。

| 項目 | このプロジェクトの値 |
| --- | --- |
| GitHub所有者 | raindex9630 |
| GitHubリポジトリ | trpg-profile |
| 本番ブランチ | main |
| GitHub上のJSONパス | trpg-profile/data/calendar.json |
| CloudflareのRoot directory | trpg-profile/calendar_editor_web |
| Build output directory | public |
| 編集用Pagesプロジェクト名 | 自分で決める。例: trpg-calendar-editor |
| 許可メールアドレス | 自分のメールアドレス |
| Access team domain | 設定途中で確認する |
| Production用Access AUD | 設定途中で確認する |
| Preview用Access AUD | 設定途中で確認する |

GitHub連携時にCloudflareが trpg-profile フォルダ内をリポジトリルートとして表示する場合だけ、Root directoryは calendar_editor_web になります。通常、このリポジトリの現在の配置では trpg-profile/calendar_editor_web です。

## 1. 先にローカルで画面を確認する

この作業はCloudflareやGitHubを変更しません。PowerShellで次を実行します。

~~~powershell
cd C:\Users\raindex963\Documents\GitHub\trpg-profile\trpg-profile\calendar_editor_web
npm install
npm test
npm run preview
~~~

ブラウザで次を開きます。

~~~text
http://127.0.0.1:8788
~~~

確認すること:

- 画面が左「セッション」、中央「カレンダー」、右「詳細」の3列で表示される。
- 既存の data/calendar.json の予定が見える。
- 小さい画面では3列が縦に並び、横スクロールが出ない。
- 入力、反映、Undo、Redo、JSON退避を試せる。

このプレビューで「GitHubへ保存」を押しても、保存先はプレビューサーバーのメモリだけです。実ファイルもGitHubも変更しません。サーバーを止めると変更は消えます。終了するときはPowerShellで Ctrl+C を押します。

### Wranglerのローカル起動について

Pages Functions自体は次で起動できます。

~~~powershell
Copy-Item .dev.vars.example .dev.vars
# .dev.varsへローカル検証用の実値を入力
npm run dev
~~~

ただし、全ページに適用されるmiddlewareが実際のCloudflare Access JWTを要求します。通常のlocalhostにはAccess JWTがないため、認証エラーになるのが正常です。

- 画面操作の確認: npm run preview
- JWT、API、SHA競合の確認: npm test
- 本番の結合確認: Accessを設定したデプロイ先

.dev.vars はGit対象外です。実トークンを .dev.vars.example やソースへ書かないでください。

## 2. GitHubの保存用トークンを作る

GitHubでfine-grained personal access tokenを作成します。クラシックトークンではなく、対象リポジトリと権限を限定できるfine-grained tokenを使います。

1. GitHubへログインする。
2. 右上のプロフィール画像から Settings を開く。
3. 左メニューの一番下付近にある Developer settings を開く。
4. Personal access tokens を開く。
5. Fine-grained tokens を開く。
6. Generate new token を押す。
7. 必要ならGitHubのパスワードや2段階認証を入力する。
8. Token nameへ用途が分かる名前を入れる。例: Cloudflare calendar editor
9. Expirationは No expiration を選ぶ。この運用では定期的なトークン交換を行わない。
10. Resource ownerで raindex9630 を選ぶ。
11. Repository accessで Only select repositories を選ぶ。
12. Select repositoriesから trpg-profile だけを選ぶ。
13. Permissions欄で Repositories タブが選ばれていることを確認する。
14. 右上の「＋ Add permissions」を押す。
15. 表示された権限一覧から Contents を選ぶ。
16. 追加されたContentsのAccessを Read and write にする。
17. Repositoriesの横の件数が2になっていることを確認する。内訳は、自分で追加した Contents（Read and write）と、GitHubが必須権限として自動追加する Metadata（Read-only）。
18. Accountタブには何も追加しない。
19. Generate token を押す。
20. 表示されたトークンを一時的に安全な場所へコピーする。

トークンはこの画面を離れると再表示できません。README、ソース、チャット、スクリーンショットには貼らず、後述のCloudflare Secretへ直接登録します。

No expirationを選ぶため、期限による定期交換は不要です。ただし、トークンの漏えいが疑われる場合、GitHubアカウントやリポジトリの管理方針が変わった場合は、「10. トークンの交換と漏えい時の対応」の手順で古いトークンをRevokeし、新しいトークンへ交換してください。

GitHub公式:

- [Fine-grained personal access tokenの作成と管理](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Contents APIの必要権限](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)

## 3. 編集用Cloudflare Pagesを作る

この手順は、編集版のファイルがGitHubの対象ブランチへpush済みであることを前提にします。

1. [Cloudflare Dashboard](https://dash.cloudflare.com/)へログインする。
2. Workers & Pages を開く。
3. Create application を押す。
4. Pages タブを選ぶ。
5. Connect to Git を選ぶ。
6. GitHubアカウントを接続する。
7. raindex9630/trpg-profile を選ぶ。
8. Begin setup または選択後の設定ボタンを押す。
9. Project nameへ既存の公開Pagesとは別の名前を入れる。例: trpg-calendar-editor
10. Production branchで main を選ぶ。
11. Build settingsを次のように設定する。

| Cloudflareの項目 | 入力値 |
| --- | --- |
| Framework preset | None |
| Build command | exit 0 |
| Build output directory | public |
| Root directory（Advanced） | trpg-profile/calendar_editor_web |

12. Save and Deploy を押す。

Build commandの exit 0 は、ビルド工程のない静的サイトでPages Functionsを利用するための設定です。FunctionsはRoot directory直下の functions フォルダから自動検出されます。

初回デプロイ直後は、まだ認証用環境変数がないため、URLを開いても「認証設定が不足しています」と表示されます。これは編集画面を無防備に公開しないための正常な状態です。

Cloudflare公式:

- [Git integrationでPagesを作成する](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [PagesのBuild configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [ビルド不要の静的サイトをデプロイする](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)

## 4. Cloudflare Accessで編集サイトを保護する

ここが最重要です。Preview URLだけでなく、Productionの pages.dev URLも保護します。

### 4-1. まずPreview protectionを有効にする

1. Cloudflare Dashboardの Workers & Pages を開く。
2. 作成した編集用Pagesプロジェクトを選ぶ。
3. Settings を開く。
4. General 内の Access policy または Preview deployment access を探す。
5. Enable access policy を選ぶ。
6. Manage Access policy を開く。

Pagesのこの機能は、最初は通常「Preview deployment」を保護します。Productionの project-name.pages.dev は、この操作だけでは保護されません。

### 4-2. Production用Access applicationを作る

Cloudflare公式のPages向け手順では、自動作成されたPreview用applicationを一度Production用へ変更し、その後Preview protectionを再度有効にします。

1. Zero Trust Dashboardの Access controls → Applications を開く。
2. Pages用に自動作成されたapplicationを選ぶ。
3. Configure を押す。
4. Application nameを分かりやすいProduction用の名前へ変更する。例: trpg-calendar-editor-production
5. Public hostnameにあるサブドメイン先頭のワイルドカード「*」を削除する。
6. Productionの project-name.pages.dev を対象にした状態で保存する。
7. Pagesプロジェクトの Settings → General へ戻る。
8. Enable access policy をもう一度選び、Preview用applicationを新しく作る。

最後にApplications一覧へ、次の2つがあることを確認します。

- Productionの project-name.pages.dev を保護するapplication
- Previewの *.project-name.pages.dev を保護するapplication

カスタムドメインを編集サイトへ追加した場合、そのドメイン用のSelf-hosted applicationも別途必要です。

Cloudflare公式:

- [PagesのPreview deployment access](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Production pages.devもAccessで保護する手順](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain)

### 4-3. 許可するメールアドレスを1件だけにする

Production用とPreview用の両方で行います。

1. Zero Trust Dashboardの Access controls → Applications を開く。
2. 対象applicationを選ぶ。
3. Policiesを開く。
4. Add a policy、または既存policyのEditを押す。
5. Action / Decisionを Allow にする。
6. Includeルールで Emails を選ぶ。
7. 所有者のメールアドレスを入力する。
8. Everyone、Emails ending in、Bypassなど、範囲が広いルールが残っていないことを確認する。
9. 保存する。
10. もう一方のapplicationにも同じ設定を行う。

ログイン方法がまだない場合は、Zero Trustの Settings → Authentication でOne-time PINや利用するIdentity Providerを有効にします。

### 4-4. team domainとAUDを控える

環境変数へ入れるため、次の3つを控えます。

#### Access team domain

Accessログイン画面へ移動したときのホスト名が team-name.cloudflareaccess.com です。環境変数には次の形で入力します。

~~~text
https://team-name.cloudflareaccess.com
~~~

末尾のスラッシュは付けません。

#### Production用AUD

1. Access controls → Applications でProduction用applicationを開く。
2. Configure → Additional settings を開く。
3. Application Audience (AUD) Tag をコピーする。

#### Preview用AUD

同じ手順でPreview用applicationのAUDをコピーします。

ProductionとPreviewは別applicationなので、通常はAUDも別です。次の手順で、Cloudflare PagesのProduction環境とPreview環境へ別々に設定します。

Cloudflare公式:

- [Access JWTの検証項目とAUDの確認場所](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

## 5. Pagesへ環境変数とSecretを登録する

1. Cloudflare Dashboardの Workers & Pages を開く。
2. 編集用Pagesプロジェクトを選ぶ。
3. Settings を開く。
4. Variables and Secrets を開く。
5. Production環境へ下表の値を追加する。
6. Preview環境へも同じ項目を追加する。

値を追加するとき、GITHUB_TOKENは必ずEncrypt / Secretを選びます。ALLOWED_EMAILも個人情報を画面上で隠したい場合はSecretにします。

### Production環境

| 名前 | 種類 | 値 |
| --- | --- | --- |
| GITHUB_TOKEN | Secret | 手順2で作ったfine-grained token |
| GITHUB_OWNER | Variable | raindex9630 |
| GITHUB_REPO | Variable | trpg-profile |
| GITHUB_BRANCH | Variable | main |
| GITHUB_CALENDAR_PATH | Variable | trpg-profile/data/calendar.json |
| CF_ACCESS_TEAM_DOMAIN | Variable | https://team-name.cloudflareaccess.com |
| CF_ACCESS_AUD | Variable | Production用applicationのAUD |
| ALLOWED_EMAIL | Secret推奨 | Access policyで許可した自分のメールアドレス |

### Preview環境

| 名前 | 種類 | 値 |
| --- | --- | --- |
| GITHUB_TOKEN | Secret | 同じfine-grained token |
| GITHUB_OWNER | Variable | raindex9630 |
| GITHUB_REPO | Variable | trpg-profile |
| GITHUB_BRANCH | Variable | main |
| GITHUB_CALENDAR_PATH | Variable | trpg-profile/data/calendar.json |
| CF_ACCESS_TEAM_DOMAIN | Variable | Productionと同じteam domain |
| CF_ACCESS_AUD | Variable | Preview用applicationのAUD |
| ALLOWED_EMAIL | Secret推奨 | Productionと同じメールアドレス |

この簡単な構成では、Preview URLから保存してもmainの同じcalendar.jsonへコミットします。Previewを画面確認専用にするか、保存する場合は本番データが変わることを理解した上で使ってください。

Previewを完全に分離したい場合は、GitHubに検証専用ブランチを作り、Preview環境のGITHUB_BRANCHだけをそのブランチ名へ変更します。ブランチが存在しない状態では読込に失敗します。

環境変数を保存したら、新しいデプロイに反映させます。

1. Pagesプロジェクトの Deployments を開く。
2. 最新デプロイのメニューから Retry deployment / Redeploy を選ぶ。
3. Productionと、必要なPreview deploymentを再デプロイする。

CloudflareのSecretは、設定後に作られたデプロイで利用できます。古いデプロイを開いたまま確認しないでください。

Cloudflare公式:

- [Pages FunctionsのVariables and Secrets](https://developers.cloudflare.com/pages/functions/bindings/)

## 6. 初回の動作確認

### 6-1. 認証を確認する

1. Productionの編集URLをシークレットウィンドウで開く。
2. 編集画面ではなくCloudflare Accessのログイン画面が先に出ることを確認する。
3. 許可していないメールアドレスでは入れないことを確認する。
4. ALLOWED_EMAILと同じメールアドレスでログインする。
5. 編集画面が開き、既存予定が表示されることを確認する。
6. Preview URLでも同じようにログインが必要なことを確認する。

Production URLを開いた瞬間に編集画面やJSONが見える場合は、保存テストへ進まずAccess設定を直してください。

### 6-2. 読込を確認する

画面上部に読込エラーがなく、次を確認します。

- ページ名と説明が表示される。
- 今月のカレンダーが表示される。
- 登録済みセッションと予定が表示される。
- 同じ日に複数予定がある場合、日付クリック後の一覧から個別に選べる。

ここでGitHubエラーが出る場合は、GITHUB_TOKEN、GITHUB_OWNER、GITHUB_REPO、GITHUB_BRANCH、GITHUB_CALENDAR_PATHを見直します。

### 6-3. 実際の保存を確認する

保存テストはGitHubへ本物のコミットを作ります。元へ戻しやすい小さな月メモなどで試してください。

1. 中央の月メモを少し変更する。
2. 月メモの「反映」を押す。
3. 画面上部が未保存状態になったことを確認する。
4. 「GitHubへ保存」を押す。
5. 「保存しました」とコミットへのリンクが表示されることを確認する。
6. GitHubで trpg-profile/data/calendar.json を開く。
7. 新しいコミットが作られ、updated_atが日本時間で更新されたことを確認する。
8. 既存の公開PagesプロジェクトのDeploymentsを開く。
9. mainのpushによる新しいデプロイが成功するまで待つ。
10. 公開サイト https://trpg-profile.pages.dev/calendar.html を再読込し、変更を確認する。

テスト用の文言が不要なら、編集画面で元の内容へ戻してもう一度保存します。GitHub履歴には両方のコミットが残ります。

## 7. 普段の使い方

### 「反映」と「GitHubへ保存」は別操作

この編集画面は、入力途中の値を誤って保存しないように二段階になっています。

1. フォームへ入力する。
2. そのフォームの「反映」「変更を反映」「日程を追加」などを押す。
3. 画面内の編集中データへ反映され、上部が未保存になる。
4. 最後に上部の「GitHubへ保存」を押す。

フォームへ入力しただけで「GitHubへ保存」を押しても、まだ反映していない入力はGitHubへ入りません。未反映の入力は画面に残り、保存結果メッセージでも知らせます。

### セッションと日程の違い

- セッション情報: セッション名、種別。同じセッションに属するすべての日程へ共通。
- 日程情報: 日付、時間、予備日、補足、終日・昼・夜。選択した日程だけに適用。

右側に「選択中の日程（この日付のみを編集）」と表示されている場合、時間、予備日、補足を変更しても同じセッションの別日程には影響しません。

### 新しいセッションを作る

1. 左上の「＋ 新規セッション」を押す。
2. 中央カレンダーで1日以上の日付を選ぶ。
3. 右側でセッション名と種別を入力する。
4. 必要なら時間、予備日、補足を設定する。
5. 追加を反映する。
6. 内容を確認して「GitHubへ保存」を押す。

### 既存セッションへ日程を追加する

1. 左のセッション、または既存日程を選ぶ。
2. 右側の「＋ このセッションに日程追加」を押す。
3. 中央カレンダーで追加日を1日以上選ぶ。
4. 日程固有の設定を入力する。
5. 追加を反映する。
6. 「GitHubへ保存」を押す。

### 同じ日の複数予定を編集する

1. 中央カレンダーの日付を押す。
2. 表示された予定名、種別、時間帯の一覧から対象を選ぶ。
3. 右側で選択中の日程を確認する。
4. 変更して「変更を反映」を押す。
5. 「GitHubへ保存」を押す。

### リスケする

1. 対象の日程を選ぶ。
2. 右側の「リスケ」を押す。
3. 中央カレンダーで移動先を1日だけ選ぶ。
4. 「リスケを反映」を押す。
5. 「GitHubへ保存」を押す。

反映前にキャンセルした場合、元の日程は変わりません。

### Undo、Redo、JSON退避

- Undo: 画面内で直前に反映した操作を戻す。
- Redo: Undoした操作をやり直す。
- JSON退避: 現在の編集中データをJSONファイルとしてダウンロードする。

UndoやRedoも画面内の変更です。GitHubの過去コミットを直接取り消す機能ではありません。必要ならUndo後に「GitHubへ保存」を押します。

## 8. 競合が起きたとき

別のブラウザ、Preview、ローカル管理アプリなどが先にGitHubを更新すると、保存時に409 ConflictまたはSHA_CONFLICTが表示されます。これは故障ではなく、古いデータで新しい変更を上書きしないための停止です。

1. まず「JSON退避」で編集中データをダウンロードする。
2. 画面の案内を読み、「最新版を再読込」を選ぶ。
3. GitHubの最新内容を確認する。
4. 必要な変更をもう一度反映する。
5. 「GitHubへ保存」を押す。

自動マージは行いません。通信失敗や競合が起きても、開いている画面の編集中データは保持します。

## 9. エラー別の確認場所

| 画面やAPIの表示 | 主な原因 | 確認する場所 |
| --- | --- | --- |
| AUTH_CONFIG_ERROR / 認証設定が不足 | Access用変数が未設定 | Pages → Settings → Variables and SecretsのCF_ACCESS_TEAM_DOMAIN、CF_ACCESS_AUD、ALLOWED_EMAIL |
| AUTH_REQUIRED | Access JWTがない | Production / PreviewのAccess application、ログイン状態 |
| AUTH_INVALID | team domainかAUDが違う、JWT期限切れ | ProductionとPreviewで正しいAUDを分けたか、team domain末尾に余計なパスがないか |
| EMAIL_NOT_ALLOWED | JWTのメールと許可メールが不一致 | Access policyのEmailsとALLOWED_EMAIL |
| GITHUB_CONFIG_ERROR | GitHub用変数が不足または不正 | GITHUB_TOKEN、OWNER、REPO、BRANCH、CALENDAR_PATH |
| GITHUB_AUTH_FAILED | トークンが無効または権限不足 | tokenの期限、Resource owner、対象repo、Contents Read and write |
| GITHUB_FILE_NOT_FOUND | branchかファイルパスが違う | mainとtrpg-profile/data/calendar.json |
| CALENDAR_JSON_INVALID | GitHub上のJSONが構文エラー | GitHubでcalendar.jsonの直近変更を確認 |
| CALENDAR_DATA_INVALID | JSON形式は読めるがデータ仕様違反 | エラー詳細、タグ、日付、時刻、必須項目 |
| SHA_CONFLICT / HTTP 409 | 読込後に別の更新が入った | JSON退避後に最新版を再読込 |
| ORIGIN_NOT_ALLOWED | 別サイトからAPIを呼んだ | 正式な編集用URLを開いているか |
| GITHUB_UNAVAILABLE / 通信失敗 | GitHub障害または一時的な通信失敗 | 編集内容を保持したまま少し待ち、GitHubの状態を確認 |

環境変数を直したあとは再デプロイが必要です。ブラウザの再読込だけでは、古いデプロイの設定は変わりません。

## 10. トークンの交換と漏えい時の対応

### 通常の期限更新

1. GitHubで同じ最小権限の新しいfine-grained tokenを作る。
2. PagesのProductionとPreviewにあるGITHUB_TOKEN Secretを新しい値へ更新する。
3. ProductionとPreviewを再デプロイする。
4. 編集サイトで読込と小さな保存が成功することを確認する。
5. GitHubで古いトークンをRevokeする。

### 漏えいが疑われる場合

確認を待たず、GitHubで古いトークンを先にRevokeします。その後、新しいトークンを作成し、Cloudflare Secretを更新して再デプロイします。

Access applicationを作り直した場合はAUDも変わるため、CF_ACCESS_AUDを更新します。

## 11. GitHub上の変更を戻す

編集画面には、すでにGitHubへ保存したコミットを直接巻き戻す機能はありません。GitHubの履歴がバックアップになります。

1. GitHubで trpg-profile/data/calendar.json を開く。
2. Historyから戻したい直前の内容を確認する。
3. GitHubのRevert機能を使うか、その内容を編集画面で再入力して保存する。
4. 公開Pagesの再デプロイ完了を確認する。

Revert操作も新しいコミットとして残ります。

## 12. ローカル管理アプリと併用するとき

Web編集後の正本はGitHub上の trpg-profile/data/calendar.json です。

- Web版とPySide6ローカル版を同時に編集しない。
- ローカル版を使う前に、GitHubから最新のcalendar.jsonを取得する。
- 古いローカルJSONを保存してpushすると、Web版の変更を上書きする可能性がある。
- ローカル版にはクラウド同期機能がない。

## 13. 更新後の開発者向け確認

依存関係は jose 6.2.10 と wrangler 4.129.0 に固定しています。

~~~powershell
cd C:\Users\raindex963\Documents\GitHub\trpg-profile\trpg-profile\calendar_editor_web
npm install
npm test
npm run check
~~~

プロジェクト全体の検査:

~~~powershell
cd C:\Users\raindex963\Documents\GitHub\trpg-profile\trpg-profile
tools\run_local_checks.bat
~~~

npm testでは、共通データロジック、実署名したテストJWT、issuer / audience / email検証、GitHub APIモック、入力上限、スキーマ検証、SHA競合、安全なエラー、静的UI要件を確認します。

### 主なファイル

| パス | 役割 |
| --- | --- |
| public/index.html | 編集画面 |
| public/editor.css | 3ペインとレスポンシブ表示 |
| public/editor.js | 編集操作、読込、保存、競合時の表示 |
| public/calendar-core.js | カレンダーデータの共通処理 |
| functions/_middleware.js | Cloudflare Access JWTの検証 |
| functions/api/calendar.js | GitHubからのGETとGitHubへのPUT |
| scripts/preview-server.mjs | GitHubへ書き込まないローカルプレビュー |
| tests/ | 認証、API、データ、UIの自動テスト |
| .dev.vars.example | ローカル用環境変数の項目例。実値は入れない |
| wrangler.jsonc | Pages開発設定 |

## 14. 公開前の最終チェックリスト

- [ ] 公開サイトと編集サイトが別のPagesプロジェクトになっている
- [ ] Production URLを未ログインで開くとAccessログインになる
- [ ] Preview URLも未ログインで開けない
- [ ] 許可メールアドレスが1件だけになっている
- [ ] Production用AUDをProduction環境へ設定した
- [ ] Preview用AUDをPreview環境へ設定した
- [ ] GITHUB_TOKENをVariableではなくSecretへ登録した
- [ ] tokenの対象repoがtrpg-profileだけになっている
- [ ] token権限がContents Read and writeだけになっている
- [ ] GitHub上のパスがtrpg-profile/data/calendar.jsonになっている
- [ ] 実際の読込とテスト保存に成功した
- [ ] GitHubにコミットが作られた
- [ ] 既存の公開Pagesが再デプロイされた
- [ ] 公開calendar.htmlへ変更が反映された

## 既知の制約

- GitHub Contents APIで1つのJSONファイルを更新する構成で、データベースや自動マージはない。
- Preview環境をmainへ向けた場合、Previewからの保存も本番データを変更する。
- 保存後の公開反映時間は、既存の公開Pagesプロジェクトのデプロイ時間に依存する。
- Access、Secret、GitHub tokenの作成と実デプロイは、CloudflareとGitHubの管理画面で行う必要がある。
- 公開 calendar.html の既存のownerクエリは過去月表示用の簡易UI制御であり、編集権限には使用しない。
