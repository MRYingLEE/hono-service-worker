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


def test_build_yields_one_task_targeting_lab(tmp_path):
    tasks = _build_tasks(tmp_path / "_output")

    assert len(tasks) == 1
    assert tasks[0]["targets"] == [
        tmp_path / "_output" / "lab" / addon.SERVICE_WORKER_NAME
    ]


def test_build_depends_on_the_bundled_script(tmp_path, monkeypatch):
    source = tmp_path / "bundle.js"
    source.write_text("self.addEventListener('fetch', () => {});")
    monkeypatch.setattr(addon, "SOURCE", source)

    tasks = _build_tasks(tmp_path / "_output")

    assert tasks[0]["file_dep"] == [source]


def test_build_copies_the_bundle_into_the_lab_output(tmp_path, monkeypatch):
    source = tmp_path / "bundle.js"
    source.write_text("self.addEventListener('fetch', () => {});")
    monkeypatch.setattr(addon, "SOURCE", source)

    task = _build_tasks(tmp_path / "_output")[0]
    _run_actions(task)

    target = tmp_path / "_output" / "lab" / addon.SERVICE_WORKER_NAME
    assert target.read_text() == source.read_text()


def test_service_worker_name_is_the_registered_script_name():
    assert addon.SERVICE_WORKER_NAME == "javascript-kernel-service-worker.js"


def test_addon_is_registered_as_a_jupyterlite_addon():
    registered = {ep.value for ep in entry_points(group="jupyterlite.addon.v0")}

    assert "jupyterlite_javascript_kernel.addon:JavaScriptKernelAddon" in registered
