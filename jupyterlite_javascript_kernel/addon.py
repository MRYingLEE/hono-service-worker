# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

"""jupyterlite-core addon that ships the JavaScript kernel lab scripts."""

import shutil
from pathlib import Path

from jupyterlite_core.addons.base import BaseAddon

SERVICE_WORKER_NAME = "javascript-kernel-service-worker.js"
WORKER_RUNTIME_NAME = "javascript-kernel-worker-runtime.js"
LAB_SCRIPTS = (SERVICE_WORKER_NAME, WORKER_RUNTIME_NAME)
SOURCE_DIR = Path(__file__).parent


def _copy_script(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


class JavaScriptKernelAddon(BaseAddon):
    """Copy the bundled lab scripts into the JupyterLite ``lab/`` output."""

    __all__ = ["build"]

    def build(self, manager):
        for name in LAB_SCRIPTS:
            source = SOURCE_DIR / name
            target = manager.output_dir / "lab" / name

            yield self.task(
                name=f"copy:{name}",
                file_dep=[source],
                targets=[target],
                actions=[(_copy_script, [source, target])],
            )
