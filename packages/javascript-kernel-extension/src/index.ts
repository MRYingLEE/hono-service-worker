// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IConsoleTracker } from '@jupyterlab/console';
import type { ConsolePanel } from '@jupyterlab/console';
import { INotebookTracker } from '@jupyterlab/notebook';
import type { NotebookPanel } from '@jupyterlab/notebook';

import type { IKernel } from '@jupyterlite/services';

import { IKernelSpecs } from '@jupyterlite/services';
import { DisposableDelegate } from '@lumino/disposable';
import type { IDisposable } from '@lumino/disposable';
import { Signal } from '@lumino/signaling';

import {
  IJavaScriptKernelStartupRegistry,
  JavaScriptKernel,
  connectServiceWorker
} from '@jupyterlite/javascript-kernel';
import type {
  IDispatchTarget,
  RuntimeMode
} from '@jupyterlite/javascript-kernel';

import jsLogo32 from '../style/icons/logo-32x32.png';

import jsLogo64 from '../style/icons/logo-64x64.png';

/**
 * Register a JavaScript kernelspec for a given runtime.
 */
interface IRegisterKernelOptions {
  name: string;
  displayName: string;
  runtime: RuntimeMode;
}

const registerKernel = (
  kernelspecs: IKernelSpecs,
  options: IRegisterKernelOptions
) => {
  const { name, displayName, runtime } = options;

  kernelspecs.register({
    spec: {
      name,
      display_name: displayName,
      language: 'javascript',
      argv: [],
      spec: {
        argv: [],
        env: {},
        display_name: displayName,
        language: 'javascript',
        interrupt_mode: 'message',
        metadata: {
          runtime
        }
      },
      resources: {
        'logo-32x32': jsLogo32,
        'logo-64x64': jsLogo64
      }
    },
    create: async (options: IKernel.IOptions): Promise<IKernel> => {
      const kernel = new JavaScriptKernel({
        ...options,
        runtime,
        startupExtensions: Private.startupExtensions
      } as JavaScriptKernel.IOptions);
      Private.kernelCreated.emit(kernel);
      return kernel;
    }
  });
};

/**
 * In-memory registry for JavaScript kernel startup extensions.
 */
class JavaScriptKernelStartupRegistry implements IJavaScriptKernelStartupRegistry {
  get startupExtensions(): readonly JavaScriptKernel.IStartupExtension[] {
    return [...Private.startupExtensions];
  }

  registerStartupExtension(
    extension: JavaScriptKernel.IStartupExtension
  ): IDisposable {
    const existing = Private.startupExtensions.findIndex(
      item => item.id === extension.id
    );

    if (existing !== -1) {
      throw new Error(
        `JavaScript kernel startup extension "${extension.id}" is already registered`
      );
    }

    Private.startupExtensions.push(extension);
    void Promise.all(
      [...Private.kernels].map(kernel =>
        kernel.applyStartupExtension(extension)
      )
    ).catch(error => {
      console.error(
        `[javascript-kernel] Failed to apply startup extension "${extension.id}".`,
        error
      );
    });

    return new DisposableDelegate(() => {
      const index = Private.startupExtensions.indexOf(extension);
      if (index !== -1) {
        Private.startupExtensions.splice(index, 1);
        void Promise.all(
          [...Private.kernels].map(kernel =>
            kernel.removeStartupExtension(extension)
          )
        ).catch(error => {
          console.error(
            `[javascript-kernel] Failed to remove startup extension "${extension.id}".`,
            error
          );
        });
      }
    });
  }
}

namespace Private {
  export const startupExtensions: JavaScriptKernel.IStartupExtension[] = [];
  export const kernels = new Set<JavaScriptKernel>();
  /**
   * Runtime backends of live kernels, keyed by kernel id, for service worker
   * dispatch.
   */
  export const backends = new Map<string, IDispatchTarget>();

  const kernelCreatedOwner = {};
  export const kernelCreated = new Signal<
    typeof kernelCreatedOwner,
    JavaScriptKernel
  >(kernelCreatedOwner);

  /**
   * Track an active JavaScript kernel for late startup registrations.
   */
  const trackKernel = (kernel: JavaScriptKernel): void => {
    kernels.add(kernel);
    backends.set(kernel.id, kernel.runtimeBackend);
    void Promise.all(
      startupExtensions.map(extension =>
        kernel.applyStartupExtension(extension)
      )
    ).catch(error => {
      console.error(
        '[javascript-kernel] Failed to apply startup extensions.',
        error
      );
    });
    const untrackKernel = (sender: JavaScriptKernel): void => {
      kernels.delete(sender);
      backends.delete(sender.id);
      sender.disposed.disconnect(untrackKernel);
    };
    kernel.disposed.connect(untrackKernel);
  };

