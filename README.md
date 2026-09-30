# YouTube Music OMV to ATV Auto-Swapper

Status: **Experimental**

Tampermonkey/Violentmonkey用UserScript。YouTube Musicで公式MV（OMV）を自動的にアルバム音源版（ATV）に置き換えます。

## Overview

YouTube Musicでは、一部の楽曲が公式ミュージックビデオ（OMV: Official Music Video）として配信されるため、音声に映像音が混じっていたり、曲の長さが異なったりします。

このUserScriptは、YouTube Musicの内部API通信（`/youtubei/v1/next`, `/youtubei/v1/player`）をインターセプトし、OMVを自動的にATV（音源版）に差し替えます。

## Features

- `/next` API応答のインターセプト → メタデータ（タイトル/アーティスト）抽出
- 内部検索APIでATVの `videoId` を取得
- `/player` APIリクエストの `videoId` をATVに書き換え
- fetch + XHR 両方のインターセプト対応
- ATVキャッシュ（同じ曲の再検索を回避）
- Promiseベースの同期機構（レースコンディション対策）

## Requirements

- ブラウザ: Chrome / Firefox / Edge / Safari
- 拡張機能: Tampermonkey または Violentmonkey

## Installation / Setup

1. ブラウザに Tampermonkey / Violentmonkey をインストール
2. `youtube-music-omv-atv-swapper.user.js` を新規スクリプトとして貼り付け
3. `https://music.youtube.com/*` で自動実行

## How It Works

```
ユーザーが曲をクリック
    ↓
/next API → レスポンスを解析 → OMVを検出
    ↓
タイトル+アーティストで内部検索APIを叩く
    ↓
ATV videoIdを取得 → キャッシュに保存
    ↓
/player API → videoId を ATV に差し替えて送信
    ↓
音声ストリームがATV（音源版）で再生される
```

## Current Status

- **Version**: 1.2.0（実験的）
- **動作状況**: 基本的なOMV→ATV置換は動作するが、タイミング（レースコンディション）問題が残存
- **TODO**: より堅牢な同期機構、JSONベースの堅牢な置換

## Known Limitations

- 初回再生時にMVが一瞬チラつく可能性あり
- `/next` の検索処理に数100ms〜数秒かかる場合あり
- XHRインターセプトは完璧ではなくCoverageが限定的
- YouTube MusicのAPI変更に依存

## License

All rights reserved.
