from . import util


def build_service(name: str) -> dict[str, str]:
    return {"name": util.normalize_name(name)}
