import os
import time
import secrets
import threading
import hmac

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from functools import wraps
from collections import defaultdict, deque

from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    redirect,
    url_for,
    make_response,
    abort
)

from werkzeug.middleware.proxy_fix import ProxyFix


GAME_URL = (
    "https://ink3-1239.github.io/"
    "url-tool-39cf2075ec432800b501/"
    "a7f3c91e2b.html?v=memo7"
)

JST = ZoneInfo("Asia/Tokyo")

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")
SECRET_KEY = os.environ.get("SECRET_KEY")

if not ADMIN_PASSWORD or not SECRET_KEY:
    raise RuntimeError(
        "ADMIN_PASSWORD と SECRET_KEY を設定してください"
    )

if len(SECRET_KEY) < 32:
    raise RuntimeError(
        "SECRET_KEY は32文字以上にしてください"
    )

app = Flask(__name__)

app.config.update(
    SECRET_KEY=SECRET_KEY,
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    MAX_CONTENT_LENGTH=16384,
)

app.wsgi_app = ProxyFix(
    app.wsgi_app,
    x_for=1,
    x_proto=1,
    x_host=1
)

lock = threading.RLock()

state = {
    "reception": False,
    "reception_last_seen": 0,
    "deadline": None,
    "next_player": 1,
    "current_qr": None,
    "qr_records": {},
    "players": {},
    "sessions": {},
    "admin_sessions": {},
    "generation": 0,
}

rate_limits = defaultdict(deque)


def now():
    return time.time()


def timestamp_jst():
    return datetime.now(JST)


def random_token():
    return secrets.token_urlsafe(32)


def secure_equal(a, b):
    return hmac.compare_digest(
        str(a).encode(),
        str(b).encode()
    )


def get_cookie(name):
    return request.cookies.get(name)


def set_secure_cookie(response, name, value, max_age=None):
    response.set_cookie(
        name,
        value,
        httponly=True,
        secure=True,
        samesite="Lax",
        max_age=max_age,
        path="/"
    )


def clear_cookie(response, name):
    response.delete_cookie(
        name,
        path="/",
        secure=True,
        httponly=True,
        samesite="Lax"
    )


def no_cache(response):
    response.headers["Cache-Control"] = (
        "no-store, no-cache, must-revalidate, private"
    )
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.after_request
def security_headers(response):
    no_cache(response)

    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"

    response.headers["Permissions-Policy"] = (
        "camera=(), microphone=(), geolocation=()"
    )

    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' https://cdnjs.cloudflare.com; "
        "style-src 'self'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-src https://ink3-1239.github.io; "
        "object-src 'none'; "
        "base-uri 'none'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    )

    if request.is_secure:
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000"
        )

    return response


def rate_limit(name, limit, window):
    ip = request.remote_addr or "unknown"

    key = (name, ip)

    current = now()

    with lock:
        q = rate_limits[key]

        while q and current - q[0] > window:
            q.popleft()

        if len(q) >= limit:
            return False

        q.append(current)

    return True


def admin_session():
    token = get_cookie("admin_session")

    if not token:
        return None

    with lock:
        session = state["admin_sessions"].get(token)

        if not session:
            return None

        if session["expires"] <= now():
            state["admin_sessions"].pop(token, None)
            return None

        return session


def admin_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not admin_session():
            return jsonify({
                "error": "admin_required"
            }), 401

        return func(*args, **kwargs)

    return wrapper


def csrf_valid():
    session = admin_session()

    if not session:
        return False

    supplied = request.headers.get("X-CSRF-Token", "")

    return secure_equal(
        supplied,
        session["csrf"]
    )


def csrf_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not csrf_valid():
            return jsonify({
                "error": "csrf_failed"
            }), 403

        return func(*args, **kwargs)

    return wrapper


def deadline_passed():
    deadline = state["deadline"]

    if deadline is None:
        return True

    return now() >= deadline


def reception_connected():
    return (
        now() - state["reception_last_seen"]
    ) < 10


def reception_available():
    return (
        state["reception"]
        and reception_connected()
        and not deadline_passed()
    )


def expire_players():
    if not deadline_passed():
        return

    for player in state["players"].values():
        if player["status"] not in ("revoked", "expired"):
            player["status"] = "expired"
            player["revoked"] = True

    state["reception"] = False
    state["current_qr"] = None


def invalidate_current_qr():
    qr = state["current_qr"]

    if qr:
        qr["invalidated"] = True

    state["current_qr"] = None


