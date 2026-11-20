"""Parse a small output-only subset of Jinja for the Dead Letter Office."""

from jinja2 import StrictUndefined, TemplateError, nodes
from jinja2.sandbox import SandboxedEnvironment
from jinja2.visitor import NodeTransformer

from .virtual_shell import worker_reply


class InvalidReconstruction(ValueError):
    pass


class MailSandbox(SandboxedEnvironment):
    intercepted_binops = frozenset({"+", "-", "*"})

    def call_binop(self, context, operator, left, right):
        if type(left) is not int or type(right) is not int:
            raise InvalidReconstruction()
        result = super().call_binop(context, operator, left, right)
        if result.bit_length() > 64:
            raise InvalidReconstruction()
        return result

    def getitem(self, obj, key):
        if type(obj) is dict and type(key) is str and not key.startswith("_") and key in obj:
            return obj[key]
        raise InvalidReconstruction()

    # Dot and bracket syntax both read a plain dictionary key.
    getattr = getitem

    def is_safe_callable(self, obj):
        return False


FILTERS = {"upper": str.upper, "lower": str.lower, "trim": str.strip, "length": len}
ENV = MailSandbox(undefined=StrictUndefined, optimized=False, keep_trailing_newline=True)
ENV.globals.clear()
ENV.filters.clear()
ENV.tests.clear()
ENV.filters.update(FILTERS)
ALLOWED = {
    nodes.Template, nodes.Output, nodes.TemplateData, nodes.Const, nodes.Name,
    nodes.Dict, nodes.Pair, nodes.Getattr, nodes.Getitem, nodes.Filter, nodes.Call,
    nodes.Add, nodes.Sub, nodes.Mul, nodes.Pos, nodes.Neg, nodes.Concat,
}


def public_key(node):
    return (isinstance(node, nodes.Const) and type(node.value) is str
            and not node.value.startswith("_"))


def validate(tree):
    stack = [(tree, 0)]
    count = 0
    while stack:
        n, depth = stack.pop()
        count += 1
        if count > 160 or depth > 20 or type(n) not in ALLOWED:
            raise InvalidReconstruction()
        if isinstance(n, nodes.Const):
            if type(n.value) not in (str, int) or (type(n.value) is int and n.value.bit_length() > 32):
                raise InvalidReconstruction()
        elif isinstance(n, nodes.Name) and n.name not in {"mail", "subject", "recipient"}:
            raise InvalidReconstruction()
        elif isinstance(n, nodes.Getattr) and n.attr.startswith("_"):
            raise InvalidReconstruction()
        elif isinstance(n, nodes.Getitem) and not public_key(n.arg):
            raise InvalidReconstruction()
        elif isinstance(n, nodes.Pair) and not public_key(n.key):
            raise InvalidReconstruction()
        elif isinstance(n, (nodes.Call, nodes.Filter)):
            if n.kwargs or n.dyn_args is not None or n.dyn_kwargs is not None:
                raise InvalidReconstruction()
            if isinstance(n, nodes.Call):
                if not isinstance(n.node, nodes.Name) or n.node.name != "length" or len(n.args) != 1:
                    raise InvalidReconstruction()
                stack.append((n.args[0], depth + 1))
                continue
            elif n.name == "worker":
                if n.args or not isinstance(n.node, nodes.Const) or type(n.node.value) is not str:
                    raise InvalidReconstruction()
            elif n.name not in FILTERS or n.args:
                raise InvalidReconstruction()
        stack.extend((child, depth + 1) for child in n.iter_child_nodes())


class ReconstructionExpressions(NodeTransformer):
    def __init__(self, flag):
        self.flag = flag

    def visit_Call(self, node):
        # Validation permits only the one-argument length call.
        return nodes.Filter(self.visit(node.args[0]), "length", [], [], None, None).set_lineno(node.lineno)

    def visit_Filter(self, node):
        if node.name == "worker":
            return nodes.Const(worker_reply(node.node.value, self.flag)).set_lineno(node.lineno)
        return self.generic_visit(node)


def render_body(draft, flag):
    source = draft["body"]
    if len(source) > 2048:
        raise InvalidReconstruction()
    fields = {key: draft[key] for key in ("subject", "recipient")}
    if any(len(value) > 8192 for value in fields.values()):
        raise InvalidReconstruction()
    try:
        tree = ENV.parse(source)
        validate(tree)
        inert_tree = ReconstructionExpressions(flag).visit(tree)
        template = ENV.template_class.from_code(ENV, ENV.compile(inert_tree), ENV.globals, None)
        result = template.render(mail=fields, **fields)
        if len(result) > 8192:
            raise InvalidReconstruction()
        return result
    except (TemplateError, TypeError, OverflowError, RecursionError, ValueError) as error:
        raise InvalidReconstruction() from error
