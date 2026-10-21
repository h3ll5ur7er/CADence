/// <reference lib="webworker" />
import { serveSandbox } from '@core/utilities/sandbox';

/**
 * The script worker (docs/Architecture/Decisions.md#adr-60): runs one script of the app's script
 * console in the sandbox, asking the main thread for the scripting API's calls. Stop ends the worker.
 */
serveSandbox({ post: (message) => self.postMessage(message), listen: (handler) => self.addEventListener('message', (event) => handler(event.data)) });
