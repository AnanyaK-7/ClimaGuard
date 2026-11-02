import os
import sys
import socket

# Ensure UTF-8 output on Windows consoles to prevent cp1252 charmap errors
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import uvicorn

def find_available_port(start_port: int = 8000) -> int:
    port = start_port
    while port < start_port + 20:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
        port += 1
    return start_port

if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.abspath(__file__))
    if base_dir not in sys.path:
        sys.path.insert(0, base_dir)

    requested_port = int(os.environ.get("PORT", 8000))
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        requested_port = int(sys.argv[1])

    port = find_available_port(requested_port)
    if port != requested_port:
        print(f"Notice: Port {requested_port} was already busy. Automatically using port {port}.")

    print("-" * 60)
    print("ClimaCheck - Garnier ClimaGuard")
    print("L'Oreal Sustainability Challenge 2026")
    print("FastAPI Backend & Interactive Derm-Tech Dashboard")
    print("-" * 60)
    print("Server running at:")
    print(f">> http://localhost:{port}")
    print(f">> http://127.0.0.1:{port}")
    print("-" * 60)

    uvicorn.run("api.index:app", host="0.0.0.0", port=port, reload=False, app_dir=base_dir)
