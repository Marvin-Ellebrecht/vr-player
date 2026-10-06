import { mat4, vec4 } from 'gl-matrix';
import type { Format, Layout } from '../types';
import {
  Renderer,
  VideoFrameTracker,
} from './renderer';
import {
  resolveRenderBackend,
  type RenderBackend,
} from './renderBackend';
import { WebGPUDebugRenderer } from './webgpuDebugRenderer';
import type { Texture2DOptions } from 'regl';
import type { RenderProps } from './renderProps';

export class DebugRenderer {
  private renderer:
    | Renderer
    | WebGPUDebugRenderer
    | null = null;

  private readonly backend: Exclude<
    RenderBackend,
    'auto'
  >;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly layout: Layout,
    private readonly flipLayout: boolean,
    private readonly format: Format,
    private readonly eye: 'left' | 'right',
    requestedBackend: RenderBackend = 'auto',
  ) {
    this.backend =
      resolveRenderBackend(
        requestedBackend,
        canvas,
      );
  }

  async start(): Promise<void> {
    if (this.backend === 'webgpu') {
      const renderer =
        new WebGPUDebugRenderer(
          this.video,
          this.canvas,
          this.layout,
          this.flipLayout,
          this.format,
          this.eye,
        );

      this.renderer = renderer;

      await renderer.start();

      return;
    }

    const renderer =
      new WebGLDebugRenderer(
        this.video,
        this.canvas,
        this.layout,
        this.flipLayout,
        this.format,
        this.eye,
        this.backend === 'webgl2'
          ? 2
          : 1,
      );

    this.renderer = renderer;

    await renderer.start();
  }

  stop() {
    this.renderer?.stop();
    this.renderer = null;
  }

  getBackend() {
    return this.backend;
  }
}

class WebGLDebugRenderer extends Renderer {
  private raf = 0;

  private frameTracker:
    | VideoFrameTracker
    | null = null;

