import time
from collections import defaultdict, deque
from threading import Lock


class RateLimiter:
    """In memory sliding window limiter. Enough for a single process demo."""

    def __init__(self, attempts: int, window_seconds: int):
        self.attempts = attempts
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.attempts:
                return False
            hits.append(now)
            return True

    def blocked(self, key: str) -> bool:
        """True when `key` already has the maximum number of recorded hits in the window."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            return len(hits) >= self.attempts

    def hit(self, key: str) -> None:
        with self._lock:
            self._hits[key].append(time.monotonic())

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


# Only failed sign ins count, so a whole class signing in from one address is never locked out.
login_limiter = RateLimiter(attempts=10, window_seconds=60)

# AI calls cost money and time, so each signed in user gets a modest allowance.
ai_limiter = RateLimiter(attempts=30, window_seconds=60)
