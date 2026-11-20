"""Public entry point for reconstruction of a single failed message."""

from .legacy_renderer import InvalidReconstruction, render_body


def inspect_body(draft, inspection_code):
    try:
        return render_body(draft, inspection_code)
    except InvalidReconstruction:
        return (
            "Reconstruction rejected: unsupported or oversized template.\n"
            "Draft reconstruction is active. This mail system sends commands to a simulated "
            "recovery worker through a Jinja filter.\n"
            'To identify the worker, try {{ "whoami" | worker }} in the message body.'
        )
