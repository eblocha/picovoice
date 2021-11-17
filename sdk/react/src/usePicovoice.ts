import { useState, useEffect, useRef } from 'react';

import { WebVoiceProcessor } from '@picovoice/web-voice-processor';

import {
  PicovoiceHookArgs,
  PicovoiceWorker,
  PicovoiceWorkerFactory,
  PicovoiceWorkerResponse,
  RhinoInference,
} from './picovoice_hook_types';

type EngineControlType = 'ppn' | 'rhn';

export function usePicovoice(
  picovoiceWorkerFactory: PicovoiceWorkerFactory | null,
  picovoiceHookArgs: PicovoiceHookArgs | null,
  keywordCallback: (keywordLabel: string) => void,
  inferenceCallback: (inference: RhinoInference) => void
): {
  contextInfo: string | null;
  isLoaded: boolean;
  isListening: boolean;
  isError: boolean | null;
  errorMessage: string | null;
  engine: EngineControlType;
  webVoiceProcessor: WebVoiceProcessor | null;
  start: () => void;
  pause: () => void;
} {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [contextInfo, setContextInfo] = useState<string | null>(null);
  const [isError, setIsError] = useState<boolean | null>(false);
  const [isListening, setIsListening] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [engine, setEngine] = useState<EngineControlType>('ppn');
  const [
    picovoiceWorker,
    setPicovoiceWorker,
  ] = useState<PicovoiceWorker | null>(null);
  const [
    webVoiceProcessor,
    setWebVoiceProcessor,
  ] = useState<WebVoiceProcessor | null>(null);
  const porcupineCallback = useRef(keywordCallback);
  const rhinoCallback = useRef(inferenceCallback);

  const start = (): boolean => {
    if (webVoiceProcessor !== null) {
      webVoiceProcessor.start();
      setIsListening(true);
      return true;
    }
    return false;
  };

  const pause = (): boolean => {
    if (webVoiceProcessor !== null) {
      webVoiceProcessor.pause();
      setIsListening(false);
      return true;
    }
    return false;
  };

  /** Refresh the keyword and inference callbacks
   * when they change (avoid stale closure) */
  useEffect(() => {
    if (picovoiceWorker !== null) {
      picovoiceWorker.onmessage = (
        message: MessageEvent<PicovoiceWorkerResponse>
      ): void => {
        switch (message.data.command) {
          case 'ppn-keyword':
            porcupineCallback.current(message.data.keywordLabel);
            setEngine('rhn');
            break;
          case 'rhn-inference':
            rhinoCallback.current(message.data.inference);
            setEngine('ppn');
            break;
          case 'rhn-info':
            setContextInfo(message.data.info);
            break;
          default:
            break;
        }
      };
    }
  }, [porcupineCallback, rhinoCallback]);

  useEffect(() => {
    if (
      picovoiceWorkerFactory === null ||
      picovoiceWorkerFactory === undefined
    ) {
      return (): void => {
        /* NOOP */
      };
    }

    if (picovoiceHookArgs === null || picovoiceHookArgs === undefined) {
      return (): void => {
        /* NOOP */
      };
    }

    const { accessKey, start: startWebVp = true } = picovoiceHookArgs!;
    if (accessKey === null || accessKey === '') {
      return (): void => {
        /* NOOP */
      };
    }

    async function startPicovoice(): Promise<{
      webVp: WebVoiceProcessor;
      pvWorker: PicovoiceWorker;
    }> {
      // Argument checking; the engines will also do checking but we can get
      // clearer error messages from the hook
      if (picovoiceHookArgs!.porcupineKeyword === undefined) {
        throw Error('porcupineKeyword is missing');
      }
      if (picovoiceHookArgs!.rhinoContext === undefined) {
        throw Error('rhinoContext is missing');
      }
      if (typeof porcupineCallback.current !== 'function') {
        throw Error('porcupineCallback is not a function');
      }
      if (typeof rhinoCallback.current !== 'function') {
        throw Error('rhinoCallback is not a function');
      }

      const pvWorker: PicovoiceWorker = await picovoiceWorkerFactory!.create({
        ...picovoiceHookArgs!,
        start: true,
      });

      pvWorker.onmessage = (
        message: MessageEvent<PicovoiceWorkerResponse>
      ): void => {
        switch (message.data.command) {
          case 'ppn-keyword':
            porcupineCallback.current(message.data.keywordLabel);
            setEngine('rhn');
            break;
          case 'rhn-inference':
            rhinoCallback.current(message.data.inference);
            setEngine('ppn');
            break;
          case 'rhn-info':
            setContextInfo(message.data.info);
            break;
          default:
            break;
        }
      };

      pvWorker.postMessage({ command: 'info' });

      const webVp = await WebVoiceProcessor.init({
        engines: [pvWorker],
        start: startWebVp,
      });

      return { webVp, pvWorker };
    }
    const startPicovoicePromise = startPicovoice();

    startPicovoicePromise
      .then(({ webVp, pvWorker }) => {
        setIsLoaded(true);
        setIsListening(webVp.isRecording);
        setWebVoiceProcessor(webVp);
        setPicovoiceWorker(pvWorker);
        setIsError(false);
      })
      .catch(error => {
        setIsError(true);
        setErrorMessage(error.toString());
      });

    return (): void => {
      startPicovoicePromise.then(({ webVp, pvWorker }) => {
        if (webVp !== undefined) {
          webVp.release();
        }
        if (pvWorker !== undefined) {
          pvWorker.postMessage({ command: 'release' });
        }
      });
    };
  }, [
    picovoiceWorkerFactory,
    // https://github.com/facebook/react/issues/14476#issuecomment-471199055
    // ".... we know our data structure is relatively shallow, doesn't have cycles,
    // and is easily serializable ... doesn't have functions or weird objects like Dates.
    // ... it's acceptable to pass [JSON.stringify(variables)] as a dependency."
    JSON.stringify(picovoiceHookArgs),
  ]);

  return {
    contextInfo,
    isLoaded,
    isListening,
    isError,
    errorMessage,
    engine,
    webVoiceProcessor,
    start,
    pause,
  };
}
