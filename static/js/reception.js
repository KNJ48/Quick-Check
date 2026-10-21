"use strict";

const csrf = document
    .querySelector('meta[name="csrf-token"]')
    .getAttribute("content");

const $ = id => document.getElementById(id);

let currentGeneration = null;

let qrExpireAt = 0;

let polling = false;


async function apiPost(url) {

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


function formatTime(seconds) {

    seconds = Math.max(
        0,
        Math.floor(seconds)
    );

    return (
        String(
            Math.floor(seconds / 60)
        ).padStart(2, "0") +
        ":" +
        String(
            seconds % 60
        ).padStart(2, "0")
    );
}


function clearQr(message) {

    $("receptionQr").replaceChildren();

    $("receptionPlaceholder").style.display = "block";

    $("receptionPlaceholder").textContent = message;

    $("receptionPlayer").textContent = "PLAYER ---";

    $("receptionRemaining").textContent = "--:--";

    currentGeneration = null;

    qrExpireAt = 0;
}


function showQr(qr) {

    if (currentGeneration === qr.generation) {
        return;
    }

    if (typeof QRCode === "undefined") {

        clearQr(
            "QRコードライブラリの読み込みに失敗しました"
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

    const area = document.querySelector(
        ".reception-qr-area"
    );

    area.classList.remove("qr-change");

    void area.offsetWidth;

    area.classList.add("qr-change");
}


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

        if (!data.reception) {

            clearQr(
                "管理者が受付を開始するまでお待ちください"
            );

            return;
        }

        if (data.qr) {

            showQr(data.qr);

        } else {

            clearQr(
                "QRコードを準備しています..."
            );
        }

    } catch (error) {

        console.error(error);

        $("receptionStatus").textContent =
            "🔴 接続エラー";

        clearQr(
            "サーバーとの接続を確認しています"
        );

    } finally {

        polling = false;
    }
}


setInterval(updateTimer, 250);

setInterval(poll, 3000);

poll();
