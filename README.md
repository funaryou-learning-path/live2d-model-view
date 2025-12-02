# Live2D Model Viewer

Next.jsを使用したLive2Dモデルのビューワーアプリケーションです。

## セットアップ手順

### 1. リポジトリのクローン
```bash
git clone <repository-url>
cd live2d-model-view
```

### 2. 依存関係のインストール
```bash
docker compose run app npm install
```

### 3. Live2Dモデルの配置
本リポジトリにはLive2Dのモデルデータは含まれていません。
以下の手順で公式のサンプルモデルをダウンロードして配置してください。

1. [Live2D Cubism 公式サンプルデータ配布ページ](https://www.live2d.com/learn/sample/)にアクセスします。
2. 利用規約に同意して、必要なモデル（例: `Hiyori`, `Haru` など）をダウンロードします。
3. ダウンロードしたzipファイルを解凍します。
4. 解凍したモデルのフォルダごと、`next-app/public/live2dModel/` ディレクトリに配置してください。

配置後のディレクトリ構成例:
```
next-app/
  └── public/
       └── live2dModel/
            └── hiyori_free_jp/
                 └── runtime/
                      ├── hiyori_free_t08.model3.json
                      └── ...
```

※ コード内（`app/display/page.tsx`）では `/live2dModel/hiyori_free_jp/runtime/hiyori_free_t08.model3.json` を参照しています。
ダウンロードしたモデルのフォルダ名や構成が異なる場合は、コード側のパスを修正するか、ディレクトリ名を合わせてください。

### 4. アプリケーションの起動
```bash
docker compose up -d --build
```

ブラウザで [http://localhost:3000](http://localhost:3000) にアクセスして確認してください。
