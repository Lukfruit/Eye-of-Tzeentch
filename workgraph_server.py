#!/usr/bin/env python3
"""Launch Cyber Soul with project work-graph persistence on disk."""

from __future__ import annotations

import json
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from cyber_soul_gui import SoulHandler, ThreadingHTTPServer


WORKGRAPH_FILENAME = "workgraph.json"


def project_path(raw_path: str) -> Path:
    path = Path(raw_path).expanduser().resolve()
    if not path.is_dir():
        raise ValueError(f"Folder does not exist: {path}")
    return path


class WorkGraphHandler(SoulHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/workgraph":
            query = parse_qs(parsed.query)
            raw_path = query.get("path", [""])[0]
            try:
                project = project_path(raw_path)
                target = project / WORKGRAPH_FILENAME
                if not target.is_file():
                    self.send_json({"project": str(project), "nodes": []})
                else:
                    payload = json.loads(target.read_text(encoding="utf-8"))
                    if not isinstance(payload, dict) or not isinstance(payload.get("nodes", []), list):
                        raise ValueError("Invalid work graph file")
                    self.send_json(payload)
            except (OSError, TypeError, ValueError, json.JSONDecodeError) as error:
                self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return
        super().do_GET()

    def do_POST(self) -> None:
        if urlparse(self.path).path == "/api/workgraph":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length))
                raw_path = str(payload["path"])
                graph = payload["graph"]
                if not isinstance(graph, dict) or not isinstance(graph.get("nodes", []), list):
                    raise ValueError("Invalid work graph")
                project = project_path(raw_path)
                target = project / WORKGRAPH_FILENAME
                target.write_text(
                    json.dumps(graph, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8",
                )
                self.send_json({"ok": True, "path": str(target)})
            except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
                self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return
        super().do_POST()


def main() -> None:
    import argparse
    import threading
    import webbrowser

    parser = argparse.ArgumentParser(description="Launch the Cyber Soul explorer with disk-backed work graphs")
    parser.add_argument("path", nargs="?", default=str(Path(__file__).resolve().parent), help="codebase to scan on launch")
    parser.add_argument("--port", type=int, default=8877)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), WorkGraphHandler)
    url = f"http://127.0.0.1:{args.port}/?path={Path(args.path).expanduser().resolve()}"
    print(f"Cyber Soul is listening at {url}")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nCyber Soul stopped.")


if __name__ == "__main__":
    main()
