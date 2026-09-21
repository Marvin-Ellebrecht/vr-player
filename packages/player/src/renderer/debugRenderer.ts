import { Renderer, VideoFrameTracker } from './renderer';
import { mat4, vec4 } from 'gl-matrix';
import type { Format, Layout } from '../types';
import type { RenderProps } from './renderProps';
import type { Texture2DOptions } from 'regl';

export class DebugRenderer extends Renderer {
  private raf = 0;
  private frameTracker: VideoFrameTracker | null = null;

  private yaw = 0;
  private pitch = 0;
  private fov = Math.PI / 2;


  private dragging = false;
  private lastX = 0;
  private lastY = 0;
private hasInteracted = false;
private fps = 0;
private fpsFrames = 0;
private fpsLastTime = performance.now();



  constructor(
    private readonly video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    layout: Layout,
    flipLayout: boolean,
    format: Format,
    private readonly eye: 'left' | 'right',
  ) {
    super(canvas, layout, flipLayout, format);

    this.canvas.style.cursor = 'grab';

    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerUp);
    this.canvas.addEventListener('pointerleave', this.handlePointerUp);
    this.canvas.addEventListener('wheel', this.handleWheel, {
      passive: false,
    });

    window.addEventListener('keydown', this.handleKeyDown);
  }

  protected stopDrawLoop(): void {
    window.cancelAnimationFrame(this.raf);
    this.frameTracker?.stop();
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

  if (this.hasInteracted) {
    this.canvas.style.cursor = 'none';
  } else {
    this.canvas.style.cursor = 'grabbing';
  }

    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;

    this.canvas.style.cursor = 'grabbing';
    this.canvas.setPointerCapture(event.pointerId);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragging) {
      return;
    }

  if (event.buttons !== 0) {
    this.hasInteracted = true;
    this.canvas.style.cursor = 'none';
  }

if (!this.hasInteracted && event.buttons !== 0) {
  this.hasInteracted = true;
  this.canvas.style.cursor = 'none';
}


    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;

    this.lastX = event.clientX;
    this.lastY = event.clientY;

    const sensitivity = 0.005;

    this.yaw += dx * sensitivity;
    this.pitch += dy * sensitivity;

    const limit = Math.PI / 2 - 0.01;

    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  };

  private handlePointerUp = (event: PointerEvent): void => {
    this.dragging = false;
    this.canvas.style.cursor = this.hasInteracted ? 'none' : 'grab';

    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  };

private handleWheel = (event: WheelEvent): void => {
  event.preventDefault();

  const zoomSpeed = 0.0015;

  this.fov += event.deltaY * zoomSpeed;

  const minFov = Math.PI / 6;
  const maxFov = Math.PI * 0.85;

  this.fov = Math.max(minFov, Math.min(maxFov, this.fov));
};


  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() === 'r') {
      this.yaw = 0;
      this.pitch = 0;
      this.fov = Math.PI / 2;
    }

  };

  protected async startDrawLoop(): Promise<void> {
	  console.log('Video:', this.video.videoWidth, 'x', this.video.videoHeight);
console.log('Canvas:', this.canvas.width, 'x', this.canvas.height);
console.log('Canvas CSS:', this.canvas.clientWidth, 'x', this.canvas.clientHeight);
console.log('Pixel ratio:', this.regl._gl.drawingBufferWidth, 'x', this.regl._gl.drawingBufferHeight);

    const textureProps: Texture2DOptions = {
      data: this.video,
      flipY: true,
    };

    const texture = this.regl.texture(textureProps);

    this.frameTracker = new VideoFrameTracker(this.video);
    const { frameTracker } = this;

    const inverseModel = this.getInverseModelMatrix(this.video);




    const tempEye = vec4.fromValues(0, 0, 0, 1);
    vec4.transformMat4(tempEye, tempEye, inverseModel);

    const modelSpaceEye = new Float32Array(
      (tempEye as Float32Array).buffer,
      0,
      3,
    );

    const offsets = this.getTexCoordScaleOffsets();
    const offset = this.eye === 'left' ? offsets[0] : offsets[1];

    const drawLoop = () => {
		const now = performance.now();
this.fpsFrames++;

if (now - this.fpsLastTime >= 500) {
  this.fps = Math.round(
    (this.fpsFrames * 1000) / (now - this.fpsLastTime),
  );

  this.fpsFrames = 0;
  this.fpsLastTime = now;

  console.log(`FPS: ${this.fps}`);
}

      this.regl.clear({
        color: [0, 0, 0, 1],
        depth: 1,
      });

const projection = mat4.perspective(
  mat4.create(),
  this.fov,
  this.canvas.width / this.canvas.height,
  0.01,
  100,
);


      if (frameTracker.consumeFrame()) {
        texture.subimage(textureProps);
      }

      /*
       * Build the camera view every frame.
       *
       * yaw   = looking left/right
       * pitch = looking up/down
       */
      const direction = vec4.fromValues(0, 0, -1, 0);

      const rotation = mat4.create();

      mat4.rotateY(rotation, rotation, this.yaw);
      mat4.rotateX(rotation, rotation, this.pitch);

      vec4.transformMat4(direction, direction, rotation);

      const target = [
        direction[0],
        direction[1],
        direction[2],
      ] as [number, number, number];

      const view = mat4.lookAt(
        mat4.create(),
        [0, 0, 0],
        target,
        [0, 1, 0],
      );

      const vp = mat4.create();
      mat4.multiply(vp, projection, view);

      const ivp = mat4.create();
      mat4.invert(ivp, vp);

      const imvp = mat4.create();
      mat4.multiply(imvp, inverseModel, ivp);

      const props: RenderProps = {
        inverseModelViewProjection: imvp,
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

      this.raf = window.requestAnimationFrame(drawLoop);
    };

    this.raf = window.requestAnimationFrame(drawLoop);

    return Promise.resolve();
  }
}
