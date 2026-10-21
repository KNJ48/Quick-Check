"use strict";

// ========================================
// 科学技術部 ゲーム制御システム
// ========================================


// ========================================
// 設定取得
// ========================================

function getMeta(name) {

    const element = document.querySelector(
        `meta[name="${name}"]`
    );

    return element
        ? element.getAttribute("content")
        : null;
}


const config = {

    playerId: getMeta("game-player-id"),

    adminMode:
        getMeta("game-admin-mode") === "true",

    gameUrl: getMeta("game-url")

};


// ========================================
// DOM
// ========================================

const container = document.getElementById(
    "gameContainer"
);

const overlay = document.getElementById(
    "gameOverlay"
);

const overlayTitle = document.getElementById(
    "overlayTitle"
);

const overlayMessage = document.getElementById(
    "overlayMessage"
);

const remainingLabel = document.getElementById(
    "remainingTime"
);


// ========================================
// 状態管理
// ========================================

let lastSuccess = 0;

let remainingSeconds = null;

let remainingReference = 0;

let heartbeatRunning = false;

let permanentlyStopped = false;

let iframe = null;

let connectionBlocked = false;


// ========================================
// iframe生成
// ========================================

function createGameIframe() {

    if (iframe || permanentlyStopped) {
        return;
    }

    if (!config.gameUrl) {

        blockGame(
            "ゲームを起動できません",
            "ゲームURLが設定されていません。",
            true
        );

        return;
    }


    iframe = document.createElement("iframe");

    iframe.src = config.gameUrl;

    iframe.className = "game-iframe";

    iframe.referrerPolicy = "no-referrer";

    iframe.setAttribute(
        "allowfullscreen",
        ""
    );

    container.appendChild(iframe);
}


// ========================================
// iframe削除
// ========================================

function removeGameIframe() {

    if (iframe) {

        iframe.remove();

        iframe = null;
    }
}


// ========================================
// 停止画面
// ========================================

function showOverlay(title, message) {

    overlayTitle.textContent = title;

    overlayMessage.textContent = message;

    overlay.classList.remove("hidden");
}


function hideOverlay() {

    overlay.classList.add("hidden");
}


// ========================================
// ゲーム停止
// ========================================

function blockGame(
    title,
    message,
    permanent = false
) {

    removeGameIframe();

    if (permanent) {

        permanentlyStopped = true;
    }

    connectionBlocked = true;

    showOverlay(title, message);
}


// ========================================
// 残り時間表示
// ========================================

function formatRemaining(seconds) {

    seconds = Math.max(
        0,
        Math.floor(seconds)
    );

    const minutes = Math.floor(seconds / 60);

    const secs = seconds % 60;

    return (
        String(minutes).padStart(2, "0") +
        ":" +
        String(secs).padStart(2, "0")
    );
}


// ========================================
// サーバー時刻ベースの残り時間
// ========================================

function remainingNow() {

    if (remainingSeconds === null) {
        return null;
    }

    const elapsed =
        (
            performance.now() -
            remainingReference
        ) / 1000;

    return Math.max(
        0,
        remainingSeconds - elapsed
    );
}


// ========================================
// タイマー更新
// ========================================

function updateTimer() {

    if (config.adminMode) {
        return;
    }

    if (permanentlyStopped) {
        return;
    }

    const remaining = remainingNow();

    if (remaining === null) {

        remainingLabel.textContent =
            "確認中...";

        return;
    }


    remainingLabel.textContent =
        "残り時間 " +
        formatRemaining(
            Math.ceil(remaining)
        );


    // 終了時刻に到達
    if (remaining <= 0) {

        blockGame(
            "公開時間は終了しました。",
            "遊んでくれてありがとう！",
            true
        );
    }
}


// ========================================
// ハートビート
// ========================================

async function heartbeat() {

    if (
        heartbeatRunning ||
        permanentlyStopped
    ) {
        return;
    }

    heartbeatRunning = true;


    const endpoint = config.adminMode
        ? "/api/admin/game-check"
        : "/api/player/heartbeat";


    const controller = new AbortController();


    const timeout = setTimeout(
        () => controller.abort(),
        8000
    );


    try {

        const response = await fetch(
            endpoint,
            {

                method: "POST",

                credentials: "same-origin",

                cache: "no-store",

                signal: controller.signal

            }
        );


        let data;

        try {

            data = await response.json();

        } catch (error) {

            throw new Error(
                "invalid_json_response"
            );
        }


        // 認証失敗
        if (
            !response.ok ||
            !data.allowed
        ) {

            const reason =
                data.reason || "invalid_session";


            if (reason === "time_expired") {

                blockGame(
                    "公開時間は終了しました。",
                    "遊んでくれてありがとう！",
                    true
                );

            } else if (reason === "revoked") {

                blockGame(
                    "プレイが停止されました。",
                    "管理者によって停止されました。",
                    true
                );

            } else {

                blockGame(
                    "認証が無効です。",
                    "受付で再度認証してください。",
                    true
                );
            }

            return;
        }


        // 認証成功
        lastSuccess = performance.now();

        connectionBlocked = false;


        // 一般生徒モード
        if (!config.adminMode) {

            remainingSeconds =
                data.remaining_seconds;

            remainingReference =
                performance.now();
        }


        hideOverlay();

        createGameIframe();


    } catch (error) {

        console.error(
            "ハートビート通信エラー:",
            error
        );


        const elapsed =
            (
                performance.now() -
                lastSuccess
            ) / 1000;


        // 15秒以上通信できない
        if (
            lastSuccess === 0 ||
            elapsed >= 15
        ) {

            blockGame(
                "サーバーとの接続を確認しています",
                "通信が回復するまでお待ちください。"
            );
        }


    } finally {

        clearTimeout(timeout);

        heartbeatRunning = false;
    }
}


// ========================================
// 接続監視
// ========================================

function monitorConnection() {

    if (permanentlyStopped) {
        return;
    }


    if (!lastSuccess) {
        return;
    }


    const elapsed =
        (
            performance.now() -
            lastSuccess
        ) / 1000;


    if (elapsed >= 15) {

        if (!connectionBlocked) {

            blockGame(
                "サーバーとの接続を確認しています",
                "通信が回復するまでお待ちください。"
            );
        }
    }
}


// ========================================
// タブ復帰時
// ========================================

document.addEventListener(
    "visibilitychange",
    () => {

        if (!document.hidden) {

            heartbeat();
        }
    }
);


// ========================================
// 初期化
// ========================================

function initialize() {

    if (!config.playerId || !config.gameUrl) {

        blockGame(
            "ゲーム設定エラー",
            "ゲームの設定情報を取得できませんでした。",
            true
        );

        return;
    }


    // 初回はサーバー認証後にiframe生成
    heartbeat();


    // 5秒ごとのハートビート
    setInterval(
        heartbeat,
        5000
    );


    // 残り時間更新
    setInterval(
        updateTimer,
        250
    );


    // 接続監視
    setInterval(
        monitorConnection,
        1000
    );
}


// 起動
initialize();