  kernelCreated.connect((_sender, kernel) => {
    trackKernel(kernel);
  });
}

/**
 * Plugin providing the JavaScript kernel startup extension registry.
 */
const startupExtensionsRegistry: JupyterFrontEndPlugin<IJavaScriptKernelStartupRegistry> =
  {
    id: '@jupyterlite/javascript-kernel-extension:startup-extensions',
    autoStart: true,
    provides: IJavaScriptKernelStartupRegistry,
    activate: () => new JavaScriptKernelStartupRegistry()
  };

/**
 * Plugin registering the iframe JavaScript kernel.
 */
const kernelIFrame: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlite/javascript-kernel-extension:kernel-iframe',
  autoStart: true,
  requires: [IKernelSpecs],
  activate: (app: JupyterFrontEnd, kernelspecs: IKernelSpecs) => {
    registerKernel(kernelspecs, {
      name: 'javascript',
      displayName: 'JavaScript (IFrame)',
      runtime: 'iframe'
    });
  }
};

/**
 * Plugin registering the worker JavaScript kernel.
 */
const kernelWorker: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlite/javascript-kernel-extension:kernel-worker',
  autoStart: true,
  requires: [IKernelSpecs],
  activate: (app: JupyterFrontEnd, kernelspecs: IKernelSpecs) => {
    registerKernel(kernelspecs, {
      name: 'javascript-worker',
      displayName: 'JavaScript (Web Worker)',
      runtime: 'worker'
    });
  }
};

/**
 * Plugin registering the service worker that routes notebook page requests
 * to the runtime of the kernel that claimed them.
 */
const serviceWorker: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlite/javascript-kernel-extension:service-worker',
  autoStart: true,
  activate: () => {
    if (!('serviceWorker' in navigator)) {
      return;
    }
    const url = new URL(
      './javascript-kernel-service-worker.js',
      document.baseURI
    ).href;
    connectServiceWorker(navigator.serviceWorker, url, Private.backends).catch(
      error => {
        console.error(
          '[javascript-kernel] Failed to register the service worker.',
          error
        );
      }
    );
  }
};

/**
 * Kernelspec names registered by this extension. Must match `registerKernel`.
 */
const javaScriptKernelNames = new Set(['javascript', 'javascript-worker']);

/**
 * Plugin shutting down the JavaScript kernel of a notebook or console when its
 * tab closes, which also releases the kernel's service worker claims.
 */
const shutdownOnClose: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlite/javascript-kernel-extension:shutdown-on-close',
  autoStart: true,
  requires: [INotebookTracker, IConsoleTracker],
  activate: (
    app: JupyterFrontEnd,
    notebooks: INotebookTracker,
    consoles: IConsoleTracker
  ) => {
    const track = (panel: NotebookPanel | ConsolePanel): void => {
      const { sessionContext } = panel;
      let sessionId: string | null = null;

      const updateSessionId = (): void => {
        // Ignore updates once the context is disposed: disposing the session
        // emits a null session, which must not forget the id to shut down.
        if (sessionContext.isDisposed) {
          return;
        }
        const session = sessionContext.session;
        sessionId =
          session && javaScriptKernelNames.has(session.kernel?.name ?? '')
            ? session.id
            : null;
      };
      updateSessionId();
      sessionContext.sessionChanged.connect(updateSessionId);
      sessionContext.kernelChanged.connect(updateSessionId);

      panel.disposed.connect(() => {
        // The widget manager disposes the context before this slot runs when
        // this was the last view. Otherwise another view still uses the kernel.
        if (!sessionContext.isDisposed || sessionId === null) {
          return;
        }
        app.serviceManager.sessions.shutdown(sessionId).catch(error => {
          console.error(
            '[javascript-kernel] Failed to shut down the kernel on close.',
            error
          );
        });
      });
    };

    notebooks.forEach(track);
    notebooks.widgetAdded.connect((_, panel) => track(panel));
    consoles.forEach(track);
    consoles.widgetAdded.connect((_, panel) => track(panel));
  }
};

const plugins: Array<
  | JupyterFrontEndPlugin<IJavaScriptKernelStartupRegistry>
  | JupyterFrontEndPlugin<void>
> = [
  startupExtensionsRegistry,
  kernelIFrame,
  kernelWorker,
  serviceWorker,
  shutdownOnClose
];

export default plugins;
