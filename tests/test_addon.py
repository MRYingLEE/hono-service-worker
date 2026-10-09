# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from importlib.metadata import entry_points
from pathlib import Path

from jupyterlite_core.manager import LiteManager

from jupyterlite_javascript_kernel import addon


def _build_tasks(output_dir: Path):
    manager = LiteManager(output_dir=output_dir)
    return list(addon.JavaScriptKernelAddon(manager=manager).build(manager))


def _run_actions(task):
    for func, args in task["actions"]:
        func(*args)


def _write_bundles(source_dir: Path) -> None:
    source_dir.mkdir(parents=True, exist_ok=True)
    for name in addon.LAB_SCRIPTS:
        (source_dir / name).write_text(f"// {name}")


def test_build_yields_one_task_per_lab_script_targeting_lab(tmp_path):
    tasks = _build_tasks(tmp_path / "_output")

    assert [task["targets"] for task in tasks] == [
        [tmp_path / "_output" / "lab" / name] for name in addon.LAB_SCRIPTS
    ]


def test_build_depends_on_each_bundled_script(tmp_path, monkeypatch):
    _write_bundles(tmp_path / "bundles")
    monkeypatch.setattr(addon, "SOURCE_DIR", tmp_path / "bundles")

    tasks = _build_tasks(tmp_path / "_output")

    assert [task["file_dep"] for task in tasks] == [
        [tmp_path / "bundles" / name] for name in addon.LAB_SCRIPTS
    ]


def test_build_copies_each_bundle_into_the_lab_output(tmp_path, monkeypatch):
    _write_bundles(tmp_path / "bundles")
    monkeypatch.setattr(addon, "SOURCE_DIR", tmp_path / "bundles")

    for task in _build_tasks(tmp_path / "_output"):
        _run_actions(task)

    for name in addon.LAB_SCRIPTS:
        target = tmp_path / "_output" / "lab" / name
        assert target.read_text() == f"// {name}"


def test_service_worker_name_is_the_registered_script_name():
    assert addon.SERVICE_WORKER_NAME == "javascript-kernel-service-worker.js"


def test_worker_runtime_name_is_the_name_the_backend_loads():
    assert addon.WORKER_RUNTIME_NAME == "javascript-kernel-worker-runtime.js"


def test_addon_is_registered_as_a_jupyterlite_addon():
    registered = {ep.value for ep in entry_points(group="jupyterlite.addon.v0")}

    assert "jupyterlite_javascript_kernel.addon:JavaScriptKernelAddon" in registered