def generate_qr():
    if not reception_available():
        return None

    invalidate_current_qr()

    player_number = state["next_player"]

    state["next_player"] += 1

    player_id = f"{player_number:03d}"

    key = random_token()

    issued = now()

    expires = min(
        issued + 900,
        state["deadline"]
    )

    qr = {
        "key": key,
        "player_id": player_id,
        "issued": issued,
        "expires": expires,
        "used": False,
        "invalidated": False,
    }

    state["current_qr"] = qr

    state["qr_records"][key] = qr

    state["generation"] += 1

    return qr


def ensure_current_qr():
    if not reception_available():
        return None

    qr = state["current_qr"]

    if qr:
        if (
            qr["used"]
            or qr["invalidated"]
            or now() >= qr["expires"]
        ):
            qr = None

    if qr is None:
        qr = generate_qr()

    return qr


def player_from_cookie():
    token = get_cookie("play_session")

    if not token:
        return None

    session = state["sessions"].get(token)

    if not session:
        return None

    player_id = session["player_id"]

    player = state["players"].get(player_id)

    if not player:
        return None

    if not secure_equal(
        player["session_id"],
        token
    ):
        return None

    return player


def player_allowed(player):
    if not player:
        return False, "invalid_session"

    if deadline_passed():
        player["status"] = "expired"
        player["revoked"] = True
        return False, "time_expired"

    if player["revoked"]:
        return False, "revoked"

    return True, None


def public_player(player):
    current = now()

    if player["status"] == "expired":
        status = "expired"

    elif player["revoked"]:
        status = "revoked"

    elif current - player["last_seen"] >= 15:
        status = "disconnected"

    else:
        status = "playing"

    return {
        "player_id": player["player_id"],
        "status": status,
        "last_seen_seconds": int(
            current - player["last_seen"]
        ),
    }


@app.route("/")
def index():
    return redirect(url_for("admin"))


@app.route("/admin", methods=["GET"])
def admin():
    session = admin_session()

    if not session:
        return render_template("admin_login.html")

    return render_template(
        "admin.html",
        csrf=session["csrf"]
    )


@app.route("/admin/login", methods=["POST"])
def admin_login():
    if not rate_limit("admin_login", 10, 300):
        return render_template(
            "error.html",
            message="ログイン試行回数が多すぎます。"
        ), 429

    password = request.form.get("password", "")

    if not secure_equal(password, ADMIN_PASSWORD):
        return render_template(
            "admin_login.html",
            error="パスワードが違います"
        ), 401

    token = random_token()

    csrf = random_token()

    with lock:
        state["admin_sessions"][token] = {
            "csrf": csrf,
            "expires": now() + 12 * 3600,
        }

    response = make_response(
        redirect(url_for("admin"))
    )

    set_secure_cookie(
        response,
        "admin_session",
        token,
        max_age=12 * 3600
    )

    return response


@app.route("/admin/logout", methods=["POST"])
@admin_required
@csrf_required
def admin_logout():
    token = get_cookie("admin_session")

    with lock:
        state["admin_sessions"].pop(token, None)

    response = jsonify({"ok": True})

    clear_cookie(response, "admin_session")

    return response


@app.route("/api/admin/start", methods=["POST"])
@admin_required
@csrf_required
def start_reception():
    data = request.get_json(silent=True) or {}

    end_time = data.get("end_time", "")

    try:
        hour, minute = map(int, end_time.split(":"))

        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError()

        current = timestamp_jst()

        deadline = current.replace(
            hour=hour,
            minute=minute,
            second=0,
            microsecond=0
        )

        if deadline <= current:
            return jsonify({
                "error": "終了時刻は現在より後にしてください"
            }), 400

    except (ValueError, TypeError):
        return jsonify({
            "error": "時刻の形式が正しくありません"
        }), 400

    with lock:
        expire_players()

        state["deadline"] = deadline.timestamp()
        state["reception"] = True
        state["reception_last_seen"] = now()

        invalidate_current_qr()

        qr = generate_qr()

    return jsonify({
        "ok": True,
        "player_id": qr["player_id"]
    })


@app.route("/api/admin/stop", methods=["POST"])
@admin_required
@csrf_required
def stop_reception():
    with lock:
        state["reception"] = False

        invalidate_current_qr()

    return jsonify({"ok": True})


@app.route("/api/admin/heartbeat", methods=["POST"])
@admin_required
@csrf_required
def admin_heartbeat():
    with lock:
        expire_players()

        state["reception_last_seen"] = now()

        qr = ensure_current_qr()

        players = [
            public_player(player)
            for player in state["players"].values()
        ]

        playing_count = sum(
            1
            for p in players
            if p["status"] == "playing"
        )

        qr_data = None

        if qr:
            qr_data = {
                "player_id": qr["player_id"],
                "url": url_for(
                    "play",
                    key=qr["key"],
                    player=qr["player_id"],
                    _external=True,
                    _scheme="https"
                ),
                "remaining_seconds": max(
                    0,
                    int(qr["expires"] - now())
                ),
                "generation": state["generation"]
            }

        return jsonify({
            "connected": True,
            "reception": state["reception"],
            "deadline": state["deadline"],
            "server_time": now(),
            "playing_count": playing_count,
            "players": players,
            "qr": qr_data,
        })


