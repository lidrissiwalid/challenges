import builtins
import os
import socket
import subprocess

import pytest

from postmortem.inspection import inspect_body


def preview(source, flag="TEST"):
    return inspect_body({"body": source, "subject": " Paper ", "recipient": "clerk"}, flag)


@pytest.mark.parametrize(("source", "result"), [
    ("{{ (3 + 4) * 7 }}", "49"),
    ("{{ (mail.subject | trim ~ ' trail') | upper }}", "PAPER TRAIL"),
    ("{{ {'meta': mail}['meta'].recipient }}", "clerk"),
    ("{{ length(mail.subject | trim) }}", "5"),
    ('{{ "cat /opt/deadletter/flag.txt" | worker }}', "{{7*7}}"),
])
def test_supported_expressions(source, result):
    assert preview(source, flag="{{7*7}}") == result


@pytest.mark.parametrize("source", [
    "{{ mail.__class__ }}", "{{ mail['_private'] }}", "{{ mail.items() }}",
    "{{ missing }}", "{{ length }}", "{{ subject | attr('name') }}",
    "{{ open('flag.txt') }}", "{% import 'other' as lib %}", "{% include 'other' %}",
    "{{ config }}", "{{ length(mail, mail) }}", "{{ subject | worker }}",
    "{{ 'id' | worker(1) }}", "{{ 'xx' * 1000000 }}", "{{ 10**1000 }}",
    "{{ (1 + }}", "{{ (2147483647 * 2147483647) * 2147483647 }}",
])
def test_forbidden_forms(source):
    assert preview(source).startswith("Reconstruction rejected:")


def test_worker_uses_no_host_capabilities(monkeypatch):
    def denied(*args, **kwargs):
        pytest.fail("renderer accessed a host capability")

    with monkeypatch.context() as guard:
        guard.setattr(subprocess, "Popen", denied)
        guard.setattr(os, "system", denied)
        guard.setattr(os, "popen", denied)
        guard.setattr(builtins, "open", denied)
        guard.setattr(socket, "socket", denied)
        for cmd in ("id", "whoami", "pwd", "ls", "ls /opt/deadletter",
                    "cat /opt/deadletter/flag.txt", "cat /another/file"):
            assert preview('{{ "' + cmd + '" | worker }}')
