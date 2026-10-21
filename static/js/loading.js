"use strict";

// ========================================
// 科学技術部 QRコード認証処理
// ========================================


// 認証キー取得
const keyMeta = document.querySelector(
    'meta[name="claim-key"]'
);

const playerMeta = document.querySelector(
    'meta[name="claim-player"]'
);


const claimKey = keyMeta
    ? keyMeta.getAttribute("content")
    : null;

const claimPlayer = playerMeta
    ? playerMeta.getAttribute("content")
    : null;


// DOM
const loadingSpinner = document.getElementById(
    "loadingSpinner"
);

const loadingTitle = document.getElementById(
    "loadingTitle"
);

const loadingMessage = document.getElementById(
    "loadingMessage"
);


// ========================================
// エラー表示
// ========================================

function showError(title, message) {

    if (loadingSpinner) {
        loadingSpinner.remove();
    }

    loadingTitle.textContent = title;

    loadingMessage.textContent = message;
}


// ========================================
// QRコード認証
// ========================================

async function authenticate() {

    // URLから認証キーを削除
    // 履歴・アドレスバーに残さない
    history.replaceState(
        null,
        "",
        "/play"
    );


    // 認証情報の確認
    if (!claimKey || !claimPlayer) {

        showError(
            "認証情報がありません",
            "受付PCに表示されているQRコードを読み込んでください。"
        );

        return;
    }


    try {

        const response = await fetch(
            "/api/player/claim",
            {

                method: "POST",

                credentials: "same-origin",

                cache: "no-store",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    key: claimKey,
                    player: claimPlayer
                })

            }
        );


        let data;

        try {

            data = await response.json();

        } catch (error) {

            showError(
                "サーバーエラー",
                "認証サーバーから正常な応答がありませんでした。"
            );

            return;
        }


        // 認証成功
        if (response.ok && data.ok) {

            location.replace(
                data.redirect || "/game"
            );

            return;
        }


        // 使用済みQRコード
        if (data.error === "used") {

            showError(
                "このQRコードは使用済みです。",
                "受付PCに表示されている\n" +
                "新しいQRコードを読み込んでください。"
            );

            return;
        }


        // 期限切れ
        if (data.error === "expired") {

            showError(
                "QRコードの有効期限が切れました。",
                "受付PCに表示されている新しいQRコードを読み込んでください。"
            );

            return;
        }


        // 受付停止
        if (data.error === "reception_closed") {

            showError(
                "現在、受付を停止しています。",
                "科学技術部の受付担当者に確認してください。"
            );

            return;
        }


        // レート制限
        if (data.error === "rate_limited") {

            showError(
                "アクセスが集中しています。",
                "少し時間をおいてから、新しいQRコードを読み込んでください。"
            );

            return;
        }


        // その他の認証エラー
        showError(
            "認証できませんでした。",
            "受付PCに表示されている新しいQRコードを読み込んでください。"
        );


    } catch (error) {

        console.error(
            "認証通信エラー:",
            error
        );


        showError(
            "通信エラー",
            "サーバーと通信できませんでした。\n" +
            "通信状況を確認してください。"
        );
    }
}


// ========================================
// 認証開始
// ========================================

authenticate();