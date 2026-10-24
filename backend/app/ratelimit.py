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

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


login_limiter = RateLimiter(attempts=10, window_seconds=60)
