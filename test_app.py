import os
import unittest
import threading
import time

os.environ.setdefault(
    "ADMIN_PASSWORD",
    "test-admin-password"
)

os.environ.setdefault(
    "SECRET_KEY",
    "test-secret-key-with-more-than-32-characters"
)

import app as server


class GameAuthTest(unittest.TestCase):

    def setUp(self):

        self.client = server.app.test_client()

        with server.lock:

            server.state["reception"] = False
            server.state["reception_last_seen"] = 0
            server.state["deadline"] = None
            server.state["next_player"] = 1
            server.state["current_qr"] = None
            server.state["qr_records"].clear()
            server.state["players"].clear()
            server.state["sessions"].clear()
            server.state["admin_sessions"].clear()
            server.state["generation"] = 0

            server.rate_limits.clear()

    def login(self):

        response = self.client.post(
            "/admin/login",
            data={
                "password": "test-admin-password"
            }
        )

        self.assertEqual(response.status_code, 302)

        token = self.client.get_cookie(
            "admin_session"
        ).value

        return server.state[
            "admin_sessions"
        ][token]["csrf"]

    def start(self):

        csrf = self.login()

        current = server.timestamp_jst()

        end = current + server.timedelta(minutes=30)

        response = self.client.post(
            "/api/admin/start",
            json={
                "end_time": end.strftime("%H:%M")
            },
            headers={
                "X-CSRF-Token": csrf
            }
        )

        self.assertEqual(response.status_code, 200)

        return csrf

    def claim_current(self):

        qr = server.state["current_qr"]

        return self.client.post(
            "/api/player/claim",
            json={
                "key": qr["key"],
                "player": qr["player_id"]
            }
        )

    def test_admin_login(self):

        csrf = self.login()

        self.assertTrue(csrf)

    def test_admin_api_requires_login(self):

        response = self.client.post(
            "/api/admin/revoke-all"
        )

        self.assertEqual(response.status_code, 401)

    def test_qr_generation(self):

        self.start()

        qr = server.state["current_qr"]

        self.assertIsNotNone(qr)

        self.assertEqual(
            qr["player_id"],
            "001"
        )

    def test_claim_success(self):

        self.start()

        response = self.claim_current()

        self.assertEqual(response.status_code, 200)

        self.assertTrue(response.json["ok"])

        self.assertIn(
            "001",
            server.state["players"]
        )

    def test_used_qr_rejected(self):

        self.start()

        qr = server.state["current_qr"].copy()

        first = self.client.post(
            "/api/player/claim",
            json={
                "key": qr["key"],
                "player": qr["player_id"]
            }
        )

        second = self.client.post(
            "/api/player/claim",
            json={
                "key": qr["key"],
                "player": qr["player_id"]
            }
        )

        self.assertEqual(first.status_code, 200)

        self.assertEqual(second.status_code, 403)

        self.assertEqual(
            second.json["error"],
            "used"
        )

    def test_player_id_tampering(self):

        self.start()

        qr = server.state["current_qr"]

        response = self.client.post(
            "/api/player/claim",
            json={
                "key": qr["key"],
                "player": "999"
            }
        )

        self.assertEqual(response.status_code, 403)

    def test_expired_key(self):

        self.start()

        qr = server.state["current_qr"]

        qr["expires"] = time.time() - 1

        response = self.client.post(
            "/api/player/claim",
            json={
                "key": qr["key"],
                "player": qr["player_id"]
            }
        )

        self.assertEqual(response.status_code, 403)

    def test_heartbeat(self):

        self.start()

        self.claim_current()

        response = self.client.post(
            "/api/player/heartbeat"
        )

        self.assertTrue(
            response.json["allowed"]
        )

    def test_revoke(self):

        csrf = self.start()

        self.claim_current()

        response = self.client.post(
            "/api/admin/revoke/001",
            headers={
                "X-CSRF-Token": csrf
            }
        )

        self.assertEqual(response.status_code, 200)

        heartbeat = self.client.post(
            "/api/player/heartbeat"
        )

        self.assertFalse(
            heartbeat.json["allowed"]
        )

        self.assertEqual(
            heartbeat.json["reason"],
            "revoked"
        )

    def test_reception_stop(self):

        csrf = self.start()

        qr = server.state["current_qr"].copy()

        self.client.post(
            "/api/admin/stop",
            headers={
                "X-CSRF-Token": csrf
            }
        )

        response = self.client.post(
            "/api/player/claim",
            json={
                "key": qr["key"],
                "player": qr["player_id"]
            }
        )

        self.assertEqual(response.status_code, 403)

    def test_deadline(self):

        self.start()

        self.claim_current()

        with server.lock:
            server.state["deadline"] = time.time() - 1

        response = self.client.post(
            "/api/player/heartbeat"
        )

        self.assertFalse(
            response.json["allowed"]
        )

        self.assertEqual(
            response.json["reason"],
            "time_expired"
        )

    def test_concurrent_claim(self):

        self.start()

        qr = server.state["current_qr"].copy()

        results = []

        results_lock = threading.Lock()

        barrier = threading.Barrier(5)

        def worker():

            client = server.app.test_client()

            barrier.wait()

            response = client.post(
                "/api/player/claim",
                json={
                    "key": qr["key"],
                    "player": qr["player_id"]
                }
            )

            with results_lock:
                results.append(response.status_code)

        threads = [
            threading.Thread(target=worker)
            for _ in range(5)
        ]

        for thread in threads:
            thread.start()

        for thread in threads:
            thread.join()

        self.assertEqual(
            results.count(200),
            1
        )

    def test_game_requires_session(self):

        response = self.client.get("/game")

        self.assertEqual(response.status_code, 403)

        self.assertNotIn(
            b"<iframe",
            response.data
        )


if __name__ == "__main__":
    unittest.main()