# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

"""jupyterlite-core addon that ships the JavaScript kernel service worker."""

import shutil
from pathlib import Path

from jupyterlite_core.addons.base import BaseAddon

SERVICE_WORKER_NAME = "javascript-kernel-service-worker.js"
SOURCE = Path(__file__).parent / SERVICE_WORKER_NAME


def _copy_service_worker(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


class JavaScriptKernelAddon(BaseAddon):
    """Copy the bundled service worker into the JupyterLite ``lab/`` output."""

    __all__ = ["build"]

    def build(self, manager):
        target = manager.output_dir / "lab" / SERVICE_WORKER_NAME

        yield self.task(
            name=f"copy:{SERVICE_WORKER_NAME}",
            file_dep=[SOURCE],
            targets=[target],
            actions=[(_copy_service_worker, [SOURCE, target])],
        )
