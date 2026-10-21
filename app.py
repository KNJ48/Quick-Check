import os
import time
import secrets
import threading
import hmac

from datetime import datetime
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
    make_response
)

from werkzeug.middleware.proxy_fix import ProxyFix


GAME_URL = (
    "https://ink3-1239.github.io/"
    "url-tool-39cf2075ec432800b501/"
    "a7f3c91e2b.html?v=memo7"
)

JST = ZoneInfo("Asia/Tokyo")

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")
RECEPTION_PASSWORD = os.environ.get("RECEPTION_PASSWORD")
SECRET_KEY = os.environ.get("SECRET_KEY")

if not ADMIN_PASSWORD:
    raise RuntimeError("ADMIN_PASSWORD が設定されていません")

if not RECEPTION_PASSWORD:
    raise RuntimeError("RECEPTION_PASSWORD が設定されていません")

if not SECRET_KEY or len(SECRET_KEY) < 32:
    raise RuntimeError("SECRET_KEY は32文字以上にしてください")

if hmac.compare_digest(
    ADMIN_PASSWORD.encode(),
    RECEPTION_PASSWORD.encode()
):
    raise RuntimeError(
        "管理者パスワードと受付パスワードは別にしてください"
    )


app = Flask(__name__)

app.config.update(
    SECRET_KEY=SECRET_KEY,
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    MAX_CONTENT_LENGTH=16384
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
    "reception_owner": None,
    "deadline": None,
    "next_player": 1,
    "current_qr": None,
    "qr_records": {},
    "players": {},
    "sessions": {},
    "staff_sessions": {},
    "generation": 0
}

rate_limits = defaultdict(deque)


def now():
    return time.time()


def jst_now():
    return datetime.now(JST)


def random_token():
    return secrets.token_urlsafe(32)


def secure_equal(a, b):
    return hmac.compare_digest(
        str(a).encode(),
        str(b).encode()
    )


def set_cookie(response, name, value, max_age=None):
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        httponly=True,
        secure=True,
        samesite="Lax",
        path="/"
    )


def clear_cookie(response, name):
    response.delete_cookie(
        name,
        secure=True,
        httponly=True,
        samesite="Lax",
        path="/"
    )


@app.after_request
def security_headers(response):

    response.headers["Cache-Control"] = (
        "no-store, no-cache, must-revalidate, private"
    )

    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"

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


def staff_session():

    token = request.cookies.get("staff_session")

    if not token:
        return None

    with lock:

        session = state["staff_sessions"].get(token)

        if not session:
            return None

        if session["expires"] <= now():
            state["staff_sessions"].pop(token, None)
            return None

        return session


def staff_token():
    return request.cookies.get("staff_session")


def require_role(*roles):

    def decorator(func):

        @wraps(func)
        def wrapper(*args, **kwargs):

            session = staff_session()

            if not session:
                return jsonify({
                    "error": "authentication_required"
                }), 401

            if session["role"] not in roles:
                return jsonify({
                    "error": "permission_denied"
                }), 403

            return func(*args, **kwargs)

        return wrapper

    return decorator


def csrf_valid():

    session = staff_session()

    if not session:
        return False

    supplied = request.headers.get(
        "X-CSRF-Token",
        ""
    )

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

    if not state["reception_owner"]:
        return False

    return (
        now() - state["reception_last_seen"]
    ) < 10


def reception_available():

    return (
        state["reception"]
        and reception_connected()
        and not deadline_passed()
    )


def invalidate_qr():

    qr = state["current_qr"]

    if qr:
        qr["invalidated"] = True

    state["current_qr"] = None


def expire_players():

    if not deadline_passed():
        return

    for player in state["players"].values():

        if player["status"] not in ("revoked", "expired"):

            player["status"] = "expired"
            player["revoked"] = True

    state["reception"] = False
    invalidate_qr()


def generate_qr():

    if not reception_available():
        return None

    invalidate_qr()

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
        "invalidated": False
    }

    state["current_qr"] = qr
    state["qr_records"][key] = qr
    state["generation"] += 1

    return qr


def ensure_qr():

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


