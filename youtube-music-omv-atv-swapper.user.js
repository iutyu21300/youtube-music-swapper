// ==UserScript==
// @name         YouTube Music - OMV to ATV Auto-Swapper (v1.2.0)
// @namespace    https://music.youtube.com/
// @version      1.2.0
// @description  fetch + XHR dual intercept, with extended wait
// @match        https://music.youtube.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    console.log("🚀 [YTM Swapper] v1.2.0 Started (fetch + XHR dual intercept)");

    const DEBUG = true;
    function log(tag, msg) {
        if (DEBUG) console.log(`[${tag}]
        ${msg}`);
    }

    // --- Shared state ---
    const nextSyncMap = new Map();
    const atvCache = new Map();

    function extractATVId(obj) {
        let foundId = null;
        function dig(current) {
            if (foundId) return;
            if (current !== null && typeof current === 'object') {
                const type = current?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
                if (type === "MUSIC_VIDEO_TYPE_ATV") {
                    foundId = current.videoId || current.watchEndpoint?.videoId;
                }
                if (!foundId && current.videoId && type === "MUSIC_VIDEO_TYPE_ATV") {
                    foundId = current.videoId;
                }
                for (let key in current) {
                    if (!foundId) dig(current[key]);
                }
            }
        }
        dig(obj);
        return foundId;
    }

    async function searchRealATVId(title, artist) {
        if (!title) return null;
        const query = `${title} ${artist || ''}`.trim();
        if (atvCache.has(query)) {
            log("Cache", `Hit: ${query} -> ${atvCache.get(query)}`);
            return atvCache.get(query);
        }

        try {
            const apiKey = window.ytcfg?.get('INNERTUBE_API_KEY');
            const context = window.ytcfg?.get('INNERTUBE_CONTEXT');
            if (!apiKey || !context) {
                log("Search", "⚠️ INNERTUBE_API_KEY または CONTEXT が未取得");
                return null;
            }

            const res = await window.fetch(`/youtubei/v1/search?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context: context, query: query })
            });

            const id = extractATVId(await res.json());
            if (id) {
                atvCache.set(query, id);
                log("Search", `🔍 新規取得: ${query} ->
                ${id}`);
            } else {
                log("Search", `⚠️ ATV ID 未発見: ${query}`);
            }
            return id;
        } catch (err) {
            log("Search", `❌ エラー: ${err.message}`);
            return null;
        }
    }

    // --- FALLBACK: original fetch (wrapped early) ---
    // window.fetch がまだ本物の間に保存
    const _nativeFetch = window.fetch.bind(window);

    // --- Interceptor: process /next response ---
    async function interceptNext(requestUrl, args) {
        let reqBody = null;
        try {
            const bodyStr = args[1]?.body;
            if (bodyStr) reqBody = JSON.parse(bodyStr);
        } catch(e) {}

        const reqVideoId = reqBody?.videoId;

        let resolveSync = null;
        if (reqVideoId) {
            const syncPromise = new Promise(r => { resolveSync = r; });
            nextSyncMap.set(reqVideoId, syncPromise);
        }

        const response = await _nativeFetch(...args);
        let mainAtvId = null;
        let isModified = false;
        let modifiedText = "";

        try {
            const clone = response.clone();
            modifiedText = await clone.text();
            const data = JSON.parse(modifiedText);

            const tabs = data?.contents?.singleColumnMusicWatchNextResultsRenderer
                ?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
            const queueItems = tabs?.[0]?.tabRenderer?.content
                ?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents;

            if (queueItems) {
                log("Next", `📋 キュー内 ${queueItems.length}
                件を処理`);
                const searchPromises = [];

                for (const item of queueItems) {
                    const r = item?.playlistPanelVideoRenderer;
                    if (!r) continue;
                    const type = r?.navigationEndpoint?.watchEndpoint
                        ?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;

                    if (type === "MUSIC_VIDEO_TYPE_OMV") {
                        const title = r?.title?.runs?.[0]?.text;
                        const artist = r?.longBylineText?.runs?.[0]?.text
                            || r?.shortBylineText?.runs?.[0]?.text;
                        const oldId = r.videoId;

                        log("Next", `🎯 OMV検出: "${title}" (${oldId})`);

                        const p = searchRealATVId(title, artist).then(realAtvId => {
                            if (realAtvId && oldId) {
                                if (oldId === reqVideoId) mainAtvId = realAtvId;
                                modifiedText = modifiedText
                                    .replaceAll(oldId, realAtvId)
                                    .replaceAll("MUSIC_VIDEO_TYPE_OMV", "MUSIC_VIDEO_TYPE_ATV");
                                isModified = true;
                                log("Next", `✅ 置換: ${oldId} -> ${realAtvId}`);
                            }
                        });
                        searchPromises.push(p);
                    }
                }
                await Promise.all(searchPromises);
            }
        } catch (err) {
            log("Next", `❌ Parse error:
            ${err.message}`);
        } finally {
            if (resolveSync) resolveSync(mainAtvId);
        }

        if (isModified) {
            log("Next", "📤 改変レスポンスを返却");
            return new Response(modifiedText, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
            });
        }
        return response;
    }

    // --- Interceptor: process /player request ---
    async function interceptPlayer(requestUrl, args) {
        let reqBody = null;
        try {
            const bodyStr = args[1]?.body;
            if (bodyStr) reqBody = JSON.parse(bodyStr);
        } catch(e) {}

        const reqVideoId = reqBody?.videoId;
        if (!reqVideoId) {
            return _nativeFetch(...args);
        }

        log("Player", `📥 リクエスト到着: videoId=${reqVideoId}`);

        // 最大3秒待機
        for (let i = 0; i < 150; i++) {
            if (nextSyncMap.has(reqVideoId)) break;
            await new Promise(r => setTimeout(r, 20));
        }

        if (nextSyncMap.has(reqVideoId)) {
            log("Player", "⏳ /next の検索完了を待機中...");
            const realAtvId = await nextSyncMap.get(reqVideoId);

            if (realAtvId && realAtvId !== reqVideoId) {
                log("Player", `🎬 差し替え: ${reqVideoId} -> ${realAtvId}`);
                reqBody.videoId = realAtvId;
                const newArgs = [...args];
                newArgs[1] = { ...args[1], body: JSON.stringify(reqBody) };
                return _nativeFetch(newArgs[0], newArgs[1]);
            } else {
                log("Player", `⚠️ 差し替え不要 (realAtvId=${realAtvId})`);
            }
        } else {
            log("Player", `⚠️ タイムアウト: nextSyncMap に ${reqVideoId}
            不在`);
        }

        return _nativeFetch(...args);
    }

    // ================================
    //  1. FETCH INTERCEPT
    // ================================
    window.fetch = async (...args) => {
        const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url;

        if (requestUrl && requestUrl.includes('/youtubei/v1/')) {
            try {
                if (requestUrl.includes('/youtubei/v1/next')) {
                    return await interceptNext(requestUrl, args);
                }
                if (requestUrl.includes('/youtubei/v1/player')) {
                    return await interceptPlayer(requestUrl, args);
                }
            } catch (e) {
                log("Fetch", `❌ 全体エラー: ${e.message}`);
            }
        }
        return _nativeFetch(...args);
    };

    // ================================
    //  2. XHR INTERCEPT
    // ================================
    const NativeXHR = window.XMLHttpRequest;
    const XHR_OPEN = NativeXHR.prototype.open;
    const XHR_SEND = NativeXHR.prototype.send;

    NativeXHR.prototype.open = function (method, url, ...rest) {
        this._hermes_method = method;
        this._hermes_url = (url instanceof URL) ? url.href : String(url);
        return XHR_OPEN.apply(this, [method, url, ...rest]);
    };

    NativeXHR.prototype.send = function (body) {
        const url = this._hermes_url;
        const method = this._hermes_method;

        if (url && url.includes('/youtubei/v1/')) {
            const xhr = this;
            let reqBody = null;
            try { if (body) reqBody = JSON.parse(body); } catch(e) {}
            const reqVideoId = reqBody?.videoId;

            if (url.includes('/youtubei/v1/player') && reqVideoId) {
                log("XHR", `📥 Playerリクエスト:
                videoId=${reqVideoId}`);

                // 非同期で待機 → videoId 差し替え → 再送
                (async () => {
                    for (let i = 0; i < 150; i++) {
                        if (nextSyncMap.has(reqVideoId)) break;
                        await new Promise(r => setTimeout(r, 20));
                    }

                    if (nextSyncMap.has(reqVideoId)) {
                        log("XHR", "⏳ /next の検索完了を待機中...");
                        const realAtvId = await nextSyncMap.get(reqVideoId);

                        if (realAtvId && realAtvId !== reqVideoId) {
                            log("XHR", `🎬 差し替え: ${reqVideoId} -> ${realAtvId}`);
                            reqBody.videoId = realAtvId;
                            body = JSON.stringify(reqBody);
                        }
                    } else {
                        log("XHR", `⚠️ タイムアウト: nextSyncMap 不在`);
                    }

                    // 本来のXHRのsendを呼び出す（ただしloadstartなどの前に割り込むため、手動dispatch）
                    // → 既にopen済みなので、差し替えたbodyでsendし直す
                    const nativeSend = XHR_SEND.bind(xhr);
                    nativeSend(body);
                })();

                return; // すぐには返さない（非同期処理が完了してからsendし直し）
            }
        }

        return XHR_SEND.call(this, body);
    };

    log("Init", "✅ fetch + XHR 両方のインターセプト設定完了");
})();