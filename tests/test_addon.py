# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from importlib.metadata import entry_points
from pathlib import Path

from jupyterlite_core.manager import LiteManager

from jupyterlite_javascript_kernel import addon


def _build_tasks(output_dir: Path, apps=()):
    manager = LiteManager(output_dir=output_dir, apps=list(apps))
    return list(addon.JavaScriptKernelAddon(manager=manager).build(manager))


def _app_targets(output_dir: Path, apps=addon.KERNEL_APPS):
    return [output_dir / app / name for app in apps for name in addon.LAB_SCRIPTS]


def _run_actions(task):
    for func, args in task["actions"]:
        func(*args)


def _write_bundles(source_dir: Path) -> None:
    source_dir.mkdir(parents=True, exist_ok=True)
    for name in addon.LAB_SCRIPTS:
        (source_dir / name).write_text(f"// {name}")


def test_build_yields_one_task_per_script_and_kernel_app(tmp_path):
    tasks = _build_tasks(tmp_path / "_output")

    assert [task["targets"] for task in tasks] == [
        [target] for target in _app_targets(tmp_path / "_output")
    ]


def test_build_only_targets_requested_apps(tmp_path):
    tasks = _build_tasks(tmp_path / "_output", apps=["notebooks", "tree"])

    assert [task["targets"] for task in tasks] == [
        [target]
        for target in _app_targets(tmp_path / "_output", apps=["notebooks"])
    ]


def test_build_depends_on_each_bundled_script(tmp_path, monkeypatch):
    _write_bundles(tmp_path / "bundles")
    monkeypatch.setattr(addon, "SOURCE_DIR", tmp_path / "bundles")

    tasks = _build_tasks(tmp_path / "_output")

    assert [task["file_dep"] for task in tasks] == [
        [tmp_path / "bundles" / name]
        for _app in addon.KERNEL_APPS
        for name in addon.LAB_SCRIPTS
    ]


def test_build_copies_each_bundle_into_every_kernel_app_output(tmp_path, monkeypatch):
    _write_bundles(tmp_path / "bundles")
    monkeypatch.setattr(addon, "SOURCE_DIR", tmp_path / "bundles")

    for task in _build_tasks(tmp_path / "_output"):
        _run_actions(task)

    for app in addon.KERNEL_APPS:
        for name in addon.LAB_SCRIPTS:
            target = tmp_path / "_output" / app / name
            assert target.read_text() == f"// {name}"


def test_service_worker_name_is_the_registered_script_name():
    assert addon.SERVICE_WORKER_NAME == "javascript-kernel-service-worker.js"


def test_worker_runtime_name_is_the_name_the_backend_loads():
    assert addon.WORKER_RUNTIME_NAME == "javascript-kernel-worker-runtime.js"


def test_addon_is_registered_as_a_jupyterlite_addon():
    registered = {ep.value for ep in entry_points(group="jupyterlite.addon.v0")}

    assert "jupyterlite_javascript_kernel.addon:JavaScriptKernelAddon" in registered
