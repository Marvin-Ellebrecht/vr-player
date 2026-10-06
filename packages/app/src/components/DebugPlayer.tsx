import { DebugRenderer } from '@vr-viewer/player';
import { useEffect, useRef } from 'react';
import type {
  Format,
  Layout,
  RenderBackend,
} from '@vr-viewer/player';

export function DebugPlayer({
  container,
  video,
  layout,
  flipLayout,
  format,
  autoPlay,
  view = 'left',
  renderBackend = 'auto',
}: {
  container: HTMLDivElement;
  video: HTMLVideoElement;
  layout: Layout;
  flipLayout: boolean;
  format: Format;
  autoPlay: boolean;
  view?: 'left' | 'right';
  renderBackend?: RenderBackend;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    /*
     * IMPORTANT:
     *
     * A canvas cannot change from WebGL -> WebGPU -> WebGL.
     *
     * Therefore every renderer gets a completely new canvas.
     */

    const canvas = document.createElement('canvas');

    canvas.className = 'w-full h-full';

    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';

    container.replaceChildren(canvas);

    canvasRef.current = canvas;

    let renderer: DebugRenderer | null = null;
    let stopped = false;

    const start = async () => {
      const newRenderer = new DebugRenderer(
        video,
        canvas,
        layout,
        flipLayout,
        format,
        view,
        renderBackend,
      );

      renderer = newRenderer;

      try {
        await newRenderer.start();

        /*
         * React may already have cleaned this renderer up
         * while the async WebGPU startup was still running.
         */
        if (stopped) {
          newRenderer.stop();
          return;
        }

        if (autoPlay) {
          await video.play().catch((error) => {
            console.warn(
              'Debug player autoplay failed:',
              error,
            );
          });
        }
      } catch (error) {
        if (!stopped) {
          console.error(
            `Failed to start ${renderBackend} renderer:`,
            error,
          );
        }

        try {
          newRenderer.stop();
        } catch {
          // Renderer may not have finished initializing.
        }

        if (renderer === newRenderer) {
          renderer = null;
        }
      }
    };

    void start();

    return () => {
      stopped = true;

      const oldRenderer = renderer;

      renderer = null;

      if (oldRenderer) {
        try {
          oldRenderer.stop();
        } catch (error) {
          console.warn(
            'Failed to stop debug renderer:',
            error,
          );
        }
      }

      /*
       * Remove the canvas completely.
       *
       * This is critical. The old canvas may have a WebGL
       * or WebGPU context permanently associated with it.
       */
      if (canvas.parentNode === container) {
        canvas.remove();
      }

      if (canvasRef.current === canvas) {
        canvasRef.current = null;
      }
    };
  }, [
    autoPlay,
    container,
    flipLayout,
    format,
    layout,
    video,
    view,
    renderBackend,
  ]);

  return null;
}