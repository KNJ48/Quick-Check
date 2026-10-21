"use strict";

const csrf = document
    .querySelector('meta[name="csrf-token"]')
    .getAttribute("content");

const $ = id => document.getElementById(id);

let polling = false;


async function apiPost(url, data = {}) {

    const response = await fetch(url, {

        method: "POST",

        credentials: "same-origin",

        cache: "no-store",

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

    players.forEach(player => {

        const row = document.createElement("div");

        row.className = "player-row";

        const info = document.createElement("div");

        info.className = "player-info";

        const name = document.createElement("strong");

        name.textContent = "PLAYER " + player.player_id;

        const status = document.createElement("span");

        status.textContent =
            statusLabel(player.status) +
            "（" + player.last_seen_seconds + "秒前）";

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

            button.onclick = async () => {

                if (!confirm(
                    player.player_id + "を停止しますか？"
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
            };

            row.appendChild(button);
        }

        container.appendChild(row);
    });
}


async function poll() {

    if (polling) return;

    polling = true;

    try {

        const data = await apiPost(
            "/api/admin/heartbeat"
        );

        $("connectionStatus").textContent =
            "🟢 サーバー接続中";

        $("statusText").textContent =
            data.reception ? "受付中" : "停止中";

        $("receptionConnection").textContent =
            data.reception_connected
                ? "🟢 接続中"
                : "🔴 未接続";

        $("playingCount").textContent =
            data.playing_count;

        if (data.deadline) {

            $("deadlineText").textContent =
                new Date(
                    data.deadline * 1000
                ).toLocaleTimeString(
                    "ja-JP",
                    {
                        timeZone: "Asia/Tokyo",
                        hour: "2-digit",
                        minute: "2-digit"
                    }
                );

        } else {

            $("deadlineText").textContent = "未設定";
        }

        renderPlayers(data.players);

    } catch (error) {

        $("connectionStatus").textContent =
            "🔴 通信エラー";

        console.error(error);

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
        "すべての一般生徒を停止しますか？"
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


$("logoutButton").addEventListener("click", async () => {

    try {

        await apiPost("/admin/logout");

        location.replace("/admin");

    } catch (error) {

        alert(error.message);
    }
});


setInterval(poll, 3000);

poll();