def qr_public(qr):

    if not qr:
        return None

    return {
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


def player_from_cookie():

    token = request.cookies.get("play_session")

    if not token:
        return None

    session = state["sessions"].get(token)

    if not session:
        return None

    player = state["players"].get(
        session["player_id"]
    )

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

    elapsed = max(
        0,
        int(now() - player["last_seen"])
    )

    if player["status"] == "expired":
        status = "expired"

    elif player["revoked"]:
        status = "revoked"

    elif elapsed >= 15:
        status = "disconnected"

    else:
        status = "playing"

    return {
        "player_id": player["player_id"],
        "status": status,
        "last_seen_seconds": elapsed
    }


@app.route("/")
def index():
    return redirect(url_for("admin"))


# /admin は必ずログインフォーム
@app.route("/admin")
def admin():
    return render_template("admin_login.html")


@app.route("/admin/login", methods=["POST"])
def admin_login():

    if not rate_limit("staff_login", 10, 300):

        return render_template(
            "error.html",
            message="ログイン試行回数が多すぎます。"
        ), 429

    password = request.form.get("password", "")

    if secure_equal(password, ADMIN_PASSWORD):
        role = "admin"

    elif secure_equal(password, RECEPTION_PASSWORD):
        role = "reception"

    else:

        return render_template(
            "admin_login.html",
            error="パスワードが違います"
        ), 401

    token = random_token()
    csrf = random_token()

    with lock:

        state["staff_sessions"][token] = {
            "role": role,
            "csrf": csrf,
            "expires": now() + 12 * 3600
        }

    response = make_response(
        redirect(
            url_for("admin_dashboard")
            if role == "admin"
            else url_for("reception_page")
        )
    )

    set_cookie(
        response,
        "staff_session",
        token,
        12 * 3600
    )

    return response


@app.route("/admin/logout", methods=["POST"])
@require_role("admin", "reception")
@csrf_required
def admin_logout():

    token = staff_token()

    with lock:
        state["staff_sessions"].pop(token, None)

    response = jsonify({"ok": True})

    clear_cookie(
        response,
        "staff_session"
    )

    return response


@app.route("/admin/dashboard")
def admin_dashboard():

    session = staff_session()

    if not session:
        return redirect(url_for("admin"))

    if session["role"] != "admin":
        return redirect(url_for("reception_page"))

    return render_template(
        "admin.html",
        csrf=session["csrf"]
    )


@app.route("/QRcode")
def reception_page():

    session = staff_session()

    if not session:
        return redirect(url_for("admin"))

    if session["role"] != "reception":
        return redirect(url_for("admin_dashboard"))

    return render_template(
        "reception.html",
        csrf=session["csrf"]
    )


@app.route("/api/admin/start", methods=["POST"])
@require_role("admin")
@csrf_required
def start_reception():

    data = request.get_json(silent=True) or {}
    end_time = data.get("end_time", "")

    try:

        hour, minute = map(int, end_time.split(":"))

        if not (
            0 <= hour <= 23
            and 0 <= minute <= 59
        ):
            raise ValueError()

        current = jst_now()

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

        state["deadline"] = deadline.timestamp()
        state["reception"] = True
        state["reception_owner"] = None
        state["reception_last_seen"] = 0

        invalidate_qr()

    return jsonify({"ok": True})


@app.route("/api/admin/stop", methods=["POST"])
@require_role("admin")
@csrf_required
def stop_reception():

    with lock:

        state["reception"] = False

        invalidate_qr()

    return jsonify({"ok": True})


@app.route("/api/reception/heartbeat", methods=["POST"])
@require_role("reception")
@csrf_required
def reception_heartbeat():

    token = staff_token()

    with lock:

        expire_players()

        # 接続が切れている受付PCから所有権を引き継ぐ
        if (
            state["reception_owner"] is None
            or not reception_connected()
        ):

            state["reception_owner"] = token

        if not secure_equal(
            state["reception_owner"],
            token
        ):

            return jsonify({
                "error": "another_reception_active"
            }), 409

        state["reception_last_seen"] = now()

        qr = ensure_qr()

        return jsonify({
            "ok": True,
            "reception": state["reception"],
            "qr": qr_public(qr),
            "deadline": state["deadline"],
            "server_time": now()
        })


@app.route("/api/admin/heartbeat", methods=["POST"])
@require_role("admin")
@csrf_required
def admin_heartbeat():

    with lock:

        expire_players()

        players = [
            public_player(player)
            for player in state["players"].values()
        ]

        playing_count = sum(
            1
            for player in players
            if player["status"] == "playing"
        )

        return jsonify({
            "connected": True,
            "reception": state["reception"],
            "reception_connected": reception_connected(),
            "deadline": state["deadline"],
            "server_time": now(),
            "playing_count": playing_count,
            "players": players,
            "qr": qr_public(state["current_qr"])
        })


@app.route("/api/admin/revoke/<player_id>", methods=["POST"])
@require_role("admin")
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
@require_role("admin")
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
            return jsonify({"error": "invalid"}), 403

        if qr["used"]:
            return jsonify({"error": "used"}), 403

        if qr["invalidated"]:
            return jsonify({"error": "expired"}), 403

        if now() >= qr["expires"]:

            qr["invalidated"] = True

            return jsonify({"error": "expired"}), 403

        if not reception_available():
            return jsonify({
                "error": "reception_closed"
            }), 403

        if qr["player_id"] != player_id:
            return jsonify({"error": "invalid"}), 403

        if state["current_qr"] is not qr:
            return jsonify({"error": "expired"}), 403

        qr["used"] = True

        session_id = random_token()

        player = {
            "player_id": player_id,
            "session_id": session_id,
            "status": "playing",
            "last_seen": now(),
            "expires_at": state["deadline"],
            "revoked": False
        }

        state["players"][player_id] = player

        state["sessions"][session_id] = {
            "player_id": player_id
        }

        generate_qr()

    response = jsonify({
        "ok": True,
        "redirect": url_for("game")
    })

    set_cookie(
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

    session = staff_session()

    if not session:
        return redirect(url_for("admin"))

    if session["role"] != "admin":
        return redirect(url_for("reception_page"))

    return render_template(
        "game.html",
        game_url=GAME_URL,
        player_id="ADMIN",
        admin_mode=True
    )


@app.route("/api/admin/game-check", methods=["POST"])
@require_role("admin")
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
