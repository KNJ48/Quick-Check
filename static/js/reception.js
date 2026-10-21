"use strict";

// ========================================
// 科学技術部 QRコード受付システム
// 受付専用・操作ボタンなし
// ========================================


// CSRFトークン
const csrfMeta = document.querySelector(
    'meta[name="csrf-token"]'
);

const csrf = csrfMeta
    ? csrfMeta.getAttribute("content")
    : null;


// DOM取得
const $ = id => document.getElementById(id);


// 状態
let currentGeneration = null;

let qrExpireAt = 0;

let polling = false;


// ========================================
// API通信
// ========================================

async function apiPost(url) {

    if (!csrf) {
        throw new Error("csrf_missing");
    }

    const response = await fetch(url, {

        method: "POST",

        credentials: "same-origin",

        cache: "no-store",

        headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf
        },

        body: "{}"
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.error || "通信エラー"
        );
    }

    return result;
}


// ========================================
// 時間表示
// ========================================

function formatTime(seconds) {

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
// QRコード削除
// ========================================

function clearQr(message) {

    $("receptionQr").replaceChildren();

    $("receptionPlaceholder").style.display = "block";

    $("receptionPlaceholder").textContent = message;

    $("receptionPlayer").textContent = "PLAYER ---";

    $("receptionRemaining").textContent = "--:--";

    currentGeneration = null;

    qrExpireAt = 0;
}


// ========================================
// QRコード表示
// ========================================

function showQr(qr) {

    if (currentGeneration === qr.generation) {
        return;
    }

    if (typeof QRCode === "undefined") {

        clearQr(
            "QRコード生成ライブラリを読み込めませんでした"
        );

        return;
    }

    currentGeneration = qr.generation;

    $("receptionQr").replaceChildren();

    $("receptionPlaceholder").style.display = "none";

    $("receptionPlayer").textContent =
        "PLAYER " + qr.player_id;


    new QRCode(
        $("receptionQr"),
        {
            text: qr.url,

            width: 360,

            height: 360,

            colorDark: "#08111f",

            colorLight: "#ffffff",

            correctLevel: QRCode.CorrectLevel.M
        }
    );


    qrExpireAt =
        Date.now() +
        qr.remaining_seconds * 1000;


    // QRコード切り替えアニメーション
    const area = document.querySelector(
        ".reception-qr-area"
    );

    area.classList.remove("qr-change");

    void area.offsetWidth;

    area.classList.add("qr-change");
}


// ========================================
// QRコード残り時間
// ========================================

function updateTimer() {

    if (!qrExpireAt) {
        return;
    }

    const remaining = Math.max(
        0,
        Math.ceil(
            (qrExpireAt - Date.now()) / 1000
        )
    );

    $("receptionRemaining").textContent =
        formatTime(remaining);
}


// ========================================
// 受付PCハートビート
// ========================================

async function poll() {

    if (polling) {
        return;
    }

    polling = true;

    try {

        const data = await apiPost(
            "/api/reception/heartbeat"
        );


        $("receptionStatus").textContent =
            "🟢 サーバー接続中";


        // 受付停止中
        if (!data.reception) {

            clearQr(
                "管理者が受付を開始するまでお待ちください"
            );

            return;
        }


        // QRコード表示
        if (data.qr) {

            showQr(data.qr);

        } else {

            clearQr(
                "QRコードを準備しています..."
            );
        }

    } catch (error) {

        console.error(
            "受付通信エラー:",
            error
        );

        $("receptionStatus").textContent =
            "🔴 接続エラー";

        clearQr(
            "サーバーとの接続を確認しています"
        );

    } finally {

        polling = false;
    }
}


// ========================================
// 定期実行
// ========================================

// QRコード残り時間更新
setInterval(
    updateTimer,
    250
);

// 3秒ごとにサーバーへハートビート
setInterval(
    poll,
    3000
);

// 初回通信
poll();
