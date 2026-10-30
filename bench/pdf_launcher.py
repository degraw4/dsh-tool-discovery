"""Keep the pinned PDF server cache lock reentrant. No protocol changes."""

import threading
import pdf_tools_mcp.server as server

server.cache_lock = threading.RLock()
if __name__ == "__main__":
    server.main()