  private yaw = 0;
  private pitch = 0;
  private fov = Math.PI / 2;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    layout: Layout,
    flipLayout: boolean,
    format: Format,
    private readonly eye: 'left' | 'right',
    webglVersion: 1 | 2,
  ) {
    super(
      canvas,
      layout,
      flipLayout,
      format,
      webglVersion,
    );

    canvas.style.cursor = 'grab';

    canvas.addEventListener(
      'pointerdown',
      this.handlePointerDown,
    );

    canvas.addEventListener(
      'pointermove',
      this.handlePointerMove,
    );

    canvas.addEventListener(
      'pointerup',
      this.handlePointerUp,
    );

    canvas.addEventListener(
      'pointercancel',
      this.handlePointerUp,
    );

    canvas.addEventListener(
      'wheel',
      this.handleWheel,
      { passive: false },
    );

    window.addEventListener(
      'keydown',
      this.handleKeyDown,
    );
  }

  protected stopDrawLoop() {
    cancelAnimationFrame(
      this.raf,
    );

    this.frameTracker?.stop();

    this.canvas.removeEventListener(
      'pointerdown',
      this.handlePointerDown,
    );

    this.canvas.removeEventListener(
      'pointermove',
      this.handlePointerMove,
    );

    this.canvas.removeEventListener(
      'pointerup',
      this.handlePointerUp,
    );

    this.canvas.removeEventListener(
      'pointercancel',
      this.handlePointerUp,
    );

    this.canvas.removeEventListener(
      'wheel',
      this.handleWheel,
    );

    window.removeEventListener(
      'keydown',
      this.handleKeyDown,
    );
  }

  private handlePointerDown = (
    event: PointerEvent,
  ) => {
    if (event.button !== 0) {
      return;
    }

    this.dragging = true;

    this.lastX = event.clientX;
    this.lastY = event.clientY;

    this.canvas.style.cursor =
      'grabbing';

    this.canvas.setPointerCapture(
      event.pointerId,
    );
  };

  private handlePointerMove = (
    event: PointerEvent,
  ) => {
    if (!this.dragging) {
      return;
    }

    const dx =
      event.clientX - this.lastX;

    const dy =
      event.clientY - this.lastY;

    this.lastX = event.clientX;
    this.lastY = event.clientY;

    this.yaw += dx * 0.005;
    this.pitch += dy * 0.005;

    const limit =
      Math.PI / 2 - 0.01;

    this.pitch = Math.max(
      -limit,
      Math.min(limit, this.pitch),
    );
  };

  private handlePointerUp = (
    event: PointerEvent,
  ) => {
    this.dragging = false;

    this.canvas.style.cursor =
      'grab';

    if (
      this.canvas.hasPointerCapture(
        event.pointerId,
      )
    ) {
      this.canvas.releasePointerCapture(
        event.pointerId,
      );
    }
  };

  private handleWheel = (
    event: WheelEvent,
  ) => {
    event.preventDefault();

    this.fov +=
      event.deltaY * 0.0015;

    this.fov = Math.max(
      Math.PI / 6,
      Math.min(
        Math.PI * 0.85,
        this.fov,
      ),
    );
  };

  private handleKeyDown = (
    event: KeyboardEvent,
  ) => {
    if (
      event.key.toLowerCase() === 'r'
    ) {
      this.yaw = 0;
      this.pitch = 0;
      this.fov = Math.PI / 2;
    }
  };

  protected async startDrawLoop() {
    const textureProps:
      Texture2DOptions = {
        data: this.video,
        flipY: true,
      };

    const texture =
      this.regl.texture(
        textureProps,
      );

    this.frameTracker =
      new VideoFrameTracker(
        this.video,
      );

    const inverseModel =
      this.getInverseModelMatrix(
        this.video,
      );

    const offsets =
      this.getTexCoordScaleOffsets();

    const offset =
      this.eye === 'left'
        ? offsets[0]
        : offsets[1];

    const drawLoop = () => {
      this.regl.clear({
        color: [0, 0, 0, 1],
        depth: 1,
      });

      if (
        this.frameTracker?.consumeFrame()
      ) {
        texture.subimage(
          textureProps,
        );
      }

      const projection =
        mat4.perspective(
          mat4.create(),
          this.fov,
          this.canvas.width /
            Math.max(
              this.canvas.height,
              1,
            ),
          0.01,
          100,
        );

      const direction =
        vec4.fromValues(
          0,
          0,
          -1,
          0,
        );

      const rotation =
        mat4.create();

      mat4.rotateY(
        rotation,
        rotation,
        this.yaw,
      );

      mat4.rotateX(
        rotation,
        rotation,
        this.pitch,
      );

      vec4.transformMat4(
        direction,
        direction,
        rotation,
      );

      const view =
        mat4.lookAt(
          mat4.create(),
          [0, 0, 0],
          [
            direction[0],
            direction[1],
            direction[2],
          ],
          [0, 1, 0],
        );

      const vp =
        mat4.multiply(
          mat4.create(),
          projection,
          view,
        );

	const inverseVP = mat4.create();

	if (mat4.invert(inverseVP, vp) === null) {
	  return;
	}

      const imvp =
        mat4.multiply(
          mat4.create(),
          inverseModel,
          inverseVP,
        );

      const tempEye =
        vec4.fromValues(
          0,
          0,
          0,
          1,
        );

      vec4.transformMat4(
        tempEye,
        tempEye,
        inverseModel,
      );

      const modelSpaceEye =
        new Float32Array([
          tempEye[0],
          tempEye[1],
          tempEye[2],
        ]);

      const props: RenderProps = {
        inverseModelViewProjection:
          imvp,

        modelSpaceEye,

        texture,

        viewport: {
          x: 0,
          y: 0,
          width: this.canvas.width,
          height: this.canvas.height,
        },

        texCoordScaleOffset: offset,
      };

      this.cmdRender(props);

      this.raf =
        requestAnimationFrame(
          drawLoop,
        );
    };

    this.raf =
      requestAnimationFrame(
        drawLoop,
      );
  }
}
