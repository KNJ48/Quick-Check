const config = window.GAME_CONFIG;

const container = document.getElementById("gameContainer");

const overlay = document.getElementById("gameOverlay");

const overlayTitle = document.getElementById("overlayTitle");

const overlayMessage = document.getElementById("overlayMessage");

const remainingLabel = document.getElementById("remainingTime");

let lastSuccess = 0;

let remainingSeconds = null;

let remainingReference = 0;

let heartbeatRunning = false;

let permanentlyStopped = false;

let iframe = null;


function createGameIframe() {

    if (iframe || permanentlyStopped) {
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


function removeGameIframe() {

    if (iframe) {

        iframe.remove();

        iframe = null;
    }
}


function showOverlay(title, message) {

    overlayTitle.textContent = title;

    overlayMessage.textContent = message;

    overlay.classList.remove("hidden");
}


function hideOverlay() {

    overlay.classList.add("hidden");
}


function blockGame(title, message, permanent = false) {

    removeGameIframe();

    if (permanent) {

        permanentlyStopped = true;
    }

    showOverlay(title, message);
}


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


function remainingNow() {

    if (remainingSeconds === null) {
        return null;
    }

    const elapsed =
        (performance.now() - remainingReference) / 1000;

    return Math.max(
        0,
        remainingSeconds - elapsed
    );
}


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
        formatRemaining(Math.ceil(remaining));

    if (remaining <= 0) {

        blockGame(
            "公開時間は終了しました。",
            "遊んでくれてありがとう！",
            true
        );
    }
}


async function heartbeat() {

    if (heartbeatRunning || permanentlyStopped) {
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

        const response = await fetch(endpoint, {

            method: "POST",

            credentials: "same-origin",

            cache: "no-store",

            signal: controller.signal

        });

        const data = await response.json();

        if (!response.ok || !data.allowed) {

            const reason = data.reason || "invalid_session";

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

        lastSuccess = performance.now();

        if (!config.adminMode) {

            remainingSeconds = data.remaining_seconds;

            remainingReference = performance.now();
        }

        hideOverlay();

        createGameIframe();

    } catch (error) {

        const elapsed =
            (performance.now() - lastSuccess) / 1000;

        if (elapsed >= 15) {

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


function monitorConnection() {

    if (permanentlyStopped) {
        return;
    }

    if (!lastSuccess) {
        return;
    }

    const elapsed =
        (performance.now() - lastSuccess) / 1000;

    if (elapsed >= 15) {

        blockGame(
            "サーバーとの接続を確認しています",
            "通信が回復するまでお待ちください。"
        );
    }
}


// 初回はサーバーの許可を確認してからiframeを生成する。
heartbeat();

// 5秒ごとにハートビート
setInterval(heartbeat, 5000);

// 残り時間表示
setInterval(updateTimer, 250);

// 通信切断監視
setInterval(monitorConnection, 1000);

// タブ復帰時に再確認
document.addEventListener(
    "visibilitychange",
    () => {

        if (!document.hidden) {

            heartbeat();
        }
    }
);