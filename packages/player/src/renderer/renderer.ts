import { mat4 } from 'gl-matrix';
import reglInit from 'regl';
import type { Format, Layout } from '../types';
import type { Regl } from 'regl';
import type { RenderProps } from './renderProps';

const QUAD_POSITIONS = [
  [-1, -1, 0],
  [1, -1, 0],
  [1, 1, 0],
  [-1, 1, 0],
];

const QUAD_INDICES = [
  [0, 1, 2],
  [0, 2, 3],
];

const VERT_SHADER_WEBGL1 = `
precision highp float;

attribute vec3 position;

varying vec2 clipCoord;

void main() {
  clipCoord = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const RAY_PREAMBLE_WEBGL1 = `
precision highp float;

#define PI 3.14159265359
#define TWO_PI 6.28318530718
#define SPHERE_RADIUS 1.0

uniform mat4 inverseModelViewProjection;
uniform vec3 modelSpaceEye;
uniform sampler2D texture;
uniform mediump vec4 texCoordScaleOffset;

varying vec2 clipCoord;

void getRay(out vec3 rayOrigin, out vec3 rayDir) {
  rayOrigin = modelSpaceEye;

  vec4 nearModel =
    inverseModelViewProjection * vec4(clipCoord, -1.0, 1.0);

  vec4 farModel =
    inverseModelViewProjection * vec4(clipCoord, 1.0, 1.0);

  nearModel /= nearModel.w;
  farModel /= farModel.w;

  rayDir = normalize(farModel.xyz - nearModel.xyz);
}
`;

const FRAG_360_WEBGL1 =
  RAY_PREAMBLE_WEBGL1 +
  `
void main() {
  vec3 rayOrigin;
  vec3 rayDir;

  getRay(rayOrigin, rayDir);

  float halfB = dot(rayOrigin, rayDir);
  float c =
    dot(rayOrigin, rayOrigin) -
    SPHERE_RADIUS * SPHERE_RADIUS;

  float discriminant = halfB * halfB - c;

  if (discriminant < 0.0) {
    discard;
  }

  float t = -halfB + sqrt(discriminant);

  vec3 hit = rayOrigin + t * rayDir;

  float theta = atan(hit.z, hit.x);
  float phi = asin(
    clamp(hit.y / SPHERE_RADIUS, -1.0, 1.0)
  );

  vec2 uv = vec2(
    theta / TWO_PI + 0.5,
    phi / PI + 0.5
  );

  vec2 mappedUv =
    uv * texCoordScaleOffset.xy +
    texCoordScaleOffset.zw;

  gl_FragColor = texture2D(texture, mappedUv);

}
`;

const FRAG_180_WEBGL1 =
  RAY_PREAMBLE_WEBGL1 +
  `
void main() {
  vec3 rayOrigin;
  vec3 rayDir;

  getRay(rayOrigin, rayDir);

  float halfB = dot(rayOrigin, rayDir);
  float c =
    dot(rayOrigin, rayOrigin) -
    SPHERE_RADIUS * SPHERE_RADIUS;

  float discriminant = halfB * halfB - c;

  if (discriminant < 0.0) {
    discard;
  }

  float t = -halfB + sqrt(discriminant);
  vec3 hit = rayOrigin + t * rayDir;

  float theta = atan(hit.z, hit.x);
  float phi = asin(
    clamp(hit.y / SPHERE_RADIUS, -1.0, 1.0)
  );

  vec2 uv = vec2(
    theta / TWO_PI + 0.5,
    phi / PI + 0.5
  );

  if (uv.x < 0.25 || uv.x > 0.75) {
    discard;
  }

  uv.x = (uv.x - 0.25) * 2.0;

  vec2 mappedUv =
    uv * texCoordScaleOffset.xy +
    texCoordScaleOffset.zw;

  gl_FragColor = texture2D(texture, mappedUv);
}
`;

const FRAG_SCREEN_WEBGL1 =
  RAY_PREAMBLE_WEBGL1 +
  `
