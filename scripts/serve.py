#!/usr/bin/env python3
"""Serve the game's public/ directory (static files only, no directory listings)."""
import argparse
import functools
import http.server
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"

SECURITY_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; connect-src 'self'; manifest-src 'self'; "
        "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    ),
}


class StaticHandler(http.server.SimpleHTTPRequestHandler):
    server_version = "KillerKoalas"
    sys_version = ""
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".webp": "image/webp",
        ".js": "text/javascript",
    }

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)
        super().end_headers()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8791)
    args = parser.parse_args()
    handler = functools.partial(StaticHandler, directory=str(PUBLIC))
    with http.server.ThreadingHTTPServer((args.host, args.port), handler) as httpd:
        print(f"Serving {PUBLIC} on http://{args.host}:{args.port}/", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
