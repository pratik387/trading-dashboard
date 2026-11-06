"""list_all must follow next_start_with: one page hid the 11-05 paper run (2026-11-06)."""
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oci_list import list_all


class _Client:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    def list_objects(self, **kw):
        self.calls.append(kw)
        return SimpleNamespace(data=self.pages[len(self.calls) - 1])


def _page(prefixes=(), objects=(), nxt=None):
    return SimpleNamespace(prefixes=list(prefixes), objects=[SimpleNamespace(name=n) for n in objects],
                           next_start_with=nxt)


def test_follows_pages_and_dedupes_prefixes():
    c = _Client([_page(["fixed/paper_1/", "fixed/paper_2/"], nxt="fixed/paper_2/x.json"),
                 _page(["fixed/paper_2/", "fixed/paper_3/"])])
    prefixes, _ = list_all(c, "ns", "b", prefix="fixed/", delimiter="/")
    assert prefixes == ["fixed/paper_1/", "fixed/paper_2/", "fixed/paper_3/"]
    assert "start" not in c.calls[0] and c.calls[1]["start"] == "fixed/paper_2/x.json"
    assert c.calls[1]["delimiter"] == "/" and c.calls[1]["prefix"] == "fixed/"


def test_objects_across_pages_without_delimiter():
    c = _Client([_page(objects=["r/a"], nxt="r/b"), _page(objects=["r/b"])])
    _, objects = list_all(c, "ns", "b", prefix="r/")
    assert [o.name for o in objects] == ["r/a", "r/b"]
    assert "delimiter" not in c.calls[0]


def test_single_page():
    c = _Client([_page(["x/"])])
    assert list_all(c, "ns", "b", delimiter="/")[0] == ["x/"] and len(c.calls) == 1