void main() {
  vec3 rayOrigin;
  vec3 rayDir;

  getRay(rayOrigin, rayDir);

  if (abs(rayDir.z) < 0.00001) {
    discard;
  }

  float t = -rayOrigin.z / rayDir.z;

  if (t < 0.0) {
    discard;
  }

  vec3 hit = rayOrigin + t * rayDir;

  if (
    abs(hit.x) > 1.0 ||
    abs(hit.y) > 1.0
  ) {
    discard;
  }

  vec2 uv = vec2(
    1.0 - (hit.x * 0.5 + 0.5),
    hit.y * 0.5 + 0.5
  );

  vec2 mappedUv =
    uv * texCoordScaleOffset.xy +
    texCoordScaleOffset.zw;

  gl_FragColor = texture2D(texture, mappedUv);
}
`;

const VERT_SHADER_WEBGL2 = `#version 300 es
precision highp float;

in vec3 position;

out vec2 clipCoord;

void main() {
  clipCoord = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const RAY_PREAMBLE_WEBGL2 = `#version 300 es
precision highp float;

#define PI 3.14159265359
#define TWO_PI 6.28318530718
#define SPHERE_RADIUS 1.0

uniform mat4 inverseModelViewProjection;
uniform vec3 modelSpaceEye;
uniform sampler2D texture;
uniform mediump vec4 texCoordScaleOffset;

in vec2 clipCoord;

void getRay(out vec3 rayOrigin, out vec3 rayDir) {
  rayOrigin = modelSpaceEye;

  vec4 nearModel =
    inverseModelViewProjection * vec4(clipCoord, -1.0, 1.0);

  vec4 farModel =
    inverseModelViewProjection * vec4(clipCoord, 1.0, 1.0);

  nearModel /= nearModel.w;
  farModel /= farModel.w;

  rayDir = normalize(farModel.xyz - nearModel.xyz);
}
`;

const FRAG_360_WEBGL2 =
  RAY_PREAMBLE_WEBGL2 +
  `
out vec4 outColor;

void main() {
  vec3 rayOrigin;
  vec3 rayDir;

  getRay(rayOrigin, rayDir);

  float halfB = dot(rayOrigin, rayDir);
  float c =
    dot(rayOrigin, rayOrigin) -
    SPHERE_RADIUS * SPHERE_RADIUS;

  float discriminant = halfB * halfB - c;

  if (discriminant < 0.0) {
    discard;
  }

  float t = -halfB + sqrt(discriminant);
  vec3 hit = rayOrigin + t * rayDir;

  float theta = atan(hit.z, hit.x);
  float phi = asin(
    clamp(hit.y / SPHERE_RADIUS, -1.0, 1.0)
  );

  vec2 uv = vec2(
    theta / TWO_PI + 0.5,
    phi / PI + 0.5
  );

  vec2 mappedUv =
    uv * texCoordScaleOffset.xy +
    texCoordScaleOffset.zw;

  outColor = texture(texture, mappedUv);
}
`;

const FRAG_180_WEBGL2 =
  RAY_PREAMBLE_WEBGL2 +
  `
out vec4 outColor;

void main() {
  vec3 rayOrigin;
  vec3 rayDir;

  getRay(rayOrigin, rayDir);

  float halfB = dot(rayOrigin, rayDir);
  float c =
    dot(rayOrigin, rayOrigin) -
    SPHERE_RADIUS * SPHERE_RADIUS;

  float discriminant = halfB * halfB - c;

  if (discriminant < 0.0) {
    discard;
  }

  float t = -halfB + sqrt(discriminant);
  vec3 hit = rayOrigin + t * rayDir;

  float theta = atan(hit.z, hit.x);
  float phi = asin(
    clamp(hit.y / SPHERE_RADIUS, -1.0, 1.0)
  );

  vec2 uv = vec2(
    theta / TWO_PI + 0.5,
    phi / PI + 0.5
  );

  if (uv.x < 0.25 || uv.x > 0.75) {
    discard;
  }

  uv.x = (uv.x - 0.25) * 2.0;

  vec2 mappedUv =
    uv * texCoordScaleOffset.xy +
    texCoordScaleOffset.zw;

  outColor = texture(texture, mappedUv);
}
`;

const FRAG_SCREEN_WEBGL2 =
  RAY_PREAMBLE_WEBGL2 +
  `
out vec4 outColor;

void main() {
  vec3 rayOrigin;
  vec3 rayDir;

  getRay(rayOrigin, rayDir);

  if (abs(rayDir.z) < 0.00001) {
    discard;
  }

  float t = -rayOrigin.z / rayDir.z;

  if (t < 0.0) {
    discard;
  }

  vec3 hit = rayOrigin + t * rayDir;

  if (
    abs(hit.x) > 1.0 ||
    abs(hit.y) > 1.0
  ) {
    discard;
  }

  vec2 uv = vec2(
    1.0 - (hit.x * 0.5 + 0.5),
    hit.y * 0.5 + 0.5
  );

  vec2 mappedUv =
    uv * texCoordScaleOffset.xy +
    texCoordScaleOffset.zw;

  outColor = texture(texture, mappedUv);
}
`;

export type WebGLVersion = 1 | 2;

function getFragShader(
  format: Format,
  version: WebGLVersion,
): string {
  if (version === 2) {
    switch (format) {
      case '360':
        return FRAG_360_WEBGL2;
      case '180':
        return FRAG_180_WEBGL2;
      case 'screen':
      default:
        return FRAG_SCREEN_WEBGL2;
    }
  }

  switch (format) {
    case '360':
      return FRAG_360_WEBGL1;
    case '180':
      return FRAG_180_WEBGL1;
    case 'screen':
    default:
      return FRAG_SCREEN_WEBGL1;
  }
}

export class VideoFrameTracker {
  private hasNewFrame = true;
  private vfcHandle = 0;
  private stopped = false;

  constructor(private readonly video: HTMLVideoElement) {
    if ('requestVideoFrameCallback' in video) {
      this.hasNewFrame = false;
      this.scheduleCallback();
    }
  }

  private scheduleCallback() {
    if (this.stopped) {
      return;
    }

    this.vfcHandle = this.video.requestVideoFrameCallback(() => {
      this.hasNewFrame = true;
      this.scheduleCallback();
    });
  }

  consumeFrame(): boolean {
    if (!this.hasNewFrame) {
      return false;
    }

    this.hasNewFrame = false;
    return true;
  }

  stop() {
    this.stopped = true;

    if ('cancelVideoFrameCallback' in this.video) {
      this.video.cancelVideoFrameCallback(this.vfcHandle);
    }
  }
}

export abstract class Renderer {
  protected abstract startDrawLoop(): Promise<void>;
  protected abstract stopDrawLoop(): void;

  protected readonly regl: Regl;

  protected readonly cmdRender: reglInit.DrawCommand<
    reglInit.DefaultContext,
    RenderProps
  >;

  protected readonly webglVersion: WebGLVersion;

  constructor(
    protected readonly canvas: HTMLCanvasElement,
    protected readonly layout: Layout,
    protected readonly flipLayout: boolean,
    protected readonly format: Format,
    webglVersion: WebGLVersion = 1,
  ) {
    this.webglVersion = webglVersion;

const dpr = Math.min(
  window.devicePixelRatio || 1,
  2,
);

const width = Math.max(
  1,
  Math.round(
    this.canvas.clientWidth * dpr,
  ),
);

const height = Math.max(
  1,
  Math.round(
    this.canvas.clientHeight * dpr,
  ),
);

if (
  this.canvas.width !== width ||
  this.canvas.height !== height
) {
  this.canvas.width = width;
  this.canvas.height = height;
}


	const gl =
	  webglVersion === 2
		? this.canvas.getContext('webgl2', {
			alpha: false,
			antialias: false,
			depth: false,
			stencil: false,
			preserveDrawingBuffer: false,
		  })
		: this.canvas.getContext('webgl', {
			alpha: false,
			antialias: false,
			depth: false,
			stencil: false,
			preserveDrawingBuffer: false,
		  });

	if (!gl) {
	  throw new Error(
		`WebGL ${webglVersion} is not supported`,
	  );
	}

this.regl = reglInit({
  gl,
  pixelRatio: 1,
});


    this.cmdRender = this.regl({
      vert:
        webglVersion === 2
          ? VERT_SHADER_WEBGL2
          : VERT_SHADER_WEBGL1,

      frag: getFragShader(
        this.format,
        webglVersion,
      ),

      attributes: {
        position: QUAD_POSITIONS,
      },

      uniforms: {
        inverseModelViewProjection:
          this.regl.prop<
            RenderProps,
            'inverseModelViewProjection'
          >('inverseModelViewProjection'),

        modelSpaceEye:
          this.regl.prop<
            RenderProps,
            'modelSpaceEye'
          >('modelSpaceEye'),

        texture:
          this.regl.prop<
            RenderProps,
            'texture'
          >('texture'),

        texCoordScaleOffset:
          this.regl.prop<
            RenderProps,
            'texCoordScaleOffset'
          >('texCoordScaleOffset'),
      },

      viewport:
        this.regl.prop<
          RenderProps,
          'viewport'
        >('viewport'),

      elements: QUAD_INDICES,
    });
  }

  public async start() {
    await this.startDrawLoop();
  }

  public stop() {
    this.stopDrawLoop();
    this.regl.destroy();
  }

  protected getAspectRatio(
    video: HTMLVideoElement,
  ) {
    switch (this.layout) {
      case 'stereoLeftRight':
        return (
          (video.videoWidth * 0.5) /
          video.videoHeight
        );

      case 'stereoTopBottom':
        return (
          (video.videoWidth / video.videoHeight) *
          0.5
        );

      case 'mono':
      default:
        return (
          video.videoWidth /
          video.videoHeight
        );
    }
  }

  protected getModelMatrix(
    video: HTMLVideoElement,
  ) {
    const aspectRatio =
      this.getAspectRatio(video);

    const model = mat4.create();

    mat4.rotateY(
      model,
      model,
      Math.PI,
    );

    if (this.format === 'screen') {
      const screenHeight = 1;

      mat4.scale(
        model,
        model,
        [
          screenHeight * aspectRatio,
          screenHeight,
          1,
        ],
      );

      mat4.translate(
        model,
        model,
        [0, 0, screenHeight],
      );
    }

    if (this.format !== 'screen') {
      mat4.rotateY(
        model,
        model,
        -Math.PI / 2,
      );
    }

    return model;
  }

  protected getInverseModelMatrix(
    video: HTMLVideoElement,
  ): mat4 {
    const inverse = mat4.create();

    mat4.invert(
      inverse,
      this.getModelMatrix(video),
    );

    return inverse;
  }

  protected getTexCoordScaleOffsets() {
    let offsets: Float32Array[];

    switch (this.layout) {
      case 'stereoLeftRight':
        offsets = [
          new Float32Array([
            0.5, 1.0, 0.0, 0.0,
          ]),
          new Float32Array([
            0.5, 1.0, 0.5, 0.0,
          ]),
        ];
        break;

      case 'stereoTopBottom':
        offsets = [
          new Float32Array([
            1.0, 0.5, 0.0, 0.0,
          ]),
          new Float32Array([
            1.0, 0.5, 0.0, 0.5,
          ]),
        ];
        break;

      case 'mono':
      default:
        offsets = [
          new Float32Array([
            1.0, 1.0, 0.0, 0.0,
          ]),
          new Float32Array([
            1.0, 1.0, 0.0, 0.0,
          ]),
        ];
    }

    if (this.flipLayout) {
      return offsets.reverse();
    }

    return offsets;
  }
}
