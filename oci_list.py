"""Paginated OCI Object Storage listing.

`list_objects` returns one page. With a delimiter, OCI fills the page by
scanning objects, so one page of `limit=1000` held only the first ~102 run
folders (~10 files each); later runs were silently missing (2026-11-06: the
11-05 paper run was in the bucket but not on the dashboard). Every listing
must follow `next_start_with` to the end.
"""
from __future__ import annotations

from typing import List, Tuple

_PAGE_LIMIT = 1000


def list_all(os_client, namespace: str, bucket: str, prefix: str = "",
             delimiter: str | None = None) -> Tuple[List[str], list]:
    """All (prefixes, objects) under `prefix`, every page, prefixes de-duplicated in order."""
    kwargs = dict(namespace_name=namespace, bucket_name=bucket, prefix=prefix, limit=_PAGE_LIMIT)
    if delimiter is not None:
        kwargs["delimiter"] = delimiter
    prefixes: dict = {}
    objects: list = []
    start = None
    while True:
        if start is not None:
            kwargs["start"] = start
        data = os_client.list_objects(**kwargs).data
        for p in data.prefixes or []:
            prefixes[p] = None
        objects.extend(data.objects or [])
        start = data.next_start_with
        if not start:
            return list(prefixes), objects
