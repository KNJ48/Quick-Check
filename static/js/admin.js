const csrf = window.ADMIN_CSRF;

let currentGeneration = null;
let qrExpireAt = 0;
let polling = false;
let qrInstance = null;

const $ = id => document.getElementById(id);


async function apiPost(url, data = {}) {

    const response = await fetch(url, {

        method: "POST",

        credentials: "same-origin",

        headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf
        },

        body: JSON.stringify(data)
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.error || "通信エラー"
        );
    }

    return result;
}


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


function clearQr() {

    $("qrcode").innerHTML = "";

    $("qrPlaceholder").style.display = "block";

    $("qrPlayer").textContent = "PLAYER ---";

    $("qrRemaining").textContent = "--:--";

    currentGeneration = null;

    qrExpireAt = 0;
}


function showQr(qr) {

    if (currentGeneration === qr.generation) {
        return;
    }

    currentGeneration = qr.generation;

    $("qrcode").innerHTML = "";

    $("qrPlaceholder").style.display = "none";

    $("qrPlayer").textContent =
        "PLAYER " + qr.player_id;

    new QRCode($("qrcode"), {

        text: qr.url,

        width: 280,

        height: 280,

        colorDark: "#08111f",

        colorLight: "#ffffff",

        correctLevel: QRCode.CorrectLevel.M

    });

    qrExpireAt =
        Date.now() + qr.remaining_seconds * 1000;

    const box = document.querySelector(".qr-box");

    box.classList.remove("qr-change");

    void box.offsetWidth;

    box.classList.add("qr-change");
}


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


function statusLabel(status) {

    const labels = {

        playing: "🟢 プレイ中",

        disconnected: "🔴 通信切断",

        revoked: "⛔ 停止済み",

        expired: "⌛ 時間切れ"

    };

    return labels[status] || status;
}


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
        .sort((a, b) =>
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

                button.addEventListener("click", async () => {

                    if (!confirm(
                        player.player_id +
                        " のプレイを停止しますか？"
                    )) {
                        return;
                    }

                    try {

                        await apiPost(
                            "/api/admin/revoke/" +
                            encodeURIComponent(player.player_id)
                        );

                        await poll();

                    } catch (error) {

                        alert(error.message);
                    }
                });

                row.appendChild(button);
            }

            container.appendChild(row);
        });
}


async function poll() {

    if (polling) {
        return;
    }

    polling = true;

    try {

        const data = await apiPost(
            "/api/admin/heartbeat"
        );

        $("connectionStatus").textContent =
            "🟢 サーバー接続中";

        $("connectionStatus").className =
            "connected";

        $("statusText").textContent =
            data.reception ? "受付中" : "停止中";

        $("receptionStatus").textContent =
            data.reception ? "受付中" : "受付停止中";

        $("playingCount").textContent =
            data.playing_count;

        if (data.deadline) {

            const date = new Date(
                data.deadline * 1000
            );

            $("deadlineText").textContent =
                date.toLocaleTimeString(
                    "ja-JP",
                    {
                        timeZone: "Asia/Tokyo",
                        hour: "2-digit",
                        minute: "2-digit"
                    }
                );

        } else {

            $("deadlineText").textContent =
                "未設定";
        }

        if (data.qr) {

            showQr(data.qr);

        } else {

            clearQr();
        }

        renderPlayers(data.players);

    } catch (error) {

        $("connectionStatus").textContent =
            "🔴 サーバー切断";

        $("connectionStatus").className =
            "disconnected";

    } finally {

        polling = false;
    }
}


$("startButton").addEventListener("click", async () => {

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

        await poll();

    } catch (error) {

        alert(error.message);
    }
});


$("stopButton").addEventListener("click", async () => {

    if (!confirm("受付を終了しますか？")) {
        return;
    }

    try {

        await apiPost("/api/admin/stop");

        await poll();

    } catch (error) {

        alert(error.message);
    }
});


$("revokeAllButton").addEventListener("click", async () => {

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
});


$("fullscreenButton").addEventListener("click", () => {

    if (!document.fullscreenElement) {

        document.documentElement.requestFullscreen();

    } else {

        document.exitFullscreen();
    }
});


$("logoutButton").addEventListener("click", async () => {

    try {

        await apiPost("/admin/logout");

        location.href = "/admin";

    } catch (error) {

        alert(error.message);
    }
});


setInterval(updateQrTimer, 250);

setInterval(poll, 3000);

poll();