@app.route("/api/admin/revoke/<player_id>", methods=["POST"])
@admin_required
@csrf_required
def revoke_player(player_id):
    with lock:
        player = state["players"].get(player_id)

        if not player:
            return jsonify({
                "error": "player_not_found"
            }), 404

        player["revoked"] = True
        player["status"] = "revoked"

    return jsonify({"ok": True})


@app.route("/api/admin/revoke-all", methods=["POST"])
@admin_required
@csrf_required
def revoke_all():
    with lock:
        for player in state["players"].values():
            player["revoked"] = True
            player["status"] = "revoked"

    return jsonify({"ok": True})


@app.route("/play")
def play():
    key = request.args.get("key", "")
    player_id = request.args.get("player", "")

    if not key or not player_id:
        return redirect(url_for("game"))

    # keyを含むURLで認証結果のHTMLを直接返さない。
    # 最初にローディング画面を返し、POSTで消費する。
    return render_template(
        "loading.html",
        key=key,
        player_id=player_id
    )


@app.route("/api/player/claim", methods=["POST"])
def claim():
    if not rate_limit("claim", 60, 60):
        return jsonify({
            "error": "rate_limited"
        }), 429

    data = request.get_json(silent=True) or {}

    key = data.get("key", "")
    player_id = data.get("player", "")

    with lock:
        expire_players()

        qr = state["qr_records"].get(key)

        if not qr:
            return jsonify({
                "error": "invalid"
            }), 403

        if qr["used"]:
            return jsonify({
                "error": "used"
            }), 403

        if qr["invalidated"]:
            return jsonify({
                "error": "expired"
            }), 403

        if now() >= qr["expires"]:
            qr["invalidated"] = True

            return jsonify({
                "error": "expired"
            }), 403

        if not reception_available():
            return jsonify({
                "error": "reception_closed"
            }), 403

        if qr["player_id"] != player_id:
            return jsonify({
                "error": "invalid"
            }), 403

        if state["current_qr"] is not qr:
            return jsonify({
                "error": "expired"
            }), 403

        # このロック内で認証・使用済み化・セッション発行を完了する。
        qr["used"] = True

        session_id = random_token()

        player = {
            "player_id": player_id,
            "session_id": session_id,
            "status": "playing",
            "last_seen": now(),
            "expires_at": state["deadline"],
            "revoked": False,
        }

        state["players"][player_id] = player

        state["sessions"][session_id] = {
            "player_id": player_id
        }

        # 次のQRを即座に発行する。
        generate_qr()

    response = jsonify({
        "ok": True,
        "redirect": url_for("game")
    })

    set_secure_cookie(
        response,
        "play_session",
        session_id
    )

    return response


@app.route("/game")
def game():
    with lock:
        expire_players()

        player = player_from_cookie()

        allowed, reason = player_allowed(player)

        if not allowed:
            return render_template(
                "expired.html",
                reason=reason
            ), 403

        return render_template(
            "game.html",
            game_url=GAME_URL,
            player_id=player["player_id"],
            admin_mode=False
        )


@app.route("/api/player/heartbeat", methods=["POST"])
def player_heartbeat():
    with lock:
        expire_players()

        player = player_from_cookie()

        allowed, reason = player_allowed(player)

        if not allowed:
            return jsonify({
                "allowed": False,
                "reason": reason
            })

        player["last_seen"] = now()

        player["status"] = "playing"

        remaining = max(
            0,
            int(state["deadline"] - now())
        )

        return jsonify({
            "allowed": True,
            "player_id": player["player_id"],
            "remaining_seconds": remaining
        })


@app.route("/admin/game")
def admin_game():
    if not admin_session():
        return redirect(url_for("admin"))

    return render_template(
        "game.html",
        game_url=GAME_URL,
        player_id="ADMIN",
        admin_mode=True
    )


@app.route("/api/admin/game-check", methods=["POST"])
@admin_required
def admin_game_check():
    return jsonify({
        "allowed": True,
        "admin": True
    })


@app.errorhandler(404)
def not_found(error):
    return render_template(
        "error.html",
        message="ページが見つかりません"
    ), 404


@app.errorhandler(500)
def server_error(error):
    return render_template(
        "error.html",
        message="サーバーエラーが発生しました"
    ), 500


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000))
    )