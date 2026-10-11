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
  renderBackend = 'webgpu',
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
    let stopped = false;
    let renderer: DebugRenderer | null = null;
    let activeCanvas: HTMLCanvasElement | null = null;

    const startRenderer = async (
      backend: RenderBackend,
    ): Promise<boolean> => {
      if (stopped) return false;
	  

      // Never reuse a canvas across rendering backends.
      const canvas = document.createElement('canvas');
      canvas.className = 'w-full h-full';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';

      container.replaceChildren(canvas);
      activeCanvas = canvas;
      canvasRef.current = canvas;

      const instance = new DebugRenderer(
        video,
        canvas,
        layout,
        flipLayout,
        format,
        view,
        backend,
      );

      renderer = instance;

      try {
        console.info(`[DebugPlayer] Starting ${backend}...`);

        await instance.start();

        if (stopped) {
          instance.stop();
          return false;
        }

        console.info(`[DebugPlayer] ${backend} started successfully.`);
        return true;
      } catch (error) {
        console.error(
          `[DebugPlayer] ${backend} failed to initialize:`,
          error,
        );

        try {
          instance.stop();
        } catch (stopError) {
          console.warn('[DebugPlayer] Renderer cleanup failed:', stopError);
        }

        if (renderer === instance) {
          renderer = null;
        }

        if (canvas.parentNode === container) {
          canvas.remove();
        }

        if (canvasRef.current === canvas) {
          canvasRef.current = null;
        }

        if (activeCanvas === canvas) {
          activeCanvas = null;
        }

        return false;
      }
    };

    const start = async () => {
      // Attempt the requested backend first.
      let backend: RenderBackend = renderBackend === 'auto'  ? 'webgpu' : renderBackend;
      let success = await startRenderer(backend);

      if (stopped) return;

      if (!success) {
        // Retry using the opposite backend and a new canvas.
        const fallbackBackend: RenderBackend =
          backend === 'webgpu' ? 'webgl1' : 'webgpu';

        console.warn(
          `[DebugPlayer] ${backend} failed; trying ${fallbackBackend}.`,
        );

        backend = fallbackBackend;
        success = await startRenderer(backend);
      }

      if (stopped) return;

      if (!success) {
        console.error(
          '[DebugPlayer] Both WebGPU and WebGL failed.',
        );

        window.alert(
          'Rendering failed. Both WebGPU and WebGL are unavailable or failed to initialize. Try a supported browser or update your graphics drivers.',
        );
        return;
      }

      if (autoPlay) {
        try {
          await video.play();
        } catch (error) {
          if (!stopped) {
            console.warn('[DebugPlayer] Autoplay failed:', error);
          }
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
          console.warn('[DebugPlayer] Failed to stop renderer:', error);
        }
      }

      if (activeCanvas?.parentNode === container) {
        activeCanvas.remove();
      }

      if (canvasRef.current === activeCanvas) {
        canvasRef.current = null;
      }

      activeCanvas = null;
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