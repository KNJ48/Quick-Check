"use strict";

// ========================================
// 科学技術部 ゲーム管理システム
// 管理者画面
// ========================================


// ========================================
// CSRF
// ========================================

const csrfMeta = document.querySelector(
    'meta[name="csrf-token"]'
);

const csrf = csrfMeta
    ? csrfMeta.getAttribute("content")
    : null;


// ========================================
// DOM
// ========================================

const $ = id => document.getElementById(id);


// ========================================
// 状態
// ========================================

let polling = false;

let sessionInvalid = false;

let sessionAlertShown = false;

let currentGeneration = null;

let qrExpireAt = 0;

let qrLibraryErrorShown = false;

let settingsLoaded = false;

let endTimeEdited = false;


// ========================================
// 終了時刻編集
// ========================================

$("endTime").addEventListener(
    "input",
    () => {
        endTimeEdited = true;
    }
);


// ========================================
// API
// ========================================

async function apiPost(url, data = {}) {

    if (!csrf) {

        throw new Error(
            "CSRFトークンを取得できませんでした。"
        );
    }

    const response = await fetch(
        url,
        {
            method: "POST",

            credentials: "same-origin",

            cache: "no-store",

            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf
            },

            body: JSON.stringify(data)
        }
    );

    let result;

    try {

        result = await response.json();

    } catch (error) {

        throw new Error(
            "サーバーから正常な応答がありませんでした。"
        );
    }

    if (!response.ok) {

        if (
            response.status === 401 ||
            result.error === "authentication_required"
        ) {

            sessionInvalid = true;

            throw new Error(
                "管理者セッションが無効です。"
            );
        }

        if (result.error === "csrf_failed") {

            sessionInvalid = true;

            throw new Error(
                "CSRF認証に失敗しました。"
            );
        }

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
// 日本時間
// ========================================

function formatJST(timestamp) {

    if (!timestamp) {
        return null;
    }

    const date = new Date(
        timestamp * 1000
    );

    return date.toLocaleTimeString(
        "ja-JP",
        {
            timeZone: "Asia/Tokyo",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }
    );
}


// ========================================
// 設定復元
// ========================================

function restoreSettings(data) {

    const deadline = formatJST(
        data.deadline
    );

    $("deadlineText").textContent =
        deadline || "未設定";

    if (endTimeEdited) {
        return;
    }

    if (deadline) {

        $("endTime").value = deadline;

    } else if (!settingsLoaded) {

        $("endTime").value = "13:10";
    }

    settingsLoaded = true;
}


// ========================================
// QRコード削除
// ========================================

function clearQr(message) {

    $("qrcode").replaceChildren();

    $("qrPlaceholder").style.display = "block";

    $("qrPlaceholder").textContent = message;

    $("qrPlayer").textContent = "PLAYER ---";

    $("qrRemaining").textContent = "--:--";

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

        if (!qrLibraryErrorShown) {

            qrLibraryErrorShown = true;

            console.error(
                "QRコードライブラリが読み込まれていません"
            );
        }

        clearQr(
            "QRコードライブラリの読み込みに失敗しました"
        );

        return;
    }

    currentGeneration = qr.generation;

    $("qrcode").replaceChildren();

    $("qrPlaceholder").style.display = "none";

    $("qrPlayer").textContent =
        "PLAYER " + qr.player_id;

    new QRCode(
        $("qrcode"),
        {
            text: qr.url,

            width: 280,

            height: 280,

            colorDark: "#08111f",

            colorLight: "#ffffff",

            correctLevel: QRCode.CorrectLevel.M
        }
    );

    qrExpireAt =
        Date.now() +
        qr.remaining_seconds * 1000;

    const box = document.querySelector(".qr-box");

    box.classList.remove("qr-change");

    void box.offsetWidth;

    box.classList.add("qr-change");
}


// ========================================
// QRコード残り時間
// ========================================

function updateQrTimer() {

    if (!qrExpireAt) {
        return;
    }

    const remaining = Math.max(
        0,
        Math.ceil(
            (qrExpireAt - Date.now()) / 1000
        )
    );

    $("qrRemaining").textContent =
        formatTime(remaining);
}


// ========================================
// プレイヤー状態
// ========================================

function statusLabel(status) {

    const labels = {
        playing: "🟢 プレイ中",
        disconnected: "🔴 通信切断",
        revoked: "⛔ 停止済み",
        expired: "⌛ 時間切れ"
    };

    return labels[status] || status;
}


// ========================================
// プレイヤー一覧
// ========================================

