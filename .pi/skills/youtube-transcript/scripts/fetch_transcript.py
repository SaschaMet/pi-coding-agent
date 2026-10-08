#!/usr/bin/env python3
"""Print a YouTube video's title and transcript to stdout.

Usage:
    fetch_transcript.py '<URL or 11-char video ID>' [--timestamps] [--languages en,de]

Exit codes:
    0  success
    1  bad URL, no transcript available, or empty transcript
"""

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request

DEFAULT_LANGUAGES = ["en", "de"]


def parse_video_id(url: str) -> str:
    """Extract the 11-char video ID from common YouTube URL shapes."""
    url = url.strip()
    patterns = [
        r"[?&]v=([0-9A-Za-z_-]{11})",
        r"youtu\.be/([0-9A-Za-z_-]{11})",
        r"/shorts/([0-9A-Za-z_-]{11})",
        r"/live/([0-9A-Za-z_-]{11})",
        r"/embed/([0-9A-Za-z_-]{11})",
    ]
    for pat in patterns:
        m = re.search(pat, url)
        if m:
            return m.group(1)
    if re.fullmatch(r"[0-9A-Za-z_-]{11}", url):
        return url
    raise ValueError(f"Could not extract a video ID from: {url!r}")


def fetch_title(video_id: str) -> str | None:
    """Return the title via the keyless oembed endpoint, or None on any failure."""
    watch = f"https://www.youtube.com/watch?v={video_id}"
    url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(watch, safe="")
    try:
        with urllib.request.urlopen(url, timeout=10) as res:
            title = json.load(res).get("title")
    except (OSError, ValueError, AttributeError):
        return None
    return title if isinstance(title, str) else None


def fetch_transcript(video_id: str, languages: list[str]):
    """Fetch transcript snippets (objects with .text and .start)."""
    # Lazy: offline tests run on a python3 without these packages.
    import requests
    from youtube_transcript_api import (
        CouldNotRetrieveTranscript,
        IpBlocked,
        NoTranscriptFound,
        RequestBlocked,
        TranscriptsDisabled,
        VideoUnavailable,
        YouTubeTranscriptApi,
    )

    try:
        return YouTubeTranscriptApi().fetch(video_id, languages=languages).snippets
    except (TranscriptsDisabled, NoTranscriptFound):
        raise RuntimeError(
            f"No transcript available for {video_id} in {languages}. "
            "The video may have captions disabled or only in other languages."
        )
    except VideoUnavailable:
        raise RuntimeError(f"Video {video_id} is unavailable.")
    except (IpBlocked, RequestBlocked):
        raise RuntimeError(
            f"YouTube is blocking requests from this IP (video {video_id}). "
            "This is usually a temporary rate limit. Wait a few minutes and retry."
        )
    except requests.RequestException as err:
        raise RuntimeError(
            f"Network error while fetching the transcript for {video_id}: {err}. "
            "Check the connection and retry."
        )
    except CouldNotRetrieveTranscript as err:
        raise RuntimeError(f"Could not fetch the transcript for {video_id}: {type(err).__name__}.")


def format_timestamp(seconds: float) -> str:
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def render(snippets, timestamps: bool) -> str:
    lines = []
    for s in snippets:
        text = (s.text or "").strip()
        if not text:
            continue
        if timestamps:
            lines.append(f"[{format_timestamp(float(s.start))}] {text}")
        else:
            lines.append(text)
    return "\n".join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Print a YouTube video transcript.")
    parser.add_argument("url", help="YouTube video URL or bare 11-char video ID")
    parser.add_argument(
        "--languages",
        default=",".join(DEFAULT_LANGUAGES),
        help="Comma-separated preferred languages; first available wins (default: %(default)s)",
    )
    parser.add_argument("--timestamps", action="store_true", help="Prefix each line with [HH:MM:SS]")
    args = parser.parse_args(argv)

    try:
        video_id = parse_video_id(args.url)
    except ValueError as err:
        print(f"Error: {err}", file=sys.stderr)
        return 1

    languages = [lang.strip() for lang in args.languages.split(",") if lang.strip()]

    try:
        snippets = fetch_transcript(video_id, languages)
    except RuntimeError as err:
        print(f"Error: {err}", file=sys.stderr)
        return 1

    text = render(snippets, args.timestamps)
    if not text:
        print(f"Error: transcript for {video_id} is empty.", file=sys.stderr)
        return 1

    title = fetch_title(video_id)
    if title:
        print(f"Title: {title}")
    print(f"URL: https://www.youtube.com/watch?v={video_id}\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
