"""Photo evidence policy. See docs/architecture/business-rules.md §9.

Photos live in the database (the free tiers have no object storage), so they are small by rule:
the client downscales to a ~1280px JPEG before upload, and the server enforces the limits below.
"""

MAX_PHOTO_BYTES = 600_000
MAX_PHOTOS_PER_ISSUE = 4

_SIGNATURES: tuple[tuple[bytes, int, str], ...] = (
    (b"\xff\xd8\xff", 0, "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", 0, "image/png"),
    (b"WEBP", 8, "image/webp"),
)


def sniff_image_type(data: bytes) -> str | None:
    """The real content type from the file's magic bytes — the declared type is not trusted."""
    for signature, offset, content_type in _SIGNATURES:
        if data[offset : offset + len(signature)] == signature:
            if content_type == "image/webp" and data[:4] != b"RIFF":
                continue
            return content_type
    return None
