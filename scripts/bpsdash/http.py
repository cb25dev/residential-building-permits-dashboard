"""HTTP access to Census servers: retrying downloads and Apache directory listings."""
from __future__ import annotations

import re
import time
from dataclasses import dataclass

import certifi
import requests

from . import config


class SourceError(RuntimeError):
    """A source could not be reached or returned something unusable."""


_session: requests.Session | None = None


def session() -> requests.Session:
    global _session
    if _session is None:
        s = requests.Session()
        s.verify = certifi.where()
        s.headers["User-Agent"] = config.HTTP_USER_AGENT
        _session = s
    return _session


@dataclass(frozen=True)
class Download:
    url: str
    content: bytes
    http_last_modified: str | None
    etag: str | None


class RejectedResponse(SourceError):
    """The server answered 200 but with an error/firewall page instead of the file."""


def _check_body(url: str, body: bytes, expect: str) -> None:
    head = body[:512].lstrip().lower()
    if expect == "zip":
        if not body.startswith(b"PK"):
            raise RejectedResponse(f"Expected a zip archive, got something else: {url}")
    elif expect == "listing":
        if b"index of" not in body[:4096].lower():
            raise RejectedResponse(f"Expected a directory index page: {url}")
    elif head.startswith((b"<html", b"<!doctype")) or b"request rejected" in head:
        # Census's web firewall returns HTTP 200 with an HTML "Request Rejected" page.
        raise RejectedResponse(f"Got an HTML page instead of a data file: {url}")


def get(url: str, attempts: int = 5, expect: str = "data") -> Download:
    """GET with retries. ``expect`` is 'data' (text file), 'zip', or 'listing'."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            r = session().get(url, timeout=config.HTTP_TIMEOUT)
            if r.status_code == 404:
                raise SourceError(f"404 Not Found: {url}")
            r.raise_for_status()
            if not r.content:
                raise RejectedResponse(f"Empty response body: {url}")
            _check_body(url, r.content, expect)
            return Download(url, r.content, r.headers.get("Last-Modified"), r.headers.get("ETag"))
        except RejectedResponse as e:
            last = e
            time.sleep(5 * (i + 1))
        except SourceError:
            raise
        except requests.RequestException as e:
            last = e
            time.sleep(2 ** i)
    raise SourceError(f"Download failed after {attempts} attempts: {url}: {last}")


@dataclass(frozen=True)
class ListingEntry:
    name: str
    last_modified: str  # "YYYY-MM-DD HH:MM" as printed by the server (US Eastern)
    size: str


# Apache autoindex row: <a href="name">name</a></td><td align="right">2026-09-24 07:46  </td><td align="right">445K</td>
_ROW = re.compile(
    r'<a href="(?P<href>[^"?/][^"]*)">[^<]*</a></td><td align="right">(?P<lm>\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*</td>'
    r'<td align="right">\s*(?P<size>[^<]*?)\s*</td>'
)


def listing(url: str) -> list[ListingEntry]:
    html = get(url, expect="listing").content.decode("utf-8", errors="replace")
    entries = [ListingEntry(m["href"], m["lm"], m["size"]) for m in _ROW.finditer(html)]
    if not entries:
        raise SourceError(f"Directory listing format not recognized (no entries parsed): {url}")
    return entries


def subdirectories(url: str) -> list[str]:
    html = get(url, expect="listing").content.decode("utf-8", errors="replace")
    return sorted(set(re.findall(r'href="([^"?/][^"]*)/"', html)))