function renderPlayers(players) {

    const container = $("playersList");

    container.replaceChildren();

    if (!players.length) {

        const p = document.createElement("p");

        p.className = "empty-message";

        p.textContent = "プレイヤーはいません";

        container.appendChild(p);

        return;
    }

    players
        .slice()
        .sort(
            (a, b) =>
                a.player_id.localeCompare(b.player_id)
        )
        .forEach(player => {

            const row = document.createElement("div");

            row.className = "player-row";

            const info = document.createElement("div");

            info.className = "player-info";

            const name = document.createElement("strong");

            name.textContent =
                "PLAYER " + player.player_id;

            const status = document.createElement("span");

            status.textContent =
                statusLabel(player.status) +
                "（" +
                player.last_seen_seconds +
                "秒前）";

            info.appendChild(name);

            info.appendChild(status);

            row.appendChild(info);

            if (
                player.status !== "revoked" &&
                player.status !== "expired"
            ) {

                const button = document.createElement("button");

                button.className = "danger-button";

                button.textContent = "プレイ停止";

                button.addEventListener(
                    "click",
                    async () => {

                        if (!confirm(
                            "PLAYER " +
                            player.player_id +
                            " を停止しますか？"
                        )) {
                            return;
                        }

                        try {

                            await apiPost(
                                "/api/admin/revoke/" +
                                encodeURIComponent(
                                    player.player_id
                                )
                            );

                            await poll();

                        } catch (error) {

                            alert(error.message);
                        }
                    }
                );

                row.appendChild(button);
            }

            container.appendChild(row);
        });
}


// ========================================
// 管理画面更新
// ========================================

async function poll() {

    if (polling || sessionInvalid) {
        return;
    }

    polling = true;

    try {

        const data = await apiPost(
            "/api/admin/heartbeat"
        );

        // サーバー接続状態
        $("connectionStatus").textContent =
            "🟢 サーバー接続中";

        $("connectionStatus").className =
            "connected";

        // 受付状態
        $("statusText").textContent =
            data.reception
                ? "受付中"
                : "停止中";

        // 受付専用画面の状態
        $("receptionConnection").textContent =
            data.reception_connected
                ? "🟢 接続中"
                : "⚪ 未使用";

        // プレイヤー数
        $("playingCount").textContent =
            data.playing_count;

        // 設定復元
        restoreSettings(data);

        // プレイヤー一覧
        renderPlayers(data.players);

        // QRコード表示
        if (
            data.reception &&
            data.any_staff_connected &&
            data.qr
        ) {

            $("receptionStatus").textContent =
                "🟢 受付中";

            showQr(data.qr);

        } else {

            $("receptionStatus").textContent =
                data.reception
                    ? "接続待機中"
                    : "受付停止中";

            clearQr(
                data.reception
                    ? "接続を確認しています..."
                    : "受付を開始してください"
            );
        }

    } catch (error) {

        console.error(
            "管理画面通信エラー:",
            error
        );

        if (sessionInvalid) {

            $("connectionStatus").textContent =
                "🔴 管理者認証エラー";

            if (!sessionAlertShown) {

                sessionAlertShown = true;

                alert(
                    "管理者セッションが無効になりました。\n" +
                    "再ログインしてください。"
                );
            }

        } else {

            $("connectionStatus").textContent =
                "🔴 サーバー通信エラー";
        }

        $("connectionStatus").className =
            "disconnected";

        $("receptionStatus").textContent =
            "接続確認中";

        clearQr(
            "サーバーとの接続を確認しています"
        );

    } finally {

        polling = false;
    }
}


// ========================================
// 受付開始
// ========================================

$("startButton").addEventListener(
    "click",
    async () => {

        const endTime = $("endTime").value;

        if (!endTime) {

            alert("終了時刻を設定してください");

            return;
        }

        try {

            await apiPost(
                "/api/admin/start",
                {
                    end_time: endTime
                }
            );

            endTimeEdited = false;

            await poll();

        } catch (error) {

            alert(error.message);
        }
    }
);


// ========================================
// 受付終了
// ========================================

$("stopButton").addEventListener(
    "click",
    async () => {

        if (!confirm("受付を終了しますか？")) {
            return;
        }

        try {

            await apiPost("/api/admin/stop");

            await poll();

        } catch (error) {

            alert(error.message);
        }
    }
);


// ========================================
// 全員停止
// ========================================

$("revokeAllButton").addEventListener(
    "click",
    async () => {

        if (!confirm(
            "すべての一般生徒のプレイを停止します。\n" +
            "本当に実行しますか？"
        )) {
            return;
        }

        try {

            await apiPost("/api/admin/revoke-all");

            await poll();

        } catch (error) {

            alert(error.message);
        }
    }
);


// ========================================
// ログアウト
// ========================================

$("logoutButton").addEventListener(
    "click",
    async () => {

        try {

            await apiPost("/admin/logout");

            location.replace("/admin");

        } catch (error) {

            alert(error.message);
        }
    }
);


// ========================================
// 定期更新
// ========================================

// QRコード残り時間表示
setInterval(
    updateQrTimer,
    250
);

// 管理者PCハートビート兼QR更新
setInterval(
    poll,
    1000
);

// 初回読み込み
poll();
