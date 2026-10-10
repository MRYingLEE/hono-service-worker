# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

"""jupyterlite-core addon that ships the JavaScript kernel lab scripts."""

import shutil
from pathlib import Path

from jupyterlite_core.addons.base import BaseAddon

SERVICE_WORKER_NAME = "javascript-kernel-service-worker.js"
WORKER_RUNTIME_NAME = "javascript-kernel-worker-runtime.js"
LAB_SCRIPTS = (SERVICE_WORKER_NAME, WORKER_RUNTIME_NAME)
# Each app resolves the service worker relative to its own base URL, so the
# scripts must be present in every app that can run kernels.
KERNEL_APPS = ("lab", "notebooks", "repl", "consoles")
SOURCE_DIR = Path(__file__).parent


def _copy_script(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


class JavaScriptKernelAddon(BaseAddon):
    """Copy the bundled lab scripts into the output of each kernel-capable app."""

    __all__ = ["build"]

    def build(self, manager):
        apps = [app for app in KERNEL_APPS if not manager.apps or app in manager.apps]

        for app in apps:
            for name in LAB_SCRIPTS:
                source = SOURCE_DIR / name
                target = manager.output_dir / app / name

                yield self.task(
                    name=f"copy:{app}/{name}",
                    file_dep=[source],
                    targets=[target],
                    actions=[(_copy_script, [source, target])],
                )